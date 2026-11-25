"""Local speech: transcription with faster-whisper and speech output with
espeak-ng. Audio never leaves the container; only the transcript is sent
on when the person chooses to translate it."""

from __future__ import annotations

import logging
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger("salin.speech")

# espeak-ng voices for languages it supports; Tagalog, Cebuano and Ilocano
# have none, so those fall back to the browser's voices when present.
ESPEAK_VOICES = {"en": "en-gb", "sw": "sw", "es": "es", "fr": "fr-fr", "de": "de"}


class SpeechError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class Transcriber:
    def __init__(self, models_dir: Path) -> None:
        self.models_dir = models_dir
        self._model: Any = None
        self._size = ""
        self._lock = threading.Lock()

    @staticmethod
    def installed() -> bool:
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return False
        return True

    def status(self, size: str) -> dict[str, Any]:
        cached = any(self.models_dir.glob(f"models--Systran--faster-whisper-{size}"))
        return {"installed": self.installed(), "model": size, "downloaded": cached,
                "loaded": self._size == size and self._model is not None}

    def _load(self, size: str):
        if self._model is None or self._size != size:
            from faster_whisper import WhisperModel

            log.info("loading whisper model %s", size)
            self.models_dir.mkdir(parents=True, exist_ok=True)
            self._model = WhisperModel(size, device="cpu", compute_type="int8",
                                       download_root=str(self.models_dir))
            self._size = size
        return self._model

    def transcribe(self, path: Path, *, size: str, language: str | None) -> dict[str, Any]:
        if not self.installed():
            raise SpeechError(503, "Speech input is not installed on the server.")
        with self._lock:  # one transcription at a time keeps CPU use predictable
            try:
                model = self._load(size)
            except Exception as e:  # download or load failure
                log.warning("whisper load failed: %s", e)
                raise SpeechError(503, "The speech model could not be loaded. "
                                       "The first use downloads it and needs internet.") from e
            try:
                segments, info = model.transcribe(str(path), language=language, vad_filter=True,
                                                  beam_size=5)
                text = " ".join(s.text.strip() for s in segments).strip()
            except Exception as e:
                log.warning("whisper transcription failed: %s", type(e).__name__)
                raise SpeechError(422, "The recording could not be read. Try again.") from e
        return {"text": text, "language": info.language,
                "language_probability": round(float(info.language_probability), 2),
                "duration": round(float(info.duration), 1)}


class Speaker:
    @staticmethod
    def available() -> bool:
        return shutil.which("espeak-ng") is not None

    @staticmethod
    def voices() -> list[str]:
        return sorted(ESPEAK_VOICES) if Speaker.available() else []

    @staticmethod
    def speak(text: str, lang: str) -> bytes:
        voice = ESPEAK_VOICES.get(lang.split("-")[0])
        if not voice or not Speaker.available():
            raise SpeechError(404, "No offline voice for this language.")
        try:
            out = subprocess.run(["espeak-ng", "-v", voice, "-s", "150", "--stdout", "--stdin"],
                                 input=text.encode("utf-8"), capture_output=True, timeout=60,
                                 check=True)
        except (subprocess.SubprocessError, OSError) as e:
            raise SpeechError(500, "Speech output failed.") from e
        return out.stdout
