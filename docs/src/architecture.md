# Architecture and API

## Components

```
Browser (React, Vite build) ──HTTP──▶ uvicorn + FastAPI (container salin)
                                        ├─ SQLite: glossary, history (FTS5), settings
                                        ├─ Anthropic API: claude-haiku-5-5 / claude-sonnet-5-5
                                        └─ Ollama on the host (offline fallback, via LXD proxy)
```

| Path | Contents |
|---|---|
| `backend/salin/main.py` | App factory, routes, security middleware, static frontend |
| `backend/salin/llm.py` | Claude provider (structured output, caching, fallback, error mapping) and Ollama provider |
| `backend/salin/prompts.py` | System prompt, glossary rendering, request wrappers |
| `backend/salin/schemas.py` | Request models and the structured-output schemas |
| `backend/salin/db.py` | SQLite schema, glossary, history search, settings |
| `backend/salin/keystore.py` | Write-only API key storage in the env file |
| `frontend/src` | React app: pages, components, design tokens |
| `deploy/` | Container deploy script, systemd unit, desktop launcher and hotkey |

## Model calls

- **Models**: `claude-haiku-5-5` by default for speed and cost; `claude-sonnet-5-5` when tone matters. Effort per model is a setting (default low for Haiku, medium for Sonnet).
- **Structured output**: `client.beta.messages.parse(..., output_format=<Pydantic model>)`. The response is validated before it reaches the browser.
- **Prompt caching**: the system prompt is two cached blocks, the frozen instructions and then the glossary rendered in a fixed order. Editing the glossary re-writes only the second block. Cache hits show as "Prompt and glossary from cache" under a result.
- **Refusal fallback**: Sonnet requests send `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta. Haiku has no server-side fallback; a refusal is reported.
- **Offline fallback**: on no key, network failure or a 5xx, and only when enabled and Ollama has the model, the same prompt goes to Ollama's `/api/chat` with the JSON schema as `format`. Confidence is forced to low and the result is marked.

### Translation schema

`source_language`, `target_language`, `translation`, `tone`, `formality`, `action_requested`, `action_summary`, `deadline`, `ambiguities[] {phrase, issue, likely_meaning}`, `glossary_terms_used[]`, `unknown_terms[] {term, kind, guess}`, `confidence`, `confidence_reason`, `dialect_notes`.

### Reply schema

`reply`, `back_translation`, `formality_used`, `notes[]`, `cautions[]`, `needs_native_review`, `glossary_terms_used[]`, `confidence`.

## HTTP API

All bodies are JSON. Errors are `{"detail": "...", "code": "..."}`.

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Liveness |
| `POST /api/translate` | `{text, direction: auto/to_english/to_tagalog, model?: haiku/sonnet, save?, context?}` |
| `POST /api/compose` | `{text, formality: formal/casual/taglish, model?, save?, reply_to?, instructions?}` |
| `GET /api/glossary` | All entries |
| `POST /api/glossary` | `{term, meaning, kind, notes?}`; 409 on a duplicate term |
| `PATCH /api/glossary/{id}` | Partial update |
| `DELETE /api/glossary/{id}` | Delete |
| `GET /api/glossary/export` | CSV download |
| `POST /api/glossary/import` | Multipart CSV upload (`term,meaning,kind,notes`) |
| `POST /api/history/search` | `{q?, mode?, starred?, limit?, offset?}` |
| `GET /api/history/{id}` | Full item |
| `PATCH /api/history/{id}` | `{starred}` |
| `DELETE /api/history/{id}` | Delete one |
| `POST /api/history/clear` | `{confirm: "DELETE", keep_starred}` |
| `GET /api/settings`, `PATCH /api/settings` | Read and change settings |
| `PUT /api/settings/api-key`, `DELETE /api/settings/api-key` | Set or remove the key |
| `POST /api/settings/test` | Check the key |

Interactive docs: `/api/docs`.

Example:

```bash
curl -s http://10.246.248.60:8795/api/translate \
  -H 'Content-Type: application/json' \
  -d '{"text": "Pa-check naman po yung invoice, need daw ni MR by EOD", "save": false}'
```

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Container, FastAPI `/translate`, system prompt, JSON response | Done |
| 2 | React UI: paste box, direction toggle, result card with notes | Done |
| 3 | Glossary CRUD and injection, prompt caching on system prompt and glossary | Done |
| 4 | History, search, reply composer with register choice | Done |
| 5 | Clipboard hotkey, Ollama offline fallback, desktop launcher | Done |

## Interface standards

The frontend follows the Interface Craft playbook: semantic tokens with a separate dark palette, colour only on status tags, visible focus, 44 px targets, keyboard paths (<kbd>Ctrl</kbd>+<kbd>Enter</kbd> submits), reduced-motion support, no horizontal scroll at 360 px, every state designed (first use, loading, error with retry, empty after filters), undo for reversible deletes and typed confirmation for clearing history.
