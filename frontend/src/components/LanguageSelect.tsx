import { useId } from 'react';
import type { Language } from '../types';

export function LanguageSelect({ label, value, onChange, languages, auto, hideLabel }: {
  label: string; value: string; onChange: (code: string) => void; languages: Language[];
  auto?: boolean; hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {auto && <option value="auto">Detect language</option>}
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}{l.quality === 'weak' ? ' (check with a native speaker)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
