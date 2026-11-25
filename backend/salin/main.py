"""Salin HTTP API and static frontend, one process on one port."""

from __future__ import annotations

import csv
import io
import logging
import sqlite3
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, UploadFile
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
    HistorySearch, SettingsPatch, StarIn, TranslateRequest, TranslationOutput,
)

log = logging.getLogger("salin")

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
    "form-action 'self'; frame-ancestors 'none'"
)
SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
}


def _known_terms(parsed, glossary: list[dict[str, Any]]):
    """Keep only glossary_terms_used that really are glossary entries,
    spelled as the glossary spells them."""
    by_key = {e["term"].casefold(): e["term"] for e in glossary}
    parsed.glossary_terms_used = list(dict.fromkeys(
        by_key[t.casefold()] for t in parsed.glossary_terms_used if t.casefold() in by_key))
    return parsed


def create_app(config: Config | None = None) -> FastAPI:
    cfg = config or load_config()
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

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

    @app.post("/api/translate")
    async def translate(body: TranslateRequest, request: Request):
        model = body.model or db(request).get_settings()["default_model"]
        out, meta = await run_model(
            request, model=model, schema=TranslationOutput,
            user_text=prompts.translate_message(body.text, body.direction, body.context),
        )
        result = {"output": out.model_dump(), "meta": meta.as_dict()}
        result["history_id"] = maybe_save(
            request, body.save, mode="translate",
            direction=f"{out.source_language}->{out.target_language}", model=meta.model_id,
            provider=meta.provider, source_text=body.text, output_text=out.translation,
            result=result,
        )
        return result

    @app.post("/api/compose")
    async def compose(body: ComposeRequest, request: Request):
        model = body.model or db(request).get_settings()["default_model"]
        out, meta = await run_model(
            request, model=model, schema=ComposeOutput,
            user_text=prompts.compose_message(body.text, body.formality, body.reply_to,
                                              body.instructions),
        )
        result = {"output": out.model_dump(), "meta": meta.as_dict(),
                  "request": {"formality": body.formality, "reply_to": body.reply_to}}
        result["history_id"] = maybe_save(
            request, body.save, mode="compose", direction=f"english->tagalog:{body.formality}",
            model=meta.model_id, provider=meta.provider, source_text=body.text,
            output_text=out.reply, result=result,
        )
        return result

    # ---- glossary -----------------------------------------------------------
    @app.get("/api/glossary")
    async def glossary_list(request: Request):
        return db(request).list_glossary()

    @app.post("/api/glossary", status_code=201)
    async def glossary_create(body: GlossaryIn, request: Request):
        try:
            return db(request).create_glossary(body.term.strip(), body.meaning.strip(),
                                               body.kind, body.notes.strip())
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
        w.writerow(["term", "meaning", "kind", "notes"])
        for e in db(request).list_glossary():
            w.writerow([e["term"], e["meaning"], e["kind"], e["notes"]])
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
                                  notes=(row.get("notes") or "").strip())
                entries.append(item.model_dump())
            except ValueError:
                errors.append(n)
        created, updated = db(request).upsert_glossary_many(entries)
        return {"created": created, "updated": updated, "skipped_rows": errors}

    # ---- history ------------------------------------------------------------
    @app.post("/api/history/search")
    async def history_search(body: HistorySearch, request: Request):
        items, total = db(request).search_history(q=body.q, mode=body.mode, starred=body.starred,
                                                   limit=body.limit, offset=body.offset)
        return {"items": items, "total": total}

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
            "version": __version__,
        }

    @app.get("/api/settings")
    async def settings_get(request: Request):
        return await settings_payload(request)

    @app.patch("/api/settings")
    async def settings_update(body: SettingsPatch, request: Request):
        changes = body.model_dump(exclude_none=True)
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
