import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastItem { id: number; message: string; tone: 'info' | 'bad'; action?: { label: string; run: () => void } }
interface ToastApi { show: (message: string, opts?: { tone?: 'info' | 'bad'; action?: ToastItem['action']; ms?: number }) => void }

const Ctx = createContext<ToastApi>({ show: () => undefined });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastApi['show']>((message, opts = {}) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { id, message, tone: opts.tone ?? 'info', action: opts.action }]);
    window.setTimeout(() => dismiss(id), opts.ms ?? (opts.action ? 8000 : 4500));
  }, [dismiss]);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'bad' ? 'toast-bad' : ''}`}>
            <p>{t.message}</p>
            {t.action && (
              <button type="button" className="btn btn-sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
            <button type="button" className="btn btn-sm btn-icon btn-ghost" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
