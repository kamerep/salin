"""Model providers: Claude (Anthropic API) and an optional local Ollama
fallback for offline use."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, TypeVar

import anthropic
import httpx
from pydantic import BaseModel, ValidationError

log = logging.getLogger("salin.llm")

MODEL_IDS = {"haiku": "claude-haiku-5-5", "sonnet": "claude-sonnet-5-5"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_TOKENS = 8000

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """An error safe to show to the user. `offline_ok` marks failures where
    falling back to the local model makes sense (network, outage, no key)."""

    def __init__(self, status: int, code: str, message: str, *, offline_ok: bool = False) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.offline_ok = offline_ok


@dataclass
class CallMeta:
    provider: str
    model: str
    model_id: str
    elapsed_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    fallback_used: bool = False
    request_id: str = ""
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def system_blocks(base: str, glossary: str) -> list[dict[str, Any]]:
    """Two cache breakpoints: the frozen base prompt, then the glossary.
    Editing the glossary only re-writes the second block."""
    return [
        {"type": "text", "text": base, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": glossary, "cache_control": {"type": "ephemeral"}},
    ]


class ClaudeProvider:
    def __init__(self, key_getter) -> None:
        self._key_getter = key_getter
        self._client: anthropic.AsyncAnthropic | None = None
        self._client_key = ""

    def client(self) -> anthropic.AsyncAnthropic:
        key = self._key_getter()
        if not key:
            raise LLMError(
                503, "no_api_key",
                "No Anthropic API key is set. Add one in Settings.", offline_ok=True,
            )
        if self._client is None or key != self._client_key:
            self._client = anthropic.AsyncAnthropic(api_key=key, max_retries=2, timeout=90.0)
            self._client_key = key
        return self._client

    async def test_key(self) -> str:
        model = await self.client().models.retrieve(MODEL_IDS["haiku"])
        return model.display_name

    async def run(
        self, *, model: str, effort: str, system: list[dict[str, Any]],
        user_text: str, schema: type[T],
    ) -> tuple[T, CallMeta]:
        model_id = MODEL_IDS[model]
        kwargs: dict[str, Any] = {
            "model": model_id,
            "max_tokens": MAX_TOKENS,
            "system": system,
            "messages": [{"role": "user", "content": user_text}],
            "output_format": schema,
            "output_config": {"effort": effort},
        }
        if model == "sonnet":
            # Server-side refusal fallback, routed by refusal category.
            kwargs["betas"] = [FALLBACK_BETA]
            kwargs["fallbacks"] = "default"

        started = time.monotonic()
        try:
            resp = await self.client().beta.messages.parse(**kwargs)
        except anthropic.AuthenticationError as e:
            raise LLMError(401, "bad_api_key", "The API key was rejected. Check it in Settings.") from e
        except anthropic.PermissionDeniedError as e:
            raise LLMError(403, "forbidden", "This API key cannot use that model.") from e
        except anthropic.NotFoundError as e:
            raise LLMError(404, "model_not_found", f"Model {model_id} is not available to this key.") from e
        except anthropic.RateLimitError as e:
            raise LLMError(429, "rate_limited", "Rate limited by the API. Wait a moment and retry.") from e
        except anthropic.BadRequestError as e:
            raise LLMError(400, "bad_request", f"The API rejected the request: {e.message}") from e
        except anthropic.APIStatusError as e:
            raise LLMError(
                502, "api_error", f"The API returned {e.status_code}. Retry shortly.",
                offline_ok=e.status_code >= 500,
            ) from e
        except anthropic.APIConnectionError as e:
            raise LLMError(503, "offline", "Cannot reach the Anthropic API.", offline_ok=True) from e

        meta = CallMeta(
            provider="claude",
            model=model,
            model_id=resp.model,
            elapsed_ms=int((time.monotonic() - started) * 1000),
            input_tokens=resp.usage.input_tokens or 0,
            output_tokens=resp.usage.output_tokens or 0,
            cache_read_tokens=resp.usage.cache_read_input_tokens or 0,
            cache_write_tokens=resp.usage.cache_creation_input_tokens or 0,
            request_id=getattr(resp, "_request_id", "") or "",
        )
        meta.fallback_used = any(
            getattr(i, "type", "") == "fallback_message" for i in (getattr(resp.usage, "iterations", None) or [])
        )
        if meta.fallback_used:
            meta.warnings.append(f"Answered by fallback model {resp.model}.")

        if resp.stop_reason == "refusal":
            category = getattr(resp.stop_details, "category", None) if resp.stop_details else None
            raise LLMError(422, "refused", f"The model declined this text ({category or 'no category'}).")
        if resp.stop_reason == "max_tokens":
            raise LLMError(422, "too_long", "The response was cut off. Try a shorter message.")
        if resp.parsed_output is None:
            raise LLMError(502, "bad_output", "The model returned an unreadable response. Retry.")
        log.info(
            "claude ok model=%s in=%d out=%d cache_read=%d cache_write=%d ms=%d req=%s",
            resp.model, meta.input_tokens, meta.output_tokens, meta.cache_read_tokens,
            meta.cache_write_tokens, meta.elapsed_ms, meta.request_id,
        )
        return resp.parsed_output, meta


class OllamaProvider:
    """Local fallback through Ollama's native /api/chat with a JSON schema.
    Quality for Tagalog is far below Claude, so results are always marked."""

    def __init__(self, base_url: str, model: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=2.0) as c:
                r = await c.get(f"{self.base_url}/api/tags")
                r.raise_for_status()
                names = {m.get("name") for m in r.json().get("models", [])}
                return self.model in names
        except (httpx.HTTPError, ValueError):
            return False

    async def run(
        self, *, system: list[dict[str, Any]], user_text: str, schema: type[T], model: str,
    ) -> tuple[T, CallMeta]:
        system_text = "\n\n".join(b["text"] for b in system)
        body = {
            "model": self.model,
            "stream": False,
            "format": schema.model_json_schema(),
            "options": {"temperature": 0.2},
            "messages": [
                {"role": "system", "content": system_text},
                {"role": "user", "content": user_text + "\n\nReply with JSON only."},
            ],
        }
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=180.0) as c:
                r = await c.post(f"{self.base_url}/api/chat", json=body)
                r.raise_for_status()
                data = r.json()
        except httpx.HTTPError as e:
            raise LLMError(503, "offline_unavailable", "The local fallback model is not reachable.") from e
        try:
            parsed = schema.model_validate(json.loads(data["message"]["content"]))
        except (KeyError, ValueError, ValidationError) as e:
            raise LLMError(502, "bad_output", "The local model returned an unreadable response.") from e
        if hasattr(parsed, "confidence"):
            parsed.confidence = "low"  # type: ignore[attr-defined]
        if hasattr(parsed, "confidence_reason"):
            parsed.confidence_reason = (  # type: ignore[attr-defined]
                "Offline model, so confidence is capped at low. Model's own note: "
                + parsed.confidence_reason  # type: ignore[attr-defined]
            )
        meta = CallMeta(
            provider="ollama",
            model=model,
            model_id=self.model,
            elapsed_ms=int((time.monotonic() - started) * 1000),
            input_tokens=int(data.get("prompt_eval_count") or 0),
            output_tokens=int(data.get("eval_count") or 0),
            warnings=["Offline model used: quality is lower. Check before relying on it."],
        )
        return parsed, meta
