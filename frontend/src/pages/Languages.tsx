import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/toast';
import { ConfirmDialog, Notice, Spinner, Switch, Tag } from '../components/ui';
import { useSettings } from '../state';
import type { Language, RegisterDef } from '../types';
import { PageHead } from './PageHead';

function Crumbs({ current }: { current?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <Link to="/settings">Settings</Link>
      <ChevronRight size={14} aria-hidden="true" />
      {current ? <Link to="/settings/languages">Languages</Link> : <span aria-current="page">Languages</span>}
      {current && (<><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{current}</span></>)}
    </nav>
  );
}

export function LanguageList() {
  const { languages, reloadLanguages, settings } = useSettings();
  const toast = useToast();
  const navigate = useNavigate();
  const [reset, setReset] = useState(false);
  const [resetText, setResetText] = useState('');

  async function toggle(l: Language, enabled: boolean) {
    try {
      await api.updateLanguage(l.code, { enabled });
      await reloadLanguages();
      toast.show(`${l.name} ${enabled ? 'turned on' : 'turned off'}.`);
    } catch (e) { toast.show((e as Error).message, { tone: 'bad' }); }
  }

  async function doReset() {
    try {
      await api.resetLanguages();
      await reloadLanguages();
      toast.show('Languages reset to the defaults.');
    } catch (e) { toast.show((e as Error).message, { tone: 'bad' }); }
    setReset(false);
    setResetText('');
  }

  const defaults = new Set([settings?.default_target, settings?.reply_language]);
  return (
    <>
      <PageHead title="Languages" desc="Which languages Salin offers, what it should know about each, and the reply registers for each."
        actions={<button type="button" className="btn btn-primary" onClick={() => navigate('/settings/languages/new')}><Plus size={18} aria-hidden="true" />Add language</button>} />
      <div className="page-body">
        <Crumbs />
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Languages</caption>
            <thead><tr><th scope="col">Language</th><th scope="col">Reliability</th><th scope="col">Registers</th><th scope="col">Voice</th><th scope="col">On</th></tr></thead>
            <tbody>
              {languages.map((l) => (
                <tr key={l.code}>
                  <td className="term"><Link to={`/settings/languages/${l.code}`}>{l.name}</Link> <span className="muted small">{l.code}</span></td>
                  <td>{l.quality === 'weak' ? <Tag tone="warn">Native check advised</Tag> : <Tag tone="ok">Reliable</Tag>}</td>
                  <td className="muted">{l.registers.map((r) => r.label).join(', ')}</td>
                  <td className="muted">{[l.speech_code && 'record', settings?.speech.voices.includes(l.code) && 'listen'].filter(Boolean).join(', ') || 'none'}</td>
                  <td>
                    <Switch checked={l.enabled} disabled={defaults.has(l.code)} onChange={(v) => void toggle(l, v)}
                      label={<span className="sr-only">{l.name} {defaults.has(l.code) ? '(a default language, change defaults in Settings first)' : ''}</span>} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button type="button" className="btn btn-danger" onClick={() => setReset(true)}>Reset to defaults</button>
        </div>
      </div>
      <ConfirmDialog open={reset} title="Reset languages" confirmLabel="Reset" danger confirmDisabled={resetText !== 'RESET'}
        onConfirm={() => void doReset()} onClose={() => { setReset(false); setResetText(''); }}>
        <p>Your changes to languages, notes and registers are replaced by the defaults. History and the glossary are not touched.</p>
        <div className="field">
          <label htmlFor="rst">Type RESET to confirm</label>
          <input id="rst" className="input" value={resetText} onChange={(e) => setResetText(e.target.value)} autoComplete="off" />
        </div>
      </ConfirmDialog>
    </>
  );
}

const BLANK: Language = {
  code: '', name: '', native_name: '', enabled: true, quality: 'strong', notes: '', sort: 100,
  speech_code: '', tts_code: '',
  registers: [{ id: 'formal', label: 'Formal', hint: '', instruction: 'Polite and respectful, for a client, senior or official.' },
    { id: 'casual', label: 'Casual', hint: '', instruction: 'Friendly everyday language for colleagues.' }],
};

export function LanguageForm() {
  const { code = 'new' } = useParams();
  const isNew = code === 'new';
  const { languages, reloadLanguages } = useSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = languages.find((l) => l.code === code);
  const [d, setD] = useState<Language | null>(isNew ? BLANK : existing ?? null);
  const [errors, setErrors] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { if (!isNew && existing && !d) setD(existing); }, [existing, isNew, d]);

  if (!d) {
    return (
      <>
        <PageHead title="Language" />
        <div className="page-body"><Crumbs current="Not found" />{languages.length ? <p>That language does not exist.</p> : <p className="muted"><Spinner /> Loading</p>}</div>
      </>
    );
  }

  const set = <K extends keyof Language>(k: K, v: Language[K]) => setD({ ...d, [k]: v });
  const setReg = (i: number, patch: Partial<RegisterDef>) =>
    set('registers', d.registers.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!d) return;
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(d.code)) { setErrors('The code is two or three lowercase letters, such as "ja" or "ceb".'); return; }
    if (!d.name.trim()) { setErrors('Give the language a name.'); return; }
    if (d.registers.some((r) => !/^[a-z][a-z0-9_]{0,23}$/.test(r.id) || !r.label.trim() || !r.instruction.trim())) {
      setErrors('Each register needs an id (lowercase letters), a label and an instruction.');
      return;
    }
    setBusy(true);
    setErrors('');
    try {
      const { updated_at: _u, ...body } = d;
      void _u;
      if (isNew) await api.addLanguage(body);
      else {
        const { code: _c, ...patch } = body;
        void _c;
        await api.updateLanguage(d.code, patch);
      }
      await reloadLanguages();
      toast.show(`Saved ${d.name}.`);
      navigate('/settings/languages');
    } catch (err) {
      setErrors((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await api.deleteLanguage(d!.code);
      await reloadLanguages();
      toast.show(`Deleted ${d!.name}. Reset to defaults to get a default language back.`);
      navigate('/settings/languages');
    } catch (err) {
      setErrors((err as Error).message);
    }
    setConfirmDelete(false);
  }

  return (
    <>
      <PageHead title={isNew ? 'New language' : d.name}
        desc={isNew ? 'Add a language and tell Salin what it should know about it.' : `Code ${d.code}`}
        actions={!isNew && <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={18} aria-hidden="true" />Delete</button>} />
      <div className="page-body">
        <Crumbs current={isNew ? 'New' : d.name} />
        <form className="settings" onSubmit={save} noValidate>
          {errors && <Notice tone="bad" title="Not saved"><p>{errors}</p></Notice>}
          <section className="panel stack" aria-labelledby="gen-h">
            <h2 id="gen-h" className="panel-title">General</h2>
            <div className="glossary-grid">
              <div className="field">
                <label htmlFor="lc">Code</label>
                <input id="lc" className="input" value={d.code} disabled={!isNew} maxLength={12}
                  onChange={(e) => set('code', e.target.value.trim().toLowerCase())} placeholder="For example, ja" />
              </div>
              <div className="field">
                <label htmlFor="ln">Name</label>
                <input id="ln" className="input" value={d.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="lnn">Native name</label>
                <input id="lnn" className="input" value={d.native_name} maxLength={60} onChange={(e) => set('native_name', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="lq">Reliability</label>
                <select id="lq" className="select" value={d.quality} onChange={(e) => set('quality', e.target.value as Language['quality'])}>
                  <option value="strong">Reliable</option>
                  <option value="weak">Native check advised (always low confidence)</option>
                </select>
              </div>
            </div>
            <div className="glossary-grid">
              <div className="field">
                <label htmlFor="lsc">Speech recognition code</label>
                <input id="lsc" className="input" value={d.speech_code} maxLength={3} onChange={(e) => set('speech_code', e.target.value.trim().toLowerCase())} placeholder="Empty: detect" />
              </div>
              <div className="field">
                <label htmlFor="ltc">Voice code</label>
                <input id="ltc" className="input" value={d.tts_code} maxLength={20} onChange={(e) => set('tts_code', e.target.value.trim())} placeholder="For example, ja-JP" />
              </div>
              <div className="field">
                <label htmlFor="lso">Order</label>
                <input id="lso" className="input" type="number" min={0} max={10000} value={d.sort} onChange={(e) => set('sort', Number(e.target.value))} />
              </div>
              <div className="field" style={{ alignContent: 'end' }}>
                <Switch checked={d.enabled} onChange={(v) => set('enabled', v)} label="Offered in pickers" />
              </div>
            </div>
          </section>

          <section className="panel stack" aria-labelledby="notes-h">
            <h2 id="notes-h" className="panel-title">What Salin should know</h2>
            <div className="field">
              <label htmlFor="lnotes">Language notes</label>
              <textarea id="lnotes" className="textarea" rows={8} maxLength={3000} value={d.notes} onChange={(e) => set('notes', e.target.value)}
                aria-describedby="lnotes-h" />
              <p id="lnotes-h" className="hint">Shorthand, politeness markers, false friends, regional variants. Sent with every request that involves this language. {d.notes.length.toLocaleString()} / 3,000</p>
            </div>
          </section>

          <section className="panel stack" aria-labelledby="reg-h">
            <div className="row-between">
              <h2 id="reg-h" className="panel-title">Reply registers</h2>
              <button type="button" className="btn btn-sm" disabled={d.registers.length >= 6}
                onClick={() => set('registers', [...d.registers, { id: '', label: '', hint: '', instruction: '' }])}>
                <Plus size={16} aria-hidden="true" />Add register
              </button>
            </div>
            <p className="hint">The first register is the default on the Reply page.</p>
            {d.registers.map((r, i) => (
              <fieldset key={i} className="register-row">
                <legend className="label legend">Register {i + 1}</legend>
                <div className="glossary-grid">
                  <div className="field"><label htmlFor={`ri-${i}`}>Id</label>
                    <input id={`ri-${i}`} className="input" value={r.id} maxLength={24} onChange={(e) => setReg(i, { id: e.target.value.trim().toLowerCase() })} /></div>
                  <div className="field"><label htmlFor={`rl-${i}`}>Label</label>
                    <input id={`rl-${i}`} className="input" value={r.label} maxLength={40} onChange={(e) => setReg(i, { label: e.target.value })} /></div>
                  <div className="field"><label htmlFor={`rh-${i}`}>Hint <span className="muted">(optional)</span></label>
                    <input id={`rh-${i}`} className="input" value={r.hint} maxLength={40} onChange={(e) => setReg(i, { hint: e.target.value })} /></div>
                  <div className="field" style={{ alignContent: 'end' }}>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={d.registers.length <= 1}
                      onClick={() => set('registers', d.registers.filter((_, j) => j !== i))}><Trash2 size={16} aria-hidden="true" />Remove</button>
                  </div>
                </div>
                <div className="field"><label htmlFor={`rn-${i}`}>Instruction</label>
                  <input id={`rn-${i}`} className="input" value={r.instruction} maxLength={400} onChange={(e) => setReg(i, { instruction: e.target.value })} /></div>
              </fieldset>
            ))}
          </section>

          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy && <Spinner />}Save</button>
            <Link className="btn" to="/settings/languages">Cancel</Link>
          </div>
        </form>
      </div>
      <ConfirmDialog open={confirmDelete} title={`Delete ${d.name}?`} confirmLabel="Delete" danger onConfirm={() => void remove()} onClose={() => setConfirmDelete(false)}>
        <p>Saved history in this language is kept. You can turn a language off instead of deleting it.</p>
      </ConfirmDialog>
    </>
  );
}
