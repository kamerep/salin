import { BookPlus, Database, MessageSquareReply, Timer, Cpu } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { CallMeta, ComposeOutput, Kind, ReplyDraftState, TranslationOutput, UnknownTerm } from '../types';
import { useToast } from './toast';
import { ConfidenceTag, CopyButton, Notice, Tag } from './ui';

const LANG: Record<string, string> = { tagalog: 'Tagalog', english: 'English', taglish: 'Taglish', other: 'Other' };
const FORMALITY: Record<string, string> = { formal: 'Formal', neutral: 'Neutral', casual: 'Casual', taglish: 'Office Taglish' };
const KIND_LABEL: Record<Kind, string> = { person: 'Person', entity: 'Company or entity', abbreviation: 'Abbreviation', term: 'Term' };

const num = new Intl.NumberFormat();

export function MetaLine({ meta }: { meta: CallMeta }) {
  return (
    <div className="meta-line">
      <span><Cpu size={14} aria-hidden="true" />{meta.model_id}</span>
      <span><Timer size={14} aria-hidden="true" />{(meta.elapsed_ms / 1000).toFixed(1)} s</span>
      <span>{num.format(meta.input_tokens + meta.cache_read_tokens + meta.cache_write_tokens)} in, {num.format(meta.output_tokens)} out</span>
      {meta.cache_read_tokens > 0 && <span><Database size={14} aria-hidden="true" />Prompt and glossary from cache</span>}
    </div>
  );
}

function Warnings({ meta }: { meta: CallMeta }) {
  if (!meta.warnings.length) return null;
  return (
    <Notice tone="warn" title={meta.provider === 'ollama' ? 'Offline model used' : 'Note'}>
      <ul className="bullets">{meta.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
    </Notice>
  );
}

function AddTermForm({ item, onDone }: { item: UnknownTerm; onDone: () => void }) {
  const toast = useToast();
  const [meaning, setMeaning] = useState(item.guess && item.guess.toLowerCase() !== 'unknown' ? item.guess : '');
  const [kind, setKind] = useState<Kind>(item.kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!meaning.trim()) { setError('Say what it means.'); return; }
    setBusy(true);
    try {
      await api.addTerm({ term: item.term, meaning: meaning.trim(), kind });
      toast.show(`Added ${item.term}. It applies from the next request.`);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={save} style={{ marginBlockStart: 8 }}>
      <div className="field">
        <label htmlFor={`m-${item.term}`}>Meaning of {item.term}</label>
        <input id={`m-${item.term}`} className="input" value={meaning} onChange={(e) => { setMeaning(e.target.value); setError(''); }}
          aria-invalid={!!error} aria-describedby={error ? `e-${item.term}` : undefined} autoFocus />
        {error && <p id={`e-${item.term}`} className="field-error">{error}</p>}
      </div>
      <div className="row">
        <select className="select" style={{ inlineSize: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Kind">
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Save to glossary</button>
        <button type="button" className="btn btn-sm" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function UnknownTerms({ items }: { items: UnknownTerm[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  if (!items.length) return null;
  return (
    <section aria-labelledby="unk">
      <h3 id="unk" className="section-title">Not in your glossary</h3>
      <ul className="list-plain">
        {items.map((u) => (
          <li key={u.term} className="amb">
            <div className="row-between">
              <div>
                <strong>{u.term}</strong> <span className="muted small">{KIND_LABEL[u.kind]}</span>
                <p className="small muted">Guess: {u.guess || 'unknown'}</p>
              </div>
              {added.includes(u.term)
                ? <Tag tone="ok">Added</Tag>
                : open !== u.term && (
                  <button type="button" className="btn btn-sm" onClick={() => setOpen(u.term)}>
                    <BookPlus size={16} aria-hidden="true" />Add to glossary
                  </button>
                )}
            </div>
            {open === u.term && <AddTermForm item={u} onDone={() => { setAdded((a) => (open ? [...a, open] : a)); setOpen(null); }} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TranslationView({ output, meta, source }: { output: TranslationOutput; meta: CallMeta; source: string }) {
  const navigate = useNavigate();
  return (
    <div className="stack">
      <Warnings meta={meta} />
      <div className="stack">
        <div className="row-between">
          <h2 className="panel-title">{LANG[output.target_language]} translation</h2>
          <ConfidenceTag value={output.confidence} />
        </div>
        <p className="result-text" lang={output.target_language === 'tagalog' ? 'tl' : 'en'}>{output.translation}</p>
        <div className="row">
          <CopyButton text={output.translation} />
          {output.target_language === 'english' && (
            <button type="button" className="btn btn-sm" onClick={() => navigate('/reply', { state: { replyTo: source } satisfies ReplyDraftState })}>
              <MessageSquareReply size={16} aria-hidden="true" />Draft a reply
            </button>
          )}
        </div>
      </div>

      <hr className="divider" />
      <dl className="facts">
        <dt>Action requested</dt>
        <dd className="stack" style={{ gap: 4 }}>
          <span>{output.action_requested ? <Tag tone="warn">Action requested</Tag> : <Tag tone="info">No action</Tag>}</span>
          {output.action_summary && <span>{output.action_summary}</span>}
        </dd>
        {output.deadline && (<><dt>Deadline</dt><dd>{output.deadline}</dd></>)}
        <dt>Tone</dt><dd>{output.tone}</dd>
        <dt>Formality</dt><dd>{FORMALITY[output.formality]}</dd>
        <dt>Source language</dt><dd>{LANG[output.source_language]}</dd>
        <dt>Confidence</dt><dd>{output.confidence_reason}</dd>
        {output.dialect_notes && (<><dt>Regional language</dt><dd>{output.dialect_notes}</dd></>)}
        {output.glossary_terms_used.length > 0 && (
          <><dt>Glossary used</dt><dd><span className="chips">{output.glossary_terms_used.map((t) => <span className="chip" key={t}>{t}</span>)}</span></dd></>
        )}
      </dl>

      {output.ambiguities.length > 0 && (
        <section aria-labelledby="amb">
          <h3 id="amb" className="section-title">Unclear phrases</h3>
          <ul className="list-plain">
            {output.ambiguities.map((a, i) => (
              <li className="amb" key={`${a.phrase}-${i}`}>
                <p><q>{a.phrase}</q></p>
                <p className="small">{a.issue}</p>
                <p className="small muted">Likely: {a.likely_meaning}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <UnknownTerms items={output.unknown_terms} />
      <MetaLine meta={meta} />
    </div>
  );
}

export function ComposeView({ output, meta, onRegenerate, busy }: { output: ComposeOutput; meta: CallMeta; onRegenerate?: () => void; busy?: boolean }) {
  return (
    <div className="stack">
      <Warnings meta={meta} />
      {output.needs_native_review && (
        <Notice tone="warn" title="Have a native speaker check this before sending">
          <p>This reads as legal, regulatory or otherwise sensitive. Machine Tagalog can miss nuance that matters here.</p>
        </Notice>
      )}
      <div className="row-between">
        <h2 className="panel-title">Tagalog reply, {FORMALITY[output.formality_used].toLowerCase()}</h2>
        <ConfidenceTag value={output.confidence} />
      </div>
      <p className="result-text" lang="tl">{output.reply}</p>
      <div className="row">
        <CopyButton text={output.reply} label="Copy reply" />
        {onRegenerate && <button type="button" className="btn btn-sm" onClick={onRegenerate} disabled={busy}>Try again</button>}
      </div>
      <hr className="divider" />
      <section aria-labelledby="bt">
        <h3 id="bt" className="section-title">What it says in English</h3>
        <p lang="en">{output.back_translation}</p>
      </section>
      {output.cautions.length > 0 && (
        <section aria-labelledby="cau">
          <h3 id="cau" className="section-title">Check before sending</h3>
          <ul className="bullets">{output.cautions.map((c) => <li key={c}>{c}</li>)}</ul>
        </section>
      )}
      {output.notes.length > 0 && (
        <section aria-labelledby="nts">
          <h3 id="nts" className="section-title">Word choices</h3>
          <ul className="bullets">{output.notes.map((c) => <li key={c}>{c}</li>)}</ul>
        </section>
      )}
      {output.glossary_terms_used.length > 0 && (
        <div className="chips" aria-label="Glossary used">{output.glossary_terms_used.map((t) => <span className="chip" key={t}>{t}</span>)}</div>
      )}
      <MetaLine meta={meta} />
    </div>
  );
}
