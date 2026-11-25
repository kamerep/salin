import { BookPlus, Database, MessageSquareReply, Timer, Cpu } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSettings } from '../state';
import type { CallMeta, ComposeOutput, Kind, RegisterDef, ReplyDraftState, TranslationOutput, UnknownTerm } from '../types';
import { DownloadButton, ListenButton } from './output';
import { useToast } from './toast';
import { ConfidenceTag, CopyButton, Notice, Tag } from './ui';

function NativeReview({ show, compose }: { show: boolean; compose?: boolean }) {
  if (!show) return null;
  return (
    <Notice tone="warn" title={compose ? 'Have a native speaker check this before sending' : 'Have a native speaker check this'}>
      <p>{compose
        ? 'It is sensitive, or in a language where machine output is less reliable. Machine text can miss nuance that matters here.'
        : 'The language is one where machine translation is less reliable, or the content is sensitive. Do not act on it unchecked.'}</p>
    </Notice>
  );
}
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
  const { langName } = useSettings();
  return (
    <div className="stack">
      <Warnings meta={meta} />
      <NativeReview show={output.needs_native_review} />
      <div className="stack">
        <div className="row-between">
          <h2 className="panel-title">{langName(output.target_language)} translation</h2>
          <ConfidenceTag value={output.confidence} />
        </div>
        <p className="result-text" lang={output.target_language}>{output.translation}</p>
        <div className="row">
          <CopyButton text={output.translation} />
          <ListenButton text={output.translation} lang={output.target_language} />
          <DownloadButton filename="salin-translation" sections={[
            [`Original (${output.source_language_name || langName(output.source_language)})`, source],
            [`Translation (${langName(output.target_language)})`, output.translation],
            ['Action requested', output.action_requested ? `${output.action_summary}${output.deadline ? ` (${output.deadline})` : ''}` : 'None'],
            ['Tone and formality', `${output.tone}; ${output.formality}`],
            ['Confidence', `${output.confidence}: ${output.confidence_reason}`],
            ['Unclear phrases', output.ambiguities.map((a) => `"${a.phrase}": ${a.issue} Likely: ${a.likely_meaning}`).join('\n')],
          ]} />
          {output.source_language !== 'en' && (
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
        <dt>Formality</dt><dd>{output.formality}</dd>
        <dt>Source language</dt><dd>{output.source_language_name || langName(output.source_language)}</dd>
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

export function ComposeView({ output, meta, target, register, draft, onRegenerate, busy }: {
  output: ComposeOutput; meta: CallMeta; target: string; register?: RegisterDef; draft: string;
  onRegenerate?: () => void; busy?: boolean;
}) {
  const { langName } = useSettings();
  return (
    <div className="stack">
      <Warnings meta={meta} />
      <NativeReview show={output.needs_native_review} compose />
      <div className="row-between">
        <h2 className="panel-title">{langName(target)} reply{register ? `, ${register.label.toLowerCase()}` : ''}</h2>
        <ConfidenceTag value={output.confidence} />
      </div>
      <p className="result-text" lang={target}>{output.reply}</p>
      <div className="row">
        <CopyButton text={output.reply} label="Copy reply" />
        <ListenButton text={output.reply} lang={target} />
        <DownloadButton filename="salin-reply" sections={[
          ['Your draft', draft],
          [`Reply (${langName(target)}${register ? `, ${register.label}` : ''})`, output.reply],
          ['What it says in English', output.back_translation],
          ['Check before sending', output.cautions.join('\n')],
        ]} />
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
