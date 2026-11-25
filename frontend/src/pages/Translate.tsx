import { ArrowLeftRight, ChevronRight, Languages, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api';
import { LanguageSelect } from '../components/LanguageSelect';
import { Recorder } from '../components/Recorder';
import { TranslationView } from '../components/results';
import { Kbd, Notice, ResultSkeleton, Segmented, Spinner, Switch, modKey, submitOnModEnter, useDelayed } from '../components/ui';
import { useDraft, useSettings } from '../state';
import type { ModelChoice, TranslateResult } from '../types';
import { PageHead } from './PageHead';

const MAX = 8000;
const EXAMPLE = 'Good morning po. Pa-check naman po yung invoice, need daw ni MR by EOD. Salamat po!';

export function ModelPicker({ value, onChange }: { value: ModelChoice; onChange: (m: ModelChoice) => void }) {
  return (
    <Segmented legend="Model" value={value} onChange={onChange}
      options={[{ value: 'haiku', label: 'Fast', sub: 'Haiku' }, { value: 'sonnet', label: 'Careful with tone', sub: 'Sonnet' }]} />
  );
}

export function NoKeyNotice() {
  const { settings } = useSettings();
  if (!settings || settings.api_key.configured) return null;
  return (
    <Notice tone="warn" title="No API key set">
      <p>
        {settings.offline_fallback && settings.offline.available
          ? `Requests go to the offline model (${settings.offline.model}) until you add a key. Quality is lower. `
          : 'Requests will fail until you add a key. '}
        <Link to="/settings">Add a key in Settings</Link>
      </p>
    </Notice>
  );
}

export default function Translate() {
  const { settings, enabled } = useSettings();
  const [text, setText] = useDraft('t.text', '');
  const [context, setContext] = useDraft('t.context', '');
  const [source, setSource] = useDraft('t.source', 'auto');
  const [targetSel, setTarget] = useDraft<string | null>('t.target', null);
  const target = targetSel ?? settings?.default_target ?? 'en';
  const [modelSel, setModel] = useDraft<ModelChoice | null>('t.model', null);
  const [saveSel, setSave] = useDraft<boolean | null>('t.save', null);
  const model = modelSel ?? settings?.default_model ?? 'haiku';
  const save = saveSel ?? settings?.save_history ?? true;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useDraft<{ data: TranslateResult; source: string } | null>('t.result', null);
  const abort = useRef<AbortController | null>(null);
  const showSkeleton = useDelayed(busy, 150);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function submit() {
    if (!text.trim() || busy || text.length > MAX) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    setError(null);
    try {
      const data = await api.translate({ text, source, target, model, save, context }, abort.current.signal);
      setResult({ data, source: text });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const tooLong = text.length > MAX;

  return (
    <>
      <PageHead title="Translate" desc="Paste or record a message in any of your languages. Salin reads it with your glossary." />
      <div className="page-body">
        <NoKeyNotice />
        <div className="work">
          <form className="panel stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="Message to translate">
            <div className="field">
              <div className="row-between">
                <label htmlFor="msg">Message</label>
                <span className={`hint counter ${tooLong ? 'field-error' : ''}`} id="msg-count">
                  {text.length.toLocaleString()} / {MAX.toLocaleString()}
                </span>
              </div>
              <textarea id="msg" ref={inputRef} className="textarea textarea-lg" value={text} spellCheck={false}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => submitOnModEnter(e, () => void submit())}
                placeholder="Paste the message here" aria-describedby="msg-count" aria-invalid={tooLong} autoFocus />
              {tooLong && <p className="field-error">Shorten the message to {MAX.toLocaleString()} characters or fewer.</p>}
              <Recorder language={source} onText={(t) => setText((cur) => (cur.trim() ? `${cur.trimEnd()}\n${t}` : t))} label="Record a message" />
            </div>

            <div className="pair">
              <LanguageSelect label="From" value={source} onChange={setSource} languages={enabled} auto />
              <button type="button" className="btn btn-icon pair-swap" aria-label="Swap languages" disabled={source === 'auto'}
                onClick={() => { setSource(target); setTarget(source); }}>
                <ArrowLeftRight size={18} aria-hidden="true" />
              </button>
              <LanguageSelect label="Into" value={target} onChange={setTarget} languages={enabled} />
            </div>
            {source === 'auto' && settings && (
              <p className="hint">If the message is already in the target language, it goes into {enabled.find((l) => l.code === settings.second_language)?.name ?? 'your second language'} instead.</p>
            )}
            <ModelPicker value={model} onChange={setModel} />

            <details className="more">
              <summary><ChevronRight size={16} aria-hidden="true" />Add context</summary>
              <div className="field" style={{ marginBlockStart: 8 }}>
                <label htmlFor="ctx">Who sent it, or what it is about</label>
                <textarea id="ctx" className="textarea" rows={3} value={context} maxLength={2000}
                  onChange={(e) => setContext(e.target.value)} placeholder="For example: from the accounts team about the March invoice" />
              </div>
            </details>

            <div className="row-between">
              <Switch checked={save} onChange={setSave} label="Save to history" />
              <button type="submit" className="btn btn-primary" disabled={busy || !text.trim() || tooLong}>
                {busy ? <Spinner /> : <Languages size={18} aria-hidden="true" />}
                {busy ? 'Translating' : 'Translate'}
                {!busy && <Kbd>{modKey} Enter</Kbd>}
              </button>
            </div>
          </form>

          <section className="panel" aria-live="polite" aria-busy={busy} aria-label="Result">
            {error && !busy && (
              <div className="stack">
                <Notice tone="bad" title="Translation failed"><p>{error.message}</p></Notice>
                <div className="row">
                  <button type="button" className="btn" onClick={() => void submit()}><RotateCcw size={16} aria-hidden="true" />Retry</button>
                  {(error.code === 'no_api_key' || error.code === 'bad_api_key') && <Link className="btn" to="/settings">Open Settings</Link>}
                </div>
              </div>
            )}
            {busy && showSkeleton && <ResultSkeleton />}
            {!busy && !error && result && <TranslationView output={result.data.output} meta={result.data.meta} source={result.source} />}
            {!busy && !error && !result && (
              <div className="empty">
                <h3>The translation appears here</h3>
                <p>You also get the tone, whether something is being asked of you, and any phrase that could be read two ways.</p>
                <button type="button" className="btn btn-sm" onClick={() => { setText(EXAMPLE); inputRef.current?.focus(); }}>
                  Use an example message
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
