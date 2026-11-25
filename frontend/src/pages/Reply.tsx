import { ChevronRight, PenLine, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api';
import { LanguageSelect } from '../components/LanguageSelect';
import { Recorder } from '../components/Recorder';
import { ComposeView } from '../components/results';
import { Kbd, Notice, ResultSkeleton, Segmented, Spinner, Switch, modKey, submitOnModEnter, useDelayed } from '../components/ui';
import { useDraft, useSettings } from '../state';
import type { ComposeResult, ModelChoice, ReplyDraftState } from '../types';
import { PageHead } from './PageHead';
import { ModelPicker, NoKeyNotice } from './Translate';

const MAX = 8000;

export default function Reply() {
  const { settings, enabled } = useSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = (location.state as ReplyDraftState | null)?.replyTo ?? '';
  const [replyToDraft, setReplyTo] = useDraft('r.replyTo', '');
  const replyTo = incoming || replyToDraft;
  const [text, setText] = useDraft('r.text', '');
  const [instructions, setInstructions] = useDraft('r.instructions', '');
  const [targetSel, setTarget] = useDraft<string | null>('r.target', null);
  const [registerSel, setRegister] = useDraft<string | null>('r.register', null);
  const [modelSel, setModel] = useDraft<ModelChoice | null>('r.model', null);
  const [saveSel, setSave] = useDraft<boolean | null>('r.save', null);
  const target = targetSel ?? settings?.reply_language ?? 'tl';
  const lang = enabled.find((l) => l.code === target);
  const registers = lang?.registers ?? [];
  const register = registers.find((r) => r.id === registerSel) ?? registers[0];
  const model = modelSel ?? settings?.default_model ?? 'haiku';
  const save = saveSel ?? settings?.save_history ?? true;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useDraft<ComposeResult | null>('r.result', null);
  const abort = useRef<AbortController | null>(null);
  const showSkeleton = useDelayed(busy, 150);

  useEffect(() => {
    // Move incoming text into the draft, then drop the router state so a
    // reload does not keep client text in the browser's session history.
    if (incoming) {
      setReplyTo(incoming);
      setResult(null);
      navigate('.', { replace: true, state: null });
    }
  }, [incoming, navigate, setReplyTo, setResult]);
  useEffect(() => () => abort.current?.abort(), []);

  async function submit() {
    if (!text.trim() || busy || text.length > MAX) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.compose({ text, target, register_id: register?.id ?? '', model, save, reply_to: replyTo, instructions }, abort.current.signal));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Reply" desc="Write or dictate what you want to say in English. Salin drafts it in the language and register you pick." />
      <div className="page-body">
        <NoKeyNotice />
        <div className="work">
          <form className="panel stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="Reply draft">
            {replyTo ? (
              <div className="field">
                <div className="row-between">
                  <label htmlFor="rt">Replying to</label>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReplyTo('')}>
                    <X size={16} aria-hidden="true" />Remove
                  </button>
                </div>
                <textarea id="rt" className="textarea" rows={3} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} maxLength={MAX} />
              </div>
            ) : (
              <details className="more">
                <summary><ChevronRight size={16} aria-hidden="true" />Add the message you are replying to</summary>
                <div className="field" style={{ marginBlockStart: 8 }}>
                  <label htmlFor="rt2">Original message</label>
                  <textarea id="rt2" className="textarea" rows={3} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} maxLength={MAX} />
                </div>
              </details>
            )}

            <div className="field">
              <label htmlFor="draft">Your reply in English</label>
              <textarea id="draft" className="textarea textarea-lg" value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => submitOnModEnter(e, () => void submit())} maxLength={MAX}
                placeholder="Yes, I will check the invoice and send it to MR before 5 pm." autoFocus />
            </div>

            <Recorder language="en" onText={(t) => setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${t}` : t))} label="Dictate the draft" />

            <LanguageSelect label="Reply in" value={target} onChange={(c) => { setTarget(c); setRegister(null); }} languages={enabled} />
            {register && (
              <Segmented legend="Register" value={register.id} onChange={setRegister}
                options={registers.map((r) => ({ value: r.id, label: r.label, sub: r.hint || undefined }))} />
            )}
            <ModelPicker value={model} onChange={setModel} />

            <div className="field">
              <label htmlFor="ins">Extra instructions <span className="muted">(optional)</span></label>
              <input id="ins" className="input" value={instructions} maxLength={1000} onChange={(e) => setInstructions(e.target.value)}
                placeholder="Keep it short; I am writing to my manager" />
            </div>

            <div className="row-between">
              <Switch checked={save} onChange={setSave} label="Save to history" />
              <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
                {busy ? <Spinner /> : <PenLine size={18} aria-hidden="true" />}
                {busy ? 'Drafting' : 'Draft reply'}
                {!busy && <Kbd>{modKey} Enter</Kbd>}
              </button>
            </div>
          </form>

          <section className="panel" aria-live="polite" aria-busy={busy} aria-label="Drafted reply">
            {error && !busy && (
              <div className="stack">
                <Notice tone="bad" title="Could not draft the reply"><p>{error.message}</p></Notice>
                <div className="row">
                  <button type="button" className="btn" onClick={() => void submit()}><RotateCcw size={16} aria-hidden="true" />Retry</button>
                  {(error.code === 'no_api_key' || error.code === 'bad_api_key') && <Link className="btn" to="/settings">Open Settings</Link>}
                </div>
              </div>
            )}
            {busy && showSkeleton && <ResultSkeleton />}
            {!busy && !error && result && <ComposeView output={result.output} meta={result.meta} target={result.request.target} register={result.request.register} draft={text} onRegenerate={() => void submit()} busy={busy} />}
            {!busy && !error && !result && (
              <div className="empty">
                <h3>Your {lang?.name ?? "translated"} reply appears here</h3>
                <p>With an English back-translation so you can check it says what you meant.</p>
                <p className="small">For legal or regulatory messages to a client, have a native speaker check the reply before sending.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
