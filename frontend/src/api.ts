import type {
  ComposeResult, GlossaryEntry, HistoryDetail, HistoryItem, Kind, Language,
  ModelChoice, Settings, Transcript, TranslateResult,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

function detailMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string; loc?: unknown[] };
    const field = Array.isArray(first.loc) ? String(first.loc[first.loc.length - 1]) : '';
    return field ? `${field}: ${first.msg}` : String(first.msg ?? 'Invalid input.');
  }
  return 'Something went wrong.';
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal,
      headers: body instanceof FormData || body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Salin is not reachable. Check that the container is running.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, detailMessage((data as { detail?: unknown }).detail), (data as { code?: string }).code);
  return data as T;
}

export const api = {
  translate: (b: { text: string; source: string; target: string; model: ModelChoice; save: boolean; context?: string }, signal?: AbortSignal) =>
    request<TranslateResult>('POST', '/api/translate', b, signal),
  compose: (b: { text: string; target: string; register_id: string; model: ModelChoice; save: boolean; reply_to?: string; instructions?: string }, signal?: AbortSignal) =>
    request<ComposeResult>('POST', '/api/compose', b, signal),

  languages: () => request<Language[]>('GET', '/api/languages'),
  addLanguage: (b: Omit<Language, 'updated_at'>) => request<Language>('POST', '/api/languages', b),
  updateLanguage: (code: string, b: Partial<Language>) => request<Language>('PATCH', `/api/languages/${code}`, b),
  deleteLanguage: (code: string) => request<void>('DELETE', `/api/languages/${code}`),
  resetLanguages: () => request<Language[]>('POST', '/api/languages/reset', { confirm: 'RESET' }),

  transcribe: (audio: Blob, language: string, signal?: AbortSignal) => {
    const fd = new FormData();
    fd.append('file', audio, 'recording.webm');
    fd.append('language', language);
    return request<Transcript>('POST', '/api/transcribe', fd, signal);
  },
  speak: async (text: string, lang: string): Promise<Blob> => {
    const res = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new ApiError(res.status, detailMessage((d as { detail?: unknown }).detail));
    }
    return res.blob();
  },

  glossary: () => request<GlossaryEntry[]>('GET', '/api/glossary'),
  addTerm: (b: { term: string; meaning: string; kind: Kind; notes?: string; spellings?: Record<string, string> }) => request<GlossaryEntry>('POST', '/api/glossary', b),
  updateTerm: (id: number, b: Partial<Pick<GlossaryEntry, 'term' | 'meaning' | 'kind' | 'notes' | 'spellings'>>) =>
    request<GlossaryEntry>('PATCH', `/api/glossary/${id}`, b),
  deleteTerm: (id: number) => request<void>('DELETE', `/api/glossary/${id}`),
  importGlossary: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ created: number; updated: number; skipped_rows: number[] }>('POST', '/api/glossary/import', fd);
  },

  history: (b: { q?: string; mode?: 'translate' | 'compose' | null; pair?: string | null; starred?: boolean; limit?: number; offset?: number }, signal?: AbortSignal) =>
    request<{ items: HistoryItem[]; total: number }>('POST', '/api/history/search', b, signal),
  historyPairs: () => request<{ source_lang: string; target_lang: string; n: number }[]>('GET', '/api/history/pairs'),
  historyItem: (id: number) => request<HistoryDetail>('GET', `/api/history/${id}`),
  star: (id: number, starred: boolean) => request<{ id: number; starred: boolean }>('PATCH', `/api/history/${id}`, { starred }),
  deleteHistory: (id: number) => request<void>('DELETE', `/api/history/${id}`),
  clearHistory: (keep_starred: boolean) => request<{ deleted: number }>('POST', '/api/history/clear', { confirm: 'DELETE', keep_starred }),

  settings: () => request<Settings>('GET', '/api/settings'),
  updateSettings: (b: Partial<Settings>) => request<Settings>('PATCH', '/api/settings', b),
  setKey: (api_key: string) => request<{ configured: boolean; hint: string }>('PUT', '/api/settings/api-key', { api_key }),
  clearKey: () => request<{ configured: boolean; hint: string }>('DELETE', '/api/settings/api-key'),
  testKey: () => request<{ ok: boolean; message: string }>('POST', '/api/settings/test'),
};
