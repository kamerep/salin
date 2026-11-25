"""Write-only storage for the Anthropic API key.

The key lives in the service's env file (mode 600, owned by the service
user) so that systemd loads it on start. It is never returned by the API;
only a short hint ("sk-ant-…abcd") is exposed.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

KEY_NAME = "ANTHROPIC_API_KEY"
_lock = threading.Lock()


class KeyStore:
    def __init__(self, env_file: Path) -> None:
        self.env_file = env_file
        self._key = os.environ.get(KEY_NAME, "").strip() or self._read_file_key()

    def _read_lines(self) -> list[str]:
        try:
            return self.env_file.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            return []

    def _read_file_key(self) -> str:
        for line in self._read_lines():
            if line.startswith(f"{KEY_NAME}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
        return ""

    @property
    def key(self) -> str:
        return self._key

    @property
    def configured(self) -> bool:
        return bool(self._key)

    @property
    def hint(self) -> str:
        if not self._key:
            return ""
        return f"{self._key[:7]}…{self._key[-4:]}" if len(self._key) > 12 else "set"

    def _write(self, value: str | None) -> None:
        lines = [ln for ln in self._read_lines() if not ln.startswith(f"{KEY_NAME}=")]
        if value:
            lines.append(f"{KEY_NAME}={value}")
        self.env_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.env_file.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + ("\n" if lines else ""))
        os.replace(tmp, self.env_file)
        os.chmod(self.env_file, 0o600)

    def set(self, value: str) -> None:
        value = value.strip()
        with _lock:
            self._write(value)
            self._key = value

    def clear(self) -> None:
        with _lock:
            self._write(None)
            self._key = ""
