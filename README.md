# Salin

*Salin* is Tagalog for "translation". It translates workplace messages written in Tagalog, English or the Taglish mix people really send, and drafts replies in Tagalog in the register you choose.

## What it does

- **Translate** pasted messages with the meaning, tone and formality kept, plus whether the sender is asking for something, any deadline, phrases that could be read two ways, and an honest confidence level. Regional dialects are flagged rather than guessed.
- **Taglish-aware**: shorthand like *po*, *daw*, *pa-check*, *notif* and *EOD* is read as normal office writing, never "corrected".
- **Glossary** of people, companies and abbreviations, sent with every request, so "MR" resolves to the right person without explaining it each time. Unknown names in a message can be added in one click. CSV import and export.
- **Reply composer**: write in English, get Tagalog back as *formal* (po/opo), *casual* or *office Taglish*, with an English back-translation and cautions. Legal or regulatory replies are flagged for a native speaker check.
- **History** with full-text search, stars, per-request "don't save", and automatic deletion.
- **Offline fallback** to a local model through Ollama, clearly marked and always low confidence.
- **Desktop feel**: dock launcher that opens Salin in its own window, and a clipboard-translate hotkey.
- Light and dark themes, keyboard friendly, works on a phone-width window.

## Quick start

Requires LXD, Node.js 20+, uv (or Python 3.12+) and an Anthropic API key from the Claude Console (API billing is separate from a claude.ai subscription).

```bash
git clone https://github.com/kamerep/salin.git && cd salin
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e "backend[dev]"
deploy/deploy.sh                       # container, service, health check
deploy/host/install-desktop.sh         # optional: launcher and hotkey
```

Open `http://10.246.248.60:8795`, go to **Settings** and add your API key.

## Documentation

Each topic is available as HTML and PDF:

| Topic | HTML | PDF |
|---|---|---|
| User guide | [docs/html/user-guide.html](docs/html/user-guide.html) | [docs/pdf/user-guide.pdf](docs/pdf/user-guide.pdf) |
| Setup and operations | [docs/html/setup.html](docs/html/setup.html) | [docs/pdf/setup.pdf](docs/pdf/setup.pdf) |
| Security and privacy | [docs/html/security-privacy.html](docs/html/security-privacy.html) | [docs/pdf/security-privacy.pdf](docs/pdf/security-privacy.pdf) |
| Architecture and API | [docs/html/architecture.html](docs/html/architecture.html) | [docs/pdf/architecture.pdf](docs/pdf/architecture.pdf) |

Sources are in `docs/src`; rebuild with `.venv/bin/python docs/build.py`.

## Privacy

Every request sends the message and your glossary to Anthropic's API. If messages contain client names or entity details, check that against your confidentiality obligations first. The glossary and history stay in the container's SQLite database, which is never committed.

## Limits

Machine translation is a draft. For legal or regulatory text going to a client, have a native speaker check the Tagalog.
