# Security and privacy

## What leaves the machine

Every request sends **the message, any context you add, and the whole glossary** to Anthropic's API. Messages often contain client names and entity details. Check that against your confidentiality obligations before using Salin for client material. The offline fallback (Ollama) keeps everything on the machine, at lower quality.

## API key

- Stored in `/etc/salin/salin.env` inside the container, mode 600, owned by the `salin` service user. Never in the repository.
- Write-only: Settings shows only a hint such as `sk-ant-a…abcd`; the API never returns the key.
- **Test key** checks it with a model lookup, which costs nothing.

## Network

- uvicorn listens on the container's bridge address only (default `10.246.248.60:8795`). There is no proxy device publishing it to the LAN.
- The only proxy device forwards *container* `127.0.0.1:11434` to *host* `127.0.0.1:11434` for Ollama.
- The server answers only to known host names (`SALIN_ALLOWED_HOSTS`) and refuses state-changing requests from other origins, so other pages and other containers' sites cannot drive it.

## Stored data

| Data | Where | Controls |
|---|---|---|
| Glossary | `/var/lib/salin/salin.db` (mode 600) | Edit, delete, export |
| History | same database | Per-request *Save to history*, save-by-default, automatic deletion, clear all |
| Backups | `/var/lib/salin/backups/` (mode 600, last 10) | Delete by hand |
| Theme choice | browser storage | Per browser |

Drafts you type stay in memory only and disappear on reload. The database, `.env` files and backups are excluded from Git.

## Web hardening

- Strict Content Security Policy: scripts, styles and fonts from the app itself only; no inline script; no framing.
- `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`.
- API responses are `Cache-Control: no-store`.
- History search is a POST, so search terms never appear in URLs; the access log is off and application logs carry token counts and request IDs, never message text.

## Service hardening

The systemd unit runs as the unprivileged `salin` user with `NoNewPrivileges`, `ProtectSystem=strict` (writable: `/var/lib/salin`, `/etc/salin` only), `ProtectHome`, `PrivateTmp`, `PrivateDevices`, no capabilities and a narrowed set of address families.

## Model output

- Message text is wrapped in tags and the system prompt treats it as data, not instructions.
- Refusals and truncated answers are reported, never shown as a translation.
- The careful model (Sonnet) uses Anthropic's server-side refusal fallback; when a fallback model answers, the result says so.
- For legal or regulatory Tagalog going to a client, a native speaker should check the text. Salin flags these cases.
