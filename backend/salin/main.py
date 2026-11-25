"""Salin HTTP API and static frontend, one process on one port."""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import sqlite3
import tempfile
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__, prompts
from .config import Config, load_config
from .db import Database
from .keystore import KeyStore
from .llm import MODEL_IDS, ClaudeProvider, LLMError, OllamaProvider, system_blocks
from .schemas import (
    ApiKeyIn, ClearHistoryIn, ComposeOutput, ComposeRequest, GlossaryIn, GlossaryPatch,
    HistorySearch, LanguageIn, LanguagePatch, ResetIn, SettingsPatch, SpeakIn, StarIn, TranslateRequest,
    TranslationOutput,
)
from .speech import Speaker, SpeechError, Transcriber

log = logging.getLogger("salin")

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; frame-ancestors 'none'"
)
SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), interest-cohort=()",
}


def _known_terms(parsed, glossary: list[dict[str, Any]]):
    """Keep only glossary_terms_used that really are glossary entries,
    spelled as the glossary spells them."""
    by_key = {e["term"].casefold(): e["term"] for e in glossary}
    parsed.glossary_terms_used = list(dict.fromkeys(
        by_key[t.casefold()] for t in parsed.glossary_terms_used if t.casefold() in by_key))
    return parsed


MAX_AUDIO = 25 * 1024 * 1024


def _apply_weak_languages(parsed, langs: list[dict[str, Any]], meta) -> None:
    """Weaker languages are low confidence and need a native check by
    default, whatever the model said."""
    weak = [lang for lang in langs if lang and lang["quality"] == "weak"]
    if not weak:
        return
    parsed.confidence = "low"
    parsed.needs_native_review = True
    names = " and ".join(dict.fromkeys(lang["name"] for lang in weak))
    meta.warnings.append(f"{names}: the model is less reliable here. "
                         "Have a native speaker check before relying on it.")


def _spellings_to_csv(sp: dict[str, str]) -> str:
    return " | ".join(f"{k}={v}" for k, v in sorted(sp.items()))


def _spellings_from_csv(text: str) -> dict[str, str]:
    out = {}
    for part in (text or "").split("|"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().lower()] = v.strip()
    return out


def create_app(config: Config | None = None) -> FastAPI:
    cfg = config or load_config()
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    for noisy in ("httpx", "httpx2", "huggingface_hub"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(cfg.db_path)
        db.purge_history(db.get_settings()["retention_days"])
        app.state.db = db
        yield
        db.close()

    app = FastAPI(title="Salin", version=__version__, lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    keys = KeyStore(cfg.env_file)
    claude = ClaudeProvider(lambda: keys.key)
    ollama = OllamaProvider(cfg.ollama_url, cfg.ollama_model)
    transcriber = Transcriber(cfg.data_dir / "models")
    allowed = set(cfg.allowed_hosts)

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(allowed))

    @app.middleware("http")
    async def guard(request: Request, call_next):
        # Same-origin check for state-changing requests: blocks cross-site
        # form posts and fetches from other pages or containers' sites.
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin and urlsplit(origin).hostname not in allowed:
                return JSONResponse({"detail": "Cross-origin request refused."}, status_code=403)
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(LLMError)
    async def llm_error(_: Request, exc: LLMError):
        return JSONResponse({"detail": exc.message, "code": exc.code}, status_code=exc.status)

    def db(request: Request) -> Database:
        return request.app.state.db

    # ---- core ---------------------------------------------------------------
    async def run_model(request: Request, *, model: str, user_text: str, schema):
        settings = db(request).get_settings()
        effort = settings[f"effort_{model}"]
        glossary = db(request).list_glossary()
        system = system_blocks(prompts.SYSTEM_PROMPT, prompts.render_glossary(glossary))
        try:
            parsed, meta = await claude.run(model=model, effort=effort, system=system,
                                            user_text=user_text, schema=schema)
            return _known_terms(parsed, glossary), meta
        except LLMError as err:
            if not (err.offline_ok and settings["offline_fallback"] and await ollama.available()):
                raise
            log.warning("claude unavailable (%s); using local fallback", err.code)
            parsed, meta = await ollama.run(system=system, user_text=user_text,
                                            schema=schema, model=model)
            meta.warnings.insert(0, err.message)
            return _known_terms(parsed, glossary), meta

    def maybe_save(request: Request, save: bool | None, **fields) -> int | None:
        settings = db(request).get_settings()
        if not (settings["save_history"] if save is None else save):
            return None
        item_id = db(request).add_history(**fields)
        db(request).purge_history(settings["retention_days"])
        return item_id

    @app.get("/api/health")
    async def health():
        return {"ok": True, "version": __version__}

    def language(request: Request, code: str, *, what: str) -> dict[str, Any]:
        lang = db(request).get_language(code)
        if not lang or not lang["enabled"]:
            raise HTTPException(422, f"{what} language '{code}' is not enabled. Check Settings.")
        return lang

    @app.post("/api/translate")
    async def translate(body: TranslateRequest, request: Request):
        settings = db(request).get_settings()
        model = body.model or settings["default_model"]
        target = language(request, body.target or settings["default_target"], what="Target")
        source = None if body.source == "auto" else language(request, body.source, what="Source")
        second_code = settings["second_language"]
        second = db(request).get_language(second_code) if second_code else None
        candidates = db(request).list_languages(enabled_only=True)
        out, meta = await run_model(
            request, model=model, schema=TranslationOutput,
            user_text=prompts.translate_message(
                body.text, source=source, target=target,
                second=second if second and second["enabled"] else None,
                candidates=candidates, context=body.context),
        )
        by_code = {c["code"]: c for c in candidates}
        detected = source or by_code.get(out.source_language)
        actual_target = by_code.get(out.target_language, target)
        _apply_weak_languages(out, [detected, actual_target], meta)
        result = {"output": out.model_dump(), "meta": meta.as_dict(),
                  "request": {"source": body.source, "target": target["code"]}}
        src_code = detected["code"] if detected else out.source_language
        result["history_id"] = maybe_save(
            request, body.save, mode="translate",
            direction=f"{src_code}>{actual_target['code']}", model=meta.model_id,
            provider=meta.provider, source_text=body.text, output_text=out.translation,
            result=result, source_lang=src_code, target_lang=actual_target["code"],
        )
        return result

    @app.post("/api/compose")
    async def compose(body: ComposeRequest, request: Request):
        settings = db(request).get_settings()
        model = body.model or settings["default_model"]
        target = language(request, body.target or settings["reply_language"], what="Reply")
        registers = {r["id"]: r for r in target["registers"]}
        register = registers.get(body.register_id or "") or target["registers"][0]
        out, meta = await run_model(
            request, model=model, schema=ComposeOutput,
            user_text=prompts.compose_message(body.text, target=target, register=register,
                                              reply_to=body.reply_to,
                                              instructions=body.instructions),
        )
        out.register_used = register["id"]
        _apply_weak_languages(out, [target], meta)
        result = {"output": out.model_dump(), "meta": meta.as_dict(),
                  "request": {"target": target["code"], "register": register,
                              "reply_to": body.reply_to}}
        result["history_id"] = maybe_save(
            request, body.save, mode="compose", direction=f"en>{target['code']}:{register['id']}",
            model=meta.model_id, provider=meta.provider, source_text=body.text,
            output_text=out.reply, result=result, source_lang="en", target_lang=target["code"],
        )
        return result

    # ---- languages ----------------------------------------------------------
    @app.get("/api/languages")
    async def languages_list(request: Request):
        return db(request).list_languages()

    @app.post("/api/languages", status_code=201)
    async def language_create(body: LanguageIn, request: Request):
        try:
            return db(request).create_language(body.model_dump())
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, f"Language '{body.code}' already exists.") from e

    def check_not_default(request: Request, code: str, action: str) -> None:
        s = db(request).get_settings()
        for key, label in (("default_target", "default translation language"),
                           ("reply_language", "default reply language")):
            if s[key] == code:
                raise HTTPException(409, f"Cannot {action} the {label}. Change it in Settings first.")

    @app.patch("/api/languages/{code}")
    async def language_update(code: str, body: LanguagePatch, request: Request):
        fields = body.model_dump(exclude_none=True)
        if fields.get("enabled") is False:
            check_not_default(request, code, "turn off")
        lang = db(request).update_language(code, fields)
        if not lang:
            raise HTTPException(404, "Language not found.")
        return lang

    @app.delete("/api/languages/{code}", status_code=204)
    async def language_delete(code: str, request: Request):
        check_not_default(request, code, "delete")
        if not db(request).delete_language(code):
            raise HTTPException(404, "Language not found.")
        return Response(status_code=204)

    @app.post("/api/languages/reset")
    async def languages_reset(body: ResetIn, request: Request):
        db(request).reset_languages()
        return db(request).list_languages()

    # ---- speech -------------------------------------------------------------
    @app.post("/api/transcribe")
    async def transcribe(request: Request, file: UploadFile, language: str = Form("auto")):
        settings = db(request).get_settings()
        if not settings["speech_input"]:
            raise HTTPException(403, "Speech input is turned off in Settings.")
        data = await file.read(MAX_AUDIO + 1)
        if len(data) > MAX_AUDIO:
            raise HTTPException(413, "The recording is larger than 25 MB.")
        if len(data) < 200:
            raise HTTPException(422, "The recording is empty.")
        warnings, hint = [], None
        if language != "auto":
            lang = db(request).get_language(language)
            if lang and lang["speech_code"]:
                hint = lang["speech_code"]
                if hint != lang["code"].split("-")[0]:
                    other = db(request).get_language(hint)
                    warnings.append(f"There is no {lang['name']} speech model, so the "
                                    f"{other['name'] if other else hint} one was used. "
                                    "Check the transcript.")
            elif lang:
                warnings.append(f"Speech recognition has no {lang['name']} model, so the language "
                                "was detected automatically. Check the transcript.")
        with tempfile.NamedTemporaryFile(suffix=".audio") as tmp:
            tmp.write(data)
            tmp.flush()
            try:
                out = await asyncio.to_thread(transcriber.transcribe, Path(tmp.name),
                                              size=settings["speech_model"], language=hint)
            except SpeechError as e:
                raise HTTPException(e.status, e.message) from e
        if not out["text"]:
            warnings.append("No speech was recognised in the recording.")
        elif hint is None:
            known = {lang["speech_code"] for lang in db(request).list_languages(enabled_only=True)}
            if out["language"] not in known or out["language_probability"] < 0.6:
                warnings.append("The spoken language was unclear. Check the transcript, or pick the "
                                "language under From before recording.")
        return {**out, "warnings": warnings}

    @app.post("/api/speak")
    async def speak(body: SpeakIn):
        try:
            audio = await asyncio.to_thread(Speaker.speak, body.text, body.lang)
        except SpeechError as e:
            raise HTTPException(e.status, e.message) from e
        return Response(audio, media_type="audio/wav")

    # ---- glossary -----------------------------------------------------------
    @app.get("/api/glossary")
    async def glossary_list(request: Request):
        return db(request).list_glossary()

    @app.post("/api/glossary", status_code=201)
    async def glossary_create(body: GlossaryIn, request: Request):
        try:
            return db(request).create_glossary(body.term.strip(), body.meaning.strip(),
                                               body.kind, body.notes.strip(), body.spellings)
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, f"“{body.term.strip()}” is already in the glossary.") from e

    @app.patch("/api/glossary/{entry_id}")
    async def glossary_update(entry_id: int, body: GlossaryPatch, request: Request):
        fields = {k: (v.strip() if isinstance(v, str) else v)
                  for k, v in body.model_dump(exclude_none=True).items()}
        try:
            entry = db(request).update_glossary(entry_id, fields)
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, "Another entry already uses that term.") from e
        if not entry:
            raise HTTPException(404, "Glossary entry not found.")
        return entry

    @app.delete("/api/glossary/{entry_id}", status_code=204)
    async def glossary_delete(entry_id: int, request: Request):
        if not db(request).delete_glossary(entry_id):
            raise HTTPException(404, "Glossary entry not found.")
        return Response(status_code=204)

    @app.get("/api/glossary/export")
    async def glossary_export(request: Request):
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["term", "meaning", "kind", "notes", "spellings"])
        for e in db(request).list_glossary():
            w.writerow([e["term"], e["meaning"], e["kind"], e["notes"],
                        _spellings_to_csv(e["spellings"])])
        return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="salin-glossary.csv"'})

    @app.post("/api/glossary/import")
    async def glossary_import(file: UploadFile, request: Request):
        raw = await file.read(1_000_001)
        if len(raw) > 1_000_000:
            raise HTTPException(413, "File is larger than 1 MB.")
        try:
            reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
            rows = list(reader)
        except (UnicodeDecodeError, csv.Error) as e:
            raise HTTPException(400, "Could not read the file as UTF-8 CSV.") from e
        entries, errors = [], []
        for n, row in enumerate(rows, start=2):
            try:
                item = GlossaryIn(term=(row.get("term") or "").strip(),
                                  meaning=(row.get("meaning") or "").strip(),
                                  kind=(row.get("kind") or "term").strip().lower(),
                                  notes=(row.get("notes") or "").strip(),
                                  spellings=_spellings_from_csv(row.get("spellings") or ""))
                entries.append(item.model_dump())
            except ValueError:
                errors.append(n)
        created, updated = db(request).upsert_glossary_many(entries)
        return {"created": created, "updated": updated, "skipped_rows": errors}

    # ---- history ------------------------------------------------------------
    @app.post("/api/history/search")
    async def history_search(body: HistorySearch, request: Request):
        items, total = db(request).search_history(q=body.q, mode=body.mode, starred=body.starred,
                                                   limit=body.limit, offset=body.offset,
                                                   pair=body.pair)
        return {"items": items, "total": total}

    @app.get("/api/history/pairs")
    async def history_pairs(request: Request):
        return db(request).history_pairs()

    @app.get("/api/history/{item_id}")
    async def history_get(item_id: int, request: Request):
        item = db(request).get_history(item_id)
        if not item:
            raise HTTPException(404, "History item not found.")
        return item

    @app.patch("/api/history/{item_id}")
    async def history_star(item_id: int, body: StarIn, request: Request):
        if not db(request).star_history(item_id, body.starred):
            raise HTTPException(404, "History item not found.")
        return {"id": item_id, "starred": body.starred}

    @app.delete("/api/history/{item_id}", status_code=204)
    async def history_delete(item_id: int, request: Request):
        if not db(request).delete_history(item_id):
            raise HTTPException(404, "History item not found.")
        return Response(status_code=204)

    @app.post("/api/history/clear")
    async def history_clear(body: ClearHistoryIn, request: Request):
        return {"deleted": db(request).clear_history(body.keep_starred)}

    # ---- settings -----------------------------------------------------------
    async def settings_payload(request: Request) -> dict[str, Any]:
        return {
            **db(request).get_settings(),
            "api_key": {"configured": keys.configured, "hint": keys.hint},
            "models": MODEL_IDS,
            "offline": {"model": cfg.ollama_model, "available": await ollama.available()},
            "speech": {**transcriber.status(db(request).get_settings()["speech_model"]),
                       "voices": Speaker.voices()},
            "version": __version__,
            "local_url": cfg.local_url,
        }

    @app.get("/api/settings")
    async def settings_get(request: Request):
        return await settings_payload(request)

    @app.patch("/api/settings")
    async def settings_update(body: SettingsPatch, request: Request):
        changes = body.model_dump(exclude_none=True)
        for key in ("default_target", "second_language", "reply_language"):
            if key in changes:
                lang = db(request).get_language(changes[key])
                if not lang or not lang["enabled"]:
                    raise HTTPException(422, f"Language '{changes[key]}' is not enabled.")
        db(request).update_settings(changes)
        if "retention_days" in changes:
            db(request).purge_history(changes["retention_days"])
        return await settings_payload(request)

    @app.put("/api/settings/api-key")
    async def api_key_set(body: ApiKeyIn, request: Request):
        try:
            keys.set(body.api_key)
        except OSError as e:
            raise HTTPException(500, "Could not write the key file.") from e
        return {"configured": True, "hint": keys.hint}

    @app.delete("/api/settings/api-key")
    async def api_key_clear(request: Request):
        keys.clear()
        return {"configured": False, "hint": ""}

    @app.post("/api/settings/test")
    async def api_key_test():
        try:
            name = await claude.test_key()
        except LLMError:
            raise
        except Exception as e:  # map SDK errors to a readable message
            status = getattr(e, "status_code", 502)
            msg = "The API key was rejected." if status == 401 else f"Test failed ({status})."
            raise HTTPException(400 if status == 401 else 502, msg) from e
        return {"ok": True, "message": f"Key works. {name} is reachable."}

    # ---- frontend -----------------------------------------------------------
    static = cfg.static_dir
    if (static / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "Not found.")
            candidate = (static / path).resolve()
            if path and candidate.is_file() and static.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(static / "index.html", headers={"Cache-Control": "no-cache"})

    return app
