export type ModelChoice = 'haiku' | 'sonnet';
export type Direction = 'auto' | 'to_english' | 'to_tagalog';
export type Formality = 'formal' | 'casual' | 'taglish';
export type Kind = 'person' | 'entity' | 'abbreviation' | 'term';
export type Confidence = 'high' | 'medium' | 'low';
export type Effort = 'low' | 'medium' | 'high';

export interface Ambiguity { phrase: string; issue: string; likely_meaning: string }
export interface UnknownTerm { term: string; kind: Kind; guess: string }

export interface TranslationOutput {
  source_language: 'tagalog' | 'english' | 'taglish' | 'other';
  target_language: 'english' | 'tagalog';
  translation: string;
  tone: string;
  formality: 'formal' | 'neutral' | 'casual' | 'taglish';
  action_requested: boolean;
  action_summary: string;
  deadline: string;
  ambiguities: Ambiguity[];
  glossary_terms_used: string[];
  unknown_terms: UnknownTerm[];
  confidence: Confidence;
  confidence_reason: string;
  dialect_notes: string;
}

export interface ComposeOutput {
  reply: string;
  back_translation: string;
  formality_used: Formality;
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

export interface TranslateResult { output: TranslationOutput; meta: CallMeta; history_id: number | null }
export interface ComposeResult {
  output: ComposeOutput; meta: CallMeta; history_id: number | null;
  request: { formality: Formality; reply_to: string };
}

export interface GlossaryEntry {
  id: number; term: string; meaning: string; kind: Kind; notes: string;
  created_at: string; updated_at: string;
}

export interface HistoryItem {
  id: number; created_at: string; mode: 'translate' | 'compose'; direction: string;
  model: string; provider: string; source_text: string; output_text: string; starred: boolean;
}
export interface HistoryDetail extends HistoryItem { result: TranslateResult | ComposeResult }

export interface Settings {
  default_model: ModelChoice;
  effort_haiku: Effort;
  effort_sonnet: Effort;
  save_history: boolean;
  retention_days: number;
  default_register: Formality;
  offline_fallback: boolean;
  api_key: { configured: boolean; hint: string };
  models: Record<ModelChoice, string>;
  offline: { model: string; available: boolean };
  version: string;
}

export interface ReplyDraftState { replyTo?: string }
