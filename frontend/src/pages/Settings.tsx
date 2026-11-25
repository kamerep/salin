import { KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/toast';
import { ConfirmDialog, Notice, Segmented, Spinner, Switch, Tag } from '../components/ui';
import { applyTheme, readTheme, useSettings, type ThemeChoice } from '../state';
import type { Effort, Settings as S } from '../types';
import { PageHead } from './PageHead';

const EFFORT_OPTS: { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
];

function ApiKeySection({ s }: { s: S }) {
  const toast = useToast();
  const { setLocal, refresh } = useSettings();
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!/^sk-ant-[A-Za-z0-9_-]{12,}$/.test(key.trim())) {
      setError('That does not look like an Anthropic API key. It starts with sk-ant-.');
      return;
    }
    setBusy('save');
    try {
      const r = await api.setKey(key.trim());
      setLocal({ ...s, api_key: r });
      setKey('');
      setError('');
      toast.show('Key saved.');
      await test();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    setTestMsg(null);
    try {
      const r = await api.testKey();
      setTestMsg({ ok: true, text: r.message });
    } catch (err) {
      setTestMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setConfirm(false);
    try {
      await api.clearKey();
      await refresh();
      setTestMsg(null);
      toast.show('Key removed.');
    } catch (err) {
      toast.show((err as Error).message, { tone: 'bad' });
    }
  }

  return (
    <section className="panel" aria-labelledby="key-h">
      <div className="panel-head">
        <h2 id="key-h" className="panel-title">Anthropic API key</h2>
        {s.api_key.configured ? <Tag tone="ok">Set</Tag> : <Tag tone="warn">Not set</Tag>}
      </div>
      <div className="stack">
        <p className="muted">
          Salin calls the Claude API with your own key, billed per use in the Claude Console. A claude.ai subscription cannot be used here.
          The key is written to the container's env file (readable only by the service) and is never shown again.
        </p>
        {s.api_key.configured && <p>Current key: <code>{s.api_key.hint}</code></p>}
        <form className="key-form" onSubmit={save} noValidate>
          <div className="field">
            <label htmlFor="key">{s.api_key.configured ? 'Replace key' : 'Key'}</label>
            <input id="key" className="input" type="password" autoComplete="off" spellCheck={false} value={key}
              onChange={(e) => { setKey(e.target.value); setError(''); }} placeholder="sk-ant-..."
              aria-invalid={!!error} aria-describedby={error ? 'key-e' : undefined} />
            {error && <p id="key-e" className="field-error">{error}</p>}
          </div>
          <div className="row" style={{ alignSelf: 'end' }}>
            <button type="submit" className="btn btn-primary" disabled={!key || busy !== null}>
              {busy === 'save' ? <Spinner /> : <KeyRound size={18} aria-hidden="true" />}Save key
            </button>
          </div>
        </form>
        <div className="row">
          <button type="button" className="btn" onClick={() => void test()} disabled={!s.api_key.configured || busy !== null}>
            {busy === 'test' ? <Spinner /> : <ShieldCheck size={18} aria-hidden="true" />}Test key
          </button>
          {s.api_key.configured && <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>Remove key</button>}
        </div>
        {testMsg && <div aria-live="polite">{testMsg.ok ? <Tag tone="ok">{testMsg.text}</Tag> : <Notice tone="bad"><p>{testMsg.text}</p></Notice>}</div>}
      </div>
      <ConfirmDialog open={confirm} title="Remove the API key?" confirmLabel="Remove key" danger onConfirm={() => void remove()} onClose={() => setConfirm(false)}>
        <p>Requests will use the offline model, if it is available, until you add a key again.</p>
      </ConfirmDialog>
    </section>
  );
}

export default function Settings() {
  const { settings: s, update, error } = useSettings();
  const toast = useToast();
  const [theme, setTheme] = useState<ThemeChoice>(readTheme());

  async function change(patch: Partial<S>) {
    try {
      await update(patch);
      toast.show('Saved.');
    } catch (e) {
      toast.show((e as Error).message, { tone: 'bad' });
    }
  }

  return (
    <>
      <PageHead title="Settings" desc="Changes save as soon as you make them." />
      <div className="page-body">
        {error && <Notice tone="bad" title="Could not load settings"><p>{error}</p></Notice>}
        {!s && !error && <p className="muted"><Spinner /> Loading</p>}
        {s && (
          <div className="settings">
            <ApiKeySection s={s} />

            <section className="panel" aria-labelledby="models-h">
              <div className="panel-head"><h2 id="models-h" className="panel-title">Models</h2></div>
              <div className="setting">
                <div className="setting-text">
                  <span className="setting-name">Default model</span>
                  <span className="hint">Fast uses {s.models.haiku}. Careful uses {s.models.sonnet}, better when tone matters.</span>
                </div>
                <Segmented legend="Default model" hideLegend value={s.default_model} onChange={(v) => void change({ default_model: v })}
                  options={[{ value: 'haiku', label: 'Fast' }, { value: 'sonnet', label: 'Careful' }]} />
              </div>
              <div className="setting">
                <div className="setting-text">
                  <span className="setting-name">Effort, fast model</span>
                  <span className="hint">Higher effort thinks longer: slower and costs more.</span>
                </div>
                <Segmented legend="Effort for the fast model" hideLegend value={s.effort_haiku} onChange={(v) => void change({ effort_haiku: v })} options={EFFORT_OPTS} />
              </div>
              <div className="setting">
                <div className="setting-text"><span className="setting-name">Effort, careful model</span></div>
                <Segmented legend="Effort for the careful model" hideLegend value={s.effort_sonnet} onChange={(v) => void change({ effort_sonnet: v })} options={EFFORT_OPTS} />
              </div>
              <div className="setting">
                <div className="setting-text"><span className="setting-name">Default reply register</span></div>
                <Segmented legend="Default reply register" hideLegend value={s.default_register} onChange={(v) => void change({ default_register: v })}
                  options={[{ value: 'formal', label: 'Formal' }, { value: 'casual', label: 'Casual' }, { value: 'taglish', label: 'Office Taglish' }]} />
              </div>
            </section>

            <section className="panel" aria-labelledby="priv-h">
              <div className="panel-head"><h2 id="priv-h" className="panel-title">Privacy</h2></div>
              <Notice title="Every request sends the message and your glossary to Anthropic's API">
                <p>Messages often contain client names and entity details. Check that against your confidentiality obligations before using Salin for client material.</p>
              </Notice>
              <div className="setting" style={{ marginBlockStart: 16 }}>
                <div className="setting-text">
                  <span className="setting-name">Save to history by default</span>
                  <span className="hint">You can still switch it per request.</span>
                </div>
                <Switch checked={s.save_history} onChange={(v) => void change({ save_history: v })} label={<span className="sr-only">Save to history by default</span>} />
              </div>
              <div className="setting">
                <div className="setting-text">
                  <label className="setting-name" htmlFor="ret">Delete history after</label>
                  <span className="hint">Starred items are kept.</span>
                </div>
                <select id="ret" className="select" style={{ inlineSize: 'auto' }} value={s.retention_days}
                  onChange={(e) => void change({ retention_days: Number(e.target.value) })}>
                  <option value={0}>Never</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={365}>1 year</option>
                </select>
              </div>
            </section>

            <section className="panel" aria-labelledby="off-h">
              <div className="panel-head">
                <h2 id="off-h" className="panel-title">Offline fallback</h2>
                {s.offline.available ? <Tag tone="ok">Available</Tag> : <Tag tone="bad">Not reachable</Tag>}
              </div>
              <div className="setting">
                <div className="setting-text">
                  <span className="setting-name">Use the local model when Claude cannot be reached</span>
                  <span className="hint">Runs {s.offline.model} through Ollama on this computer. Results are marked and always low confidence.</span>
                </div>
                <Switch checked={s.offline_fallback} onChange={(v) => void change({ offline_fallback: v })} label={<span className="sr-only">Offline fallback</span>} />
              </div>
            </section>

            <section className="panel" aria-labelledby="look-h">
              <div className="panel-head"><h2 id="look-h" className="panel-title">Appearance</h2></div>
              <div className="setting">
                <div className="setting-text"><span className="setting-name">Theme</span><span className="hint">Saved in this browser only.</span></div>
                <Segmented legend="Theme" hideLegend value={theme} onChange={(v) => { setTheme(v); applyTheme(v); }}
                  options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
              </div>
            </section>

            <p className="hint">Salin {s.version}</p>
          </div>
        )}
      </div>
    </>
  );
}
