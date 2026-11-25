import { AlertTriangle, Check, Copy, Info, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Confidence } from '../types';

export interface SegOption<T extends string> { value: T; label: string; sub?: string }

export function Segmented<T extends string>({ legend, value, options, onChange, hideLegend }: {
  legend: string; value: T; options: SegOption<T>[]; onChange: (v: T) => void; hideLegend?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="fieldset">
      <legend className={hideLegend ? 'sr-only' : 'label legend'}>{legend}</legend>
      <div className="seg">
        {options.map((o) => (
          <label key={o.value}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
            {o.sub && <span className="seg-sub">{o.sub}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

const CONF: Record<Confidence, { cls: string; label: string }> = {
  high: { cls: 'tag-ok', label: 'High confidence' },
  medium: { cls: 'tag-warn', label: 'Medium confidence' },
  low: { cls: 'tag-bad', label: 'Low confidence' },
};

export function ConfidenceTag({ value }: { value: Confidence }) {
  const c = CONF[value];
  return <span className={`tag ${c.cls}`}>{c.label}</span>;
}

export function Tag({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad'; title?: string; children?: ReactNode }) {
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`notice ${tone !== 'info' ? `notice-${tone}` : ''}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon size={18} aria-hidden="true" />
      <div className="notice-body">
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context; fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1800);
  }
  return (
    <button type="button" className="btn btn-sm" onClick={copy}>
      {done ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      <span aria-live="polite">{done ? 'Copied' : label}</span>
    </button>
  );
}

/** True only after `ms` of `active`, so quick responses never flash a loader. */
export function useDelayed(active: boolean, ms = 150) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) { setShown(false); return; }
    const t = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(t);
  }, [active, ms]);
  return shown;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="spin" aria-hidden="true" />;
}

export function ResultSkeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      <span className="tall" />
      <span style={{ inlineSize: '60%' }} />
      <span style={{ inlineSize: '80%' }} />
      <span style={{ inlineSize: '45%' }} />
    </div>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel, danger, onConfirm, onClose, confirmDisabled }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onClose: () => void; confirmDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const titleId = useId();
  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      <form method="dialog" className="modal-body" onSubmit={(e) => { e.preventDefault(); onConfirm(); }}>
        <h2 id={titleId} className="panel-title">{title}</h2>
        {children}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={confirmDisabled}>{confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';

export function submitOnModEnter(e: React.KeyboardEvent, submit: () => void) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    submit();
  }
}
