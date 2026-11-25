export type ModelChoice = 'haiku' | 'sonnet';
export type Kind = 'person' | 'entity' | 'abbreviation' | 'term';
export type Confidence = 'high' | 'medium' | 'low';
export type Effort = 'low' | 'medium' | 'high';

export interface Ambiguity { phrase: string; issue: string; likely_meaning: string }
export interface UnknownTerm { term: string; kind: Kind; guess: string }

export interface RegisterDef { id: string; label: string; hint: string; instruction: string }
export interface Language {
  code: string; name: string; native_name: string; enabled: boolean; quality: 'strong' | 'weak';
  notes: string; registers: RegisterDef[]; speech_code: string; tts_code: string; sort: number;
  updated_at?: string;
}

export interface TranslationOutput {
  source_language: string;
  source_language_name: string;
  target_language: string;
  translation: string;
  tone: string;
  formality: string;
  action_requested: boolean;
  action_summary: string;
  deadline: string;
  ambiguities: Ambiguity[];
  glossary_terms_used: string[];
  unknown_terms: UnknownTerm[];
  confidence: Confidence;
  confidence_reason: string;
  dialect_notes: string;
  needs_native_review: boolean;
}

export interface ComposeOutput {
  reply: string;
  back_translation: string;
  register_used: string;
  notes: string[];
  cautions: string[];
  needs_native_review: boolean;
  glossary_terms_used: string[];
  confidence: Confidence;
}

export interface CallMeta {
  provider: 'claude' | 'ollama';
  model: ModelChoice;
  model_id: string;
  elapsed_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  fallback_used: boolean;
  request_id: string;
  warnings: string[];
}

export interface TranslateResult {
  output: TranslationOutput; meta: CallMeta; history_id: number | null;
  request?: { source: string; target: string };
}
export interface ComposeResult {
  output: ComposeOutput; meta: CallMeta; history_id: number | null;
  request: { target: string; register: RegisterDef; reply_to: string };
}

export interface GlossaryEntry {
  id: number; term: string; meaning: string; kind: Kind; notes: string;
  spellings: Record<string, string>; created_at: string; updated_at: string;
}

export interface HistoryItem {
  id: number; created_at: string; mode: 'translate' | 'compose'; direction: string;
  model: string; provider: string; source_text: string; output_text: string; starred: boolean;
  source_lang: string; target_lang: string;
}
export interface HistoryDetail extends HistoryItem { result: TranslateResult | ComposeResult }

export interface Settings {
  default_model: ModelChoice;
  effort_haiku: Effort;
  effort_sonnet: Effort;
  save_history: boolean;
  retention_days: number;
  offline_fallback: boolean;
  default_target: string;
  second_language: string;
  reply_language: string;
  speech_input: boolean;
  speech_model: 'base' | 'small' | 'medium';
  speech: { installed: boolean; model: string; downloaded: boolean; loaded: boolean; voices: string[] };
  api_key: { configured: boolean; hint: string };
  models: Record<ModelChoice, string>;
  offline: { model: string; available: boolean };
  version: string;
  local_url: string;
}

export interface ReplyDraftState { replyTo?: string }

export interface Transcript {
  text: string; language: string; language_probability: number; duration: number; warnings: string[];
}
