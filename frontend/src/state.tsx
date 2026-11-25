import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Language, Settings } from './types';

interface SettingsCtx {
  settings: Settings | null;
  languages: Language[];
  enabled: Language[];
  langName: (code: string) => string;
  reloadLanguages: () => Promise<void>;
  error: string | null;
  refresh: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<Settings>;
  setLocal: (s: Settings) => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<Language[]>([]);
  const reloadLanguages = useCallback(async () => {
    try { setLanguages(await api.languages()); } catch (e) { setError((e as Error).message); }
  }, []);
  const enabled = useMemo(() => languages.filter((l) => l.enabled), [languages]);
  const langName = useCallback((code: string) => {
    const l = languages.find((x) => x.code === code);
    if (l) return l.name;
    if (code === 'mixed') return 'Mixed';
    if (!code || code === 'other') return 'Other';
    return code;
  }, [languages]);
  const refresh = useCallback(async () => {
    try {
      setSettings(await api.settings());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.updateSettings(patch);
    setSettings(next);
    return next;
  }, []);
  useEffect(() => { void refresh(); void reloadLanguages(); }, [refresh, reloadLanguages]);
  return (
    <Ctx.Provider value={{ settings, error, refresh, update, setLocal: setSettings, languages, enabled, langName, reloadLanguages }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSettings() {
  const c = useContext(Ctx);
  if (!c) throw new Error('SettingsProvider missing');
  return c;
}

export type ThemeChoice = 'system' | 'light' | 'dark';
const THEME_KEY = 'salin.theme';

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch { /* storage blocked: theme still applies for this visit */ }
}

// In-memory drafts: typed text and results survive moving between pages,
// and are gone on reload (nothing client-sensitive is written to storage).
const drafts = new Map<string, unknown>();
export function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (drafts.has(key) ? (drafts.get(key) as T) : initial));
  useEffect(() => { drafts.set(key, value); }, [key, value]);
  return [value, setValue] as const;
}
