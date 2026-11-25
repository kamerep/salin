"""Runtime configuration, read from the environment (systemd EnvironmentFile)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class Config:
    data_dir: Path = field(default_factory=lambda: Path(_env("SALIN_DATA_DIR", "./var")))
    env_file: Path = field(default_factory=lambda: Path(_env("SALIN_ENV_FILE", "./var/salin.env")))
    static_dir: Path = field(
        default_factory=lambda: Path(
            _env("SALIN_STATIC_DIR", str(Path(__file__).resolve().parents[2] / "frontend" / "dist"))
        )
    )
    allowed_hosts: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            h.strip()
            for h in _env("SALIN_ALLOWED_HOSTS", "localhost,127.0.0.1,salin.lxd").split(",")
            if h.strip()
        )
    )
    ollama_url: str = field(default_factory=lambda: _env("SALIN_OLLAMA_URL", "http://127.0.0.1:11434"))
    ollama_model: str = field(default_factory=lambda: _env("SALIN_OLLAMA_MODEL", "llama3.1:8b"))

    @property
    def db_path(self) -> Path:
        return self.data_dir / "salin.db"


def load_config() -> Config:
    cfg = Config()
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    return cfg
