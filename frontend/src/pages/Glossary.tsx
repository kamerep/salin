import { Download, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/toast';
import { Notice, Spinner } from '../components/ui';
import type { GlossaryEntry, Kind } from '../types';
import { PageHead } from './PageHead';

const KINDS: { value: Kind; label: string; plural: string }[] = [
  { value: 'person', label: 'Person', plural: 'People' },
  { value: 'entity', label: 'Company or entity', plural: 'Entities' },
  { value: 'abbreviation', label: 'Abbreviation', plural: 'Abbreviations' },
  { value: 'term', label: 'Term', plural: 'Terms' },
];
const kindLabel = (k: Kind) => KINDS.find((x) => x.value === k)!.label;

interface Draft { term: string; meaning: string; kind: Kind; notes: string }
const EMPTY: Draft = { term: '', meaning: '', kind: 'person', notes: '' };

function EntryForm({ initial, submitLabel, onSubmit, onCancel, idPrefix }: {
  initial: Draft; submitLabel: string; idPrefix: string;
  onSubmit: (d: Draft) => Promise<string | null>; onCancel?: () => void;
}) {
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<{ term?: string; meaning?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const termRef = useRef<HTMLInputElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!d.term.trim()) next.term = 'Enter the term as it appears in messages.';
    if (!d.meaning.trim()) next.meaning = 'Say what it means or who it is.';
    setErrors(next);
    if (next.term || next.meaning) return;
    setBusy(true);
    const err = await onSubmit({ ...d, term: d.term.trim(), meaning: d.meaning.trim(), notes: d.notes.trim() });
    setBusy(false);
    if (err) setErrors({ form: err });
    else if (!onCancel) { setD({ ...EMPTY, kind: d.kind }); termRef.current?.focus(); }
  }
  const f = (k: keyof Draft) => `${idPrefix}-${k}`;
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {errors.form && <Notice tone="bad"><p>{errors.form}</p></Notice>}
      <div className="glossary-grid">
        <div className="field">
          <label htmlFor={f('term')}>Term</label>
          <input ref={termRef} id={f('term')} className="input" value={d.term} maxLength={120} placeholder="For example, MR"
            onChange={(e) => setD({ ...d, term: e.target.value })} aria-invalid={!!errors.term} aria-describedby={errors.term ? `${f('term')}-e` : undefined} />
          {errors.term && <p id={`${f('term')}-e`} className="field-error">{errors.term}</p>}
        </div>
        <div className="field">
          <label htmlFor={f('meaning')}>Meaning</label>
          <input id={f('meaning')} className="input" value={d.meaning} maxLength={400} placeholder="For example, Maria Reyes"
            onChange={(e) => setD({ ...d, meaning: e.target.value })} aria-invalid={!!errors.meaning} aria-describedby={errors.meaning ? `${f('meaning')}-e` : undefined} />
          {errors.meaning && <p id={`${f('meaning')}-e`} className="field-error">{errors.meaning}</p>}
        </div>
        <div className="field">
          <label htmlFor={f('kind')}>Kind</label>
          <select id={f('kind')} className="select" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Kind })}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={f('notes')}>Notes <span className="muted">(optional)</span></label>
          <input id={f('notes')} className="input" value={d.notes} maxLength={600} placeholder="For example, director who signs invoices"
            onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </div>
      </div>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy && <Spinner />}{submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

export default function Glossary() {
  const toast = useToast();
  const [entries, setEntries] = useState<GlossaryEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [editing, setEditing] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      setEntries(await api.glossary());
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }
  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entries?.length ?? 0 };
    for (const e of entries ?? []) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [entries]);

  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase();
    return (entries ?? []).filter((e) =>
      (kind === 'all' || e.kind === kind) &&
      (!needle || `${e.term} ${e.meaning} ${e.notes}`.toLocaleLowerCase().includes(needle)));
  }, [entries, q, kind]);

  async function create(d: Draft) {
    try {
      const created = await api.addTerm(d);
      setEntries((xs) => [...(xs ?? []), created]);
      toast.show(`Added ${created.term}.`);
      return null;
    } catch (e) { return (e as Error).message; }
  }

  async function update(id: number, d: Draft) {
    try {
      const updated = await api.updateTerm(id, d);
      setEntries((xs) => (xs ?? []).map((x) => (x.id === id ? updated : x)));
      setEditing(null);
      toast.show(`Saved ${updated.term}.`);
      return null;
    } catch (e) { return (e as Error).message; }
  }

  async function remove(entry: GlossaryEntry) {
    try {
      await api.deleteTerm(entry.id);
      setEntries((xs) => (xs ?? []).filter((x) => x.id !== entry.id));
      toast.show(`Deleted ${entry.term}.`, {
        action: {
          label: 'Undo',
          run: async () => {
            try {
              const back = await api.addTerm({ term: entry.term, meaning: entry.meaning, kind: entry.kind, notes: entry.notes });
              setEntries((xs) => [...(xs ?? []), back]);
            } catch (e) { toast.show((e as Error).message, { tone: 'bad' }); }
          },
        },
      });
    } catch (e) { toast.show((e as Error).message, { tone: 'bad' }); }
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const r = await api.importGlossary(file);
      await load();
      const skipped = r.skipped_rows.length ? ` Skipped rows ${r.skipped_rows.join(', ')}.` : '';
      toast.show(`Imported: ${r.created} new, ${r.updated} updated.${skipped}`);
    } catch (e) {
      toast.show((e as Error).message, { tone: 'bad' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <PageHead title="Glossary"
        desc="People, companies and abbreviations Salin should know. Every entry is sent with each request."
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => { addRef.current?.scrollIntoView({ block: 'center' }); document.getElementById('new-term')?.focus(); }}>
            <Plus size={18} aria-hidden="true" />Add entry
          </button>
        )} />
      <div className="page-body">
        <section className="panel" ref={addRef} aria-labelledby="add-h">
          <div className="panel-head"><h2 id="add-h" className="panel-title">New entry</h2></div>
          <EntryForm idPrefix="new" initial={EMPTY} submitLabel="Add to glossary" onSubmit={create} />
        </section>

        <section className="panel stack" aria-labelledby="list-h">
          <div className="row-between">
            <h2 id="list-h" className="panel-title">Entries</h2>
            <div className="row">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id="csv-in" onChange={(e) => void onImport(e.target.files?.[0])} />
              <label htmlFor="csv-in" className="btn btn-sm" role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}>
                <Upload size={16} aria-hidden="true" />Import CSV
              </label>
              <a className="btn btn-sm" href="/api/glossary/export" download><Download size={16} aria-hidden="true" />Export CSV</a>
            </div>
          </div>
          <div className="row">
            <div className="input-icon" style={{ flex: '1 1 260px' }}>
              <Search size={16} aria-hidden="true" />
              <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter entries" aria-label="Filter entries" />
            </div>
          </div>
          <div className="filter-chips" role="group" aria-label="Kind">
            <button type="button" className="filter-chip" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
              All <span className="count">{counts.all}</span>
            </button>
            {KINDS.map((k) => (
              <button key={k.value} type="button" className="filter-chip" aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
                {k.plural} <span className="count">{counts[k.value] ?? 0}</span>
              </button>
            ))}
          </div>

          {loadError && <Notice tone="bad" title="Could not load the glossary"><p>{loadError}</p><button type="button" className="btn btn-sm" onClick={() => void load()}>Retry</button></Notice>}
          {!entries && !loadError && <p className="muted"><Spinner /> Loading</p>}
          {entries && entries.length === 0 && (
            <div className="empty">
              <h3>No entries yet</h3>
              <p>Add the people, companies and shorthand that show up in messages, such as “MR = Maria Reyes”. You can also import a CSV with the columns term, meaning, kind and notes.</p>
            </div>
          )}
          {entries && entries.length > 0 && shown.length === 0 && (
            <div className="empty">
              <h3>No entries match</h3>
              <button type="button" className="btn btn-sm" onClick={() => { setQ(''); setKind('all'); }}>Clear filters</button>
            </div>
          )}
          {shown.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Glossary entries</caption>
                <thead><tr><th scope="col">Term</th><th scope="col">Meaning</th><th scope="col">Kind</th><th scope="col">Notes</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {shown.map((e) => editing === e.id ? (
                    <tr key={e.id}><td colSpan={5}>
                      <EntryForm idPrefix={`edit-${e.id}`} initial={{ term: e.term, meaning: e.meaning, kind: e.kind, notes: e.notes }}
                        submitLabel="Save" onSubmit={(d) => update(e.id, d)} onCancel={() => setEditing(null)} />
                    </td></tr>
                  ) : (
                    <tr key={e.id}>
                      <td className="term">{e.term}</td>
                      <td>{e.meaning}</td>
                      <td className="muted">{kindLabel(e.kind)}</td>
                      <td className="muted">{e.notes}</td>
                      <td className="actions">
                        <button type="button" className="btn btn-sm btn-icon btn-ghost" aria-label={`Edit ${e.term}`} onClick={() => setEditing(e.id)}><Pencil size={16} aria-hidden="true" /></button>
                        <button type="button" className="btn btn-sm btn-icon btn-ghost" aria-label={`Delete ${e.term}`} onClick={() => void remove(e)}><Trash2 size={16} aria-hidden="true" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">The glossary holds real names. It stays in the container's database and is never part of the code repository.</p>
        </section>
      </div>
    </>
  );
}
