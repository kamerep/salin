"""Request and response models. The *Output models are the structured-output
schemas the model must fill; keep every field required (no defaults) so the
JSON schema stays strict and simple."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

ModelChoice = Literal["haiku", "sonnet"]
Kind = Literal["person", "entity", "abbreviation", "term"]
Confidence = Literal["high", "medium", "low"]
Effort = Literal["low", "medium", "high"]
Quality = Literal["strong", "weak"]

MAX_TEXT = 8000
LANG_CODE = r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$"
SLUG = r"^[a-z][a-z0-9_]{0,23}$"


# ---- structured outputs ---------------------------------------------------
class Ambiguity(BaseModel):
    phrase: str = Field(description="The exact words from the source that are unclear.")
    issue: str = Field(description="Why it is unclear, in one sentence.")
    likely_meaning: str = Field(description="Most likely reading, or 'unknown'.")


class UnknownTerm(BaseModel):
    term: str = Field(description="Name, abbreviation or jargon as written in the source.")
    kind: Kind
    guess: str = Field(description="Best guess at what it refers to, or 'unknown'.")


class TranslationOutput(BaseModel):
    source_language: str = Field(
        description="Code of the main source language from the language notes (e.g. 'tl'), "
        "'mixed' when two or more are mixed evenly, or 'other'."
    )
    source_language_name: str = Field(description="Human name, e.g. 'Taglish (Tagalog and English)'.")
    target_language: str = Field(description="Code of the language you translated into.")
    translation: str
    tone: str = Field(description="Two to six words, e.g. 'polite, slightly urgent'.")
    formality: str = Field(description="Register of the source, e.g. 'formal (po/opo)', 'casual'.")
    action_requested: bool
    action_summary: str = Field(description="What the sender wants done, or '' if nothing.")
    deadline: str = Field(description="Any date, time or deadline mentioned, or ''.")
    ambiguities: list[Ambiguity]
    glossary_terms_used: list[str] = Field(description="Glossary terms that appeared in the source.")
    unknown_terms: list[UnknownTerm]
    confidence: Confidence
    confidence_reason: str
    dialect_notes: str = Field(description="Regional language or dialect mixed in, or ''.")
    needs_native_review: bool = Field(
        description="True when a native speaker should check: weak language, dialect, "
        "legal or regulatory content."
    )


class ComposeOutput(BaseModel):
    reply: str = Field(description="The message in the target language, in the requested register.")
    back_translation: str = Field(description="Literal English rendering of the reply.")
    register_used: str = Field(description="The register id you used, from the request.")
    notes: list[str] = Field(description="Short notes on word choices the writer should know.")
    cautions: list[str] = Field(description="Risks: legal, regulatory, tone, or meaning changes.")
    needs_native_review: bool = Field(
        description="True for legal, regulatory, contractual or sensitive messages, or a weak language."
    )
    glossary_terms_used: list[str]
    confidence: Confidence


# ---- API requests ---------------------------------------------------------
class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    source: str = Field(default="auto", pattern=r"^(auto|[a-z]{2,3}(-[A-Za-z0-9]{2,8})?)$")
    target: str | None = Field(default=None, pattern=LANG_CODE)
    model: ModelChoice | None = None
    save: bool | None = None
    context: str = Field(default="", max_length=2000)


class ComposeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    target: str | None = Field(default=None, pattern=LANG_CODE)
    register_id: str | None = Field(default=None, pattern=SLUG)
    model: ModelChoice | None = None
    save: bool | None = None
    reply_to: str = Field(default="", max_length=MAX_TEXT)
    instructions: str = Field(default="", max_length=1000)


def _clean_spellings(v: dict[str, str] | None) -> dict[str, str] | None:
    if v is None:
        return None
    out = {}
    for code, text in v.items():
        code, text = code.strip().lower(), (text or "").strip()
        if not re.match(LANG_CODE, code):
            raise ValueError(f"'{code}' is not a language code")
        if len(text) > 200:
            raise ValueError("A spelling is limited to 200 characters")
        if text:
            out[code] = text
    if len(out) > 12:
        raise ValueError("At most 12 spellings per entry")
    return out


class GlossaryIn(BaseModel):
    term: str = Field(min_length=1, max_length=120)
    meaning: str = Field(min_length=1, max_length=400)
    kind: Kind = "term"
    notes: str = Field(default="", max_length=600)
    spellings: dict[str, str] = Field(default_factory=dict)

    @field_validator("spellings")
    @classmethod
    def clean_spellings(cls, v):
        return _clean_spellings(v)


class GlossaryPatch(BaseModel):
    term: str | None = Field(default=None, min_length=1, max_length=120)
    meaning: str | None = Field(default=None, min_length=1, max_length=400)
    kind: Kind | None = None
    notes: str | None = Field(default=None, max_length=600)
    spellings: dict[str, str] | None = None

    @field_validator("spellings")
    @classmethod
    def clean_spellings(cls, v):
        return _clean_spellings(v)


class RegisterDef(BaseModel):
    id: str = Field(pattern=SLUG)
    label: str = Field(min_length=1, max_length=40)
    hint: str = Field(default="", max_length=40)
    instruction: str = Field(min_length=1, max_length=400)


class LanguageIn(BaseModel):
    code: str = Field(pattern=LANG_CODE)
    name: str = Field(min_length=1, max_length=60)
    native_name: str = Field(default="", max_length=60)
    enabled: bool = True
    quality: Quality = "strong"
    notes: str = Field(default="", max_length=3000)
    registers: list[RegisterDef] = Field(min_length=1, max_length=6)
    speech_code: str = Field(default="", max_length=8, pattern=r"^([a-z]{2,3})?$")
    tts_code: str = Field(default="", max_length=20, pattern=r"^([a-z]{2,3}(-[A-Za-z0-9]{2,8})?)?$")
    sort: int = Field(default=100, ge=0, le=10000)

    @field_validator("registers")
    @classmethod
    def unique_registers(cls, v: list[RegisterDef]) -> list[RegisterDef]:
        ids = [r.id for r in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Register ids must be unique")
        return v


class LanguagePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    native_name: str | None = Field(default=None, max_length=60)
    enabled: bool | None = None
    quality: Quality | None = None
    notes: str | None = Field(default=None, max_length=3000)
    registers: list[RegisterDef] | None = Field(default=None, min_length=1, max_length=6)
    speech_code: str | None = Field(default=None, max_length=8, pattern=r"^([a-z]{2,3})?$")
    tts_code: str | None = Field(default=None, max_length=20, pattern=r"^([a-z]{2,3}(-[A-Za-z0-9]{2,8})?)?$")
    sort: int | None = Field(default=None, ge=0, le=10000)

    @field_validator("registers")
    @classmethod
    def unique_registers(cls, v):
        return v if v is None else LanguageIn.unique_registers(v)


class HistorySearch(BaseModel):
    q: str = Field(default="", max_length=200)
    mode: Literal["translate", "compose"] | None = None
    pair: str | None = Field(default=None, max_length=40, pattern=r"^[a-z\-]+>[a-z\-]+$")
    starred: bool = False
    limit: int = Field(default=30, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class StarIn(BaseModel):
    starred: bool


class ClearHistoryIn(BaseModel):
    confirm: Literal["DELETE"]
    keep_starred: bool = True


class ResetIn(BaseModel):
    confirm: Literal["RESET"]


class SettingsPatch(BaseModel):
    default_model: ModelChoice | None = None
    effort_haiku: Effort | None = None
    effort_sonnet: Effort | None = None
    save_history: bool | None = None
    retention_days: int | None = Field(default=None, ge=0, le=3650)
    offline_fallback: bool | None = None
    default_target: str | None = Field(default=None, pattern=LANG_CODE)
    second_language: str | None = Field(default=None, pattern=LANG_CODE)
    reply_language: str | None = Field(default=None, pattern=LANG_CODE)
    speech_input: bool | None = None
    speech_model: Literal["base", "small", "medium"] | None = None


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    lang: str = Field(pattern=LANG_CODE)


class ApiKeyIn(BaseModel):
    api_key: str = Field(min_length=20, max_length=400, pattern=r"^sk-ant-[A-Za-z0-9_\-]+$")
