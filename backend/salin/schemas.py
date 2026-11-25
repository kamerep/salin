"""Request and response models. The *Output models are the structured-output
schemas the model must fill; keep every field required (no defaults) so the
JSON schema stays strict and simple."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ModelChoice = Literal["haiku", "sonnet"]
Direction = Literal["auto", "to_english", "to_tagalog"]
Register = Literal["formal", "casual", "taglish"]
Kind = Literal["person", "entity", "abbreviation", "term"]
Confidence = Literal["high", "medium", "low"]
Effort = Literal["low", "medium", "high"]

MAX_TEXT = 8000


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
    source_language: Literal["tagalog", "english", "taglish", "other"]
    target_language: Literal["english", "tagalog"]
    translation: str
    tone: str = Field(description="Two to six words, e.g. 'polite, slightly urgent'.")
    formality: Literal["formal", "neutral", "casual", "taglish"]
    action_requested: bool
    action_summary: str = Field(description="What the sender wants done, or '' if nothing.")
    deadline: str = Field(description="Any date, time or deadline mentioned, or ''.")
    ambiguities: list[Ambiguity]
    glossary_terms_used: list[str] = Field(description="Glossary terms that appeared in the source.")
    unknown_terms: list[UnknownTerm]
    confidence: Confidence
    confidence_reason: str
    dialect_notes: str = Field(description="Regional language mixed in (Bisaya, Ilocano...), or ''.")


class ComposeOutput(BaseModel):
    reply: str = Field(description="The message in Tagalog, in the requested register.")
    back_translation: str = Field(description="Literal English rendering of the reply.")
    formality_used: Register
    notes: list[str] = Field(description="Short notes on word choices the writer should know.")
    cautions: list[str] = Field(description="Risks: legal, regulatory, tone, or meaning changes.")
    needs_native_review: bool = Field(
        description="True when the message is legal, regulatory, contractual or sensitive."
    )
    glossary_terms_used: list[str]
    confidence: Confidence


# ---- API requests ---------------------------------------------------------
class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    direction: Direction = "auto"
    model: ModelChoice | None = None
    save: bool | None = None
    context: str = Field(default="", max_length=2000)


class ComposeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    formality: Register = "formal"
    model: ModelChoice | None = None
    save: bool | None = None
    reply_to: str = Field(default="", max_length=MAX_TEXT)
    instructions: str = Field(default="", max_length=1000)


class GlossaryIn(BaseModel):
    term: str = Field(min_length=1, max_length=120)
    meaning: str = Field(min_length=1, max_length=400)
    kind: Kind = "term"
    notes: str = Field(default="", max_length=600)


class GlossaryPatch(BaseModel):
    term: str | None = Field(default=None, min_length=1, max_length=120)
    meaning: str | None = Field(default=None, min_length=1, max_length=400)
    kind: Kind | None = None
    notes: str | None = Field(default=None, max_length=600)


class HistorySearch(BaseModel):
    q: str = Field(default="", max_length=200)
    mode: Literal["translate", "compose"] | None = None
    starred: bool = False
    limit: int = Field(default=30, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class StarIn(BaseModel):
    starred: bool


class ClearHistoryIn(BaseModel):
    confirm: Literal["DELETE"]
    keep_starred: bool = True


class SettingsPatch(BaseModel):
    default_model: ModelChoice | None = None
    effort_haiku: Effort | None = None
    effort_sonnet: Effort | None = None
    save_history: bool | None = None
    retention_days: int | None = Field(default=None, ge=0, le=3650)
    default_register: Register | None = None
    offline_fallback: bool | None = None


class ApiKeyIn(BaseModel):
    api_key: str = Field(min_length=20, max_length=400, pattern=r"^sk-ant-[A-Za-z0-9_\-]+$")
