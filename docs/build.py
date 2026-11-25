"""Build docs/src/*.md into docs/html/*.html and docs/pdf/*.pdf.

Usage: .venv/bin/python docs/build.py
Needs the `markdown` package and a Chromium-based browser for the PDFs
(set SALIN_PDF_BROWSER to its path if it is not found automatically).
"""

from __future__ import annotations

import html
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent
SRC, HTML, PDF = ROOT / "src", ROOT / "html", ROOT / "pdf"
ORDER = ["user-guide", "setup", "security-privacy", "architecture"]

CSS = """
:root { color-scheme: light dark; --bg:#fff; --text:#16201d; --muted:#52605b; --line:#d9dfdb;
  --sunk:#eef1ee; --accent:#0b5248; }
@media (prefers-color-scheme: dark) { :root { --bg:#0e1513; --text:#e4ebe7; --muted:#9db0a8;
  --line:#2a3833; --sunk:#151e1b; --accent:#9fe0d2; } }
body { margin:0; background:var(--bg); color:var(--text);
  font:16px/1.6 'IBM Plex Sans', system-ui, sans-serif; }
main { max-width: 820px; margin: 0 auto; padding: 32px 20px 64px; }
nav { display:flex; flex-wrap:wrap; gap:8px 16px; padding-bottom:16px; border-bottom:1px solid var(--line); }
nav a { color: var(--accent); }
h1 { font: 600 2rem/1.2 'Source Serif 4', Georgia, serif; margin: 24px 0 12px; }
h2 { font-size: 1.3rem; margin: 32px 0 8px; } h3 { font-size: 1.05rem; margin: 24px 0 6px; }
a { color: var(--accent); }
code, kbd { font: 0.9em 'IBM Plex Mono', ui-monospace, monospace; background: var(--sunk);
  border:1px solid var(--line); border-radius:4px; padding:1px 5px; }
pre { background: var(--sunk); border:1px solid var(--line); border-radius:8px; padding:12px 14px;
  overflow-x:auto; } pre code { border:0; padding:0; background:none; }
table { border-collapse: collapse; width:100%; margin: 12px 0; font-size: 0.95rem; }
th, td { text-align:start; border-bottom:1px solid var(--line); padding:8px 10px; vertical-align:top; }
th { color: var(--muted); font-size: 0.85rem; }
@media print { nav { display:none; } main { padding: 0; } pre { white-space: pre-wrap; } }
"""


def title_of(text: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return "Salin"


def browser() -> str | None:
    cands = [os.environ.get("SALIN_PDF_BROWSER", "")]
    pw = Path.home() / ".cache/ms-playwright"
    cands += [str(p) for p in sorted(pw.glob("chromium-*/chrome-linux64/chrome"))]
    cands += [shutil.which(n) or "" for n in ("chromium", "google-chrome", "brave-browser")]
    return next((c for c in cands if c and Path(c).exists()), None)


def main() -> None:
    HTML.mkdir(exist_ok=True)
    PDF.mkdir(exist_ok=True)
    pages = [(name, (SRC / f"{name}.md").read_text(encoding="utf-8")) for name in ORDER]
    nav = "".join(f'<a href="{n}.html">{html.escape(title_of(t))}</a>' for n, t in pages)
    exe = browser()
    for name, text in pages:
        body = markdown.markdown(text, extensions=["tables", "fenced_code"])
        title = title_of(text)
        doc = (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
               f'<meta name="viewport" content="width=device-width, initial-scale=1">'
               f"<title>{html.escape(title)} | Salin</title><style>{CSS}</style></head>"
               f"<body><main><nav>{nav}</nav>{body}</main></body></html>")
        out = HTML / f"{name}.html"
        out.write_text(doc, encoding="utf-8")
        if exe:
            with tempfile.TemporaryDirectory() as profile:
                subprocess.run(
                    [exe, "--headless", "--disable-gpu", "--no-sandbox", f"--user-data-dir={profile}",
                     "--no-pdf-header-footer", f"--print-to-pdf={PDF / f'{name}.pdf'}", out.as_uri()],
                    check=True, capture_output=True, timeout=120,
                )
        print(f"built {name}" + ("" if exe else " (no browser found: HTML only)"))


if __name__ == "__main__":
    main()
