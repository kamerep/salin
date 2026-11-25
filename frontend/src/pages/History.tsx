import { MessageSquareReply, Search, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ComposeView, TranslationView } from '../components/results';
import { useToast } from '../components/toast';
import { ConfirmDialog, Notice, Spinner, Switch } from '../components/ui';
import { useSettings } from '../state';
import type { ComposeResult, HistoryDetail, HistoryItem, ReplyDraftState, TranslateResult } from '../types';
import { PageHead } from './PageHead';

type Filter = 'all' | 'translate' | 'compose' | 'starred';
const PAGE = 30;

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const rel = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  if (Math.abs(mins) < 60) return rel.format(mins, 'minute');
  if (Math.abs(mins) < 60 * 24) return rel.format(Math.round(mins / 60), 'hour');
  return dateFmt.format(d);
}

export default function History() {
  const toast = useToast();
  const navigate = useNavigate();
  const { settings, langName } = useSettings();
  const [pair, setPair] = useState('');
  const [pairs, setPairs] = useState<{ source_lang: string; target_lang: string; n: number }[]>([]);
  useEffect(() => { api.historyPairs().then(setPairs).catch(() => setPairs([])); }, []);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<HistoryDetail | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState('');
  const [keepStarred, setKeepStarred] = useState(true);
  const abort = useRef<AbortController | null>(null);

  const params = useCallback((offset: number) => ({
    q,
    mode: filter === 'translate' || filter === 'compose' ? filter : null,
    starred: filter === 'starred',
    pair: pair || null,
    limit: PAGE,
    offset,
  }), [q, filter, pair]);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      abort.current?.abort();
      abort.current = new AbortController();
      try {
        const r = await api.history(params(0), abort.current.signal);
        setItems(r.items);
        setTotal(r.total);
        setError('');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      }
    }, q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [params, q]);

  async function more() {
    if (!items) return;
    setLoadingMore(true);
    try {
      const r = await api.history(params(items.length));
      setItems([...items, ...r.items]);
      setTotal(r.total);
    } catch (e) {
      toast.show((e as Error).message, { tone: 'bad' });
    } finally {
      setLoadingMore(false);
    }
  }

  async function open(id: number) {
    try {
      setSelected(await api.historyItem(id));
    } catch (e) {
      toast.show((e as Error).message, { tone: 'bad' });
    }
  }

  async function toggleStar(item: HistoryItem) {
    const next = !item.starred;
    const apply = (v: boolean) => {
      setItems((xs) => xs?.map((x) => (x.id === item.id ? { ...x, starred: v } : x)) ?? null);
      setSelected((s) => (s && s.id === item.id ? { ...s, starred: v } : s));
    };
    apply(next); // optimistic: low risk and reversible
    try {
      await api.star(item.id, next);
    } catch (e) {
      apply(!next);
      toast.show(`Could not update the star. ${(e as Error).message}`, { tone: 'bad' });
    }
  }

  async function removeSelected() {
    if (!selected) return;
    try {
      await api.deleteHistory(selected.id);
      setItems((xs) => xs?.filter((x) => x.id !== selected.id) ?? null);
      setTotal((t) => t - 1);
      setSelected(null);
      toast.show('Deleted from history.');
    } catch (e) {
      toast.show((e as Error).message, { tone: 'bad' });
    } finally {
      setConfirmDelete(false);
    }
  }

  async function clearAll() {
    try {
      const r = await api.clearHistory(keepStarred);
      toast.show(`Deleted ${r.deleted} ${r.deleted === 1 ? 'item' : 'items'}.`);
      setSelected(null);
      setClearOpen(false);
      setClearText('');
      const fresh = await api.history(params(0));
      setItems(fresh.items);
      setTotal(fresh.total);
    } catch (e) {
      toast.show((e as Error).message, { tone: 'bad' });
    }
  }

  const filters: { v: Filter; label: string }[] = [
    { v: 'all', label: 'All' }, { v: 'translate', label: 'Translations' }, { v: 'compose', label: 'Replies' }, { v: 'starred', label: 'Starred' },
  ];
  const selectedItem = items?.find((i) => i.id === selected?.id) ?? selected;

  return (
    <>
      <PageHead title="History" desc="Saved translations and replies, newest first. Search covers the original text and the result."
        actions={<button type="button" className="btn btn-danger" onClick={() => setClearOpen(true)} disabled={!total}><Trash2 size={18} aria-hidden="true" />Clear history</button>} />
      <div className="page-body">
        {settings && !settings.save_history && (
          <Notice title="Saving is off by default">
            <p>New requests are only saved when you turn on “Save to history” for them. <Link to="/settings">Change in Settings</Link></p>
          </Notice>
        )}
        <div className="history-layout">
          <section className="stack" aria-label="Saved items">
            <div className="input-icon">
              <Search size={16} aria-hidden="true" />
              <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search history" aria-label="Search history" />
            </div>
            <div className="filter-chips" role="group" aria-label="Show">
              {filters.map((f) => (
                <button key={f.v} type="button" className="filter-chip" aria-pressed={filter === f.v} onClick={() => setFilter(f.v)}>{f.label}</button>
              ))}
            </div>
            {pairs.length > 1 && (
              <div className="field">
                <label htmlFor="pair">Languages</label>
                <select id="pair" className="select" value={pair} onChange={(e) => setPair(e.target.value)}>
                  <option value="">All language pairs</option>
                  {pairs.map((p) => (
                    <option key={`${p.source_lang}>${p.target_lang}`} value={`${p.source_lang}>${p.target_lang}`}>
                      {langName(p.source_lang)} to {langName(p.target_lang)} ({p.n})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {error && <Notice tone="bad" title="Could not load history"><p>{error}</p></Notice>}
            {!items && !error && <p className="muted"><Spinner /> Loading</p>}
            {items && items.length === 0 && (
              q || filter !== 'all' || pair ? (
                <div className="empty">
                  <h3>Nothing matches</h3>
                  <button type="button" className="btn btn-sm" onClick={() => { setQ(''); setFilter('all'); setPair(''); }}>Clear search and filters</button>
                </div>
              ) : (
                <div className="empty">
                  <h3>Nothing saved yet</h3>
                  <p>Translations and replies you save appear here.</p>
                  <Link className="btn btn-sm" to="/">Translate a message</Link>
                </div>
              )
            )}
            {items && items.length > 0 && (
              <>
                <p className="hint" aria-live="polite">{total.toLocaleString()} {total === 1 ? 'item' : 'items'}</p>
                <ul className="h-list">
                  {items.map((it) => (
                    <li key={it.id} className="h-item" aria-current={selected?.id === it.id ? 'true' : undefined}>
                      <button type="button" className="h-open" onClick={() => void open(it.id)}>
                        <span className="h-top">
                          <span className="h-kind">{it.mode === 'translate' ? 'Translation' : 'Reply'}</span>
                          <time dateTime={it.created_at} title={dateFmt.format(new Date(it.created_at))}>{when(it.created_at)}</time>
                          {it.source_lang && it.target_lang && <span>{langName(it.source_lang)} to {langName(it.target_lang)}</span>}
                          {it.provider === 'ollama' && <span>offline model</span>}
                        </span>
                        <span className="h-src">{it.source_text}</span>
                        <span className="h-out">{it.output_text}</span>
                      </button>
                      <div className="h-side">
                        <button type="button" className={`btn btn-sm btn-icon btn-ghost ${it.starred ? 'star-on' : ''}`}
                          aria-pressed={it.starred} aria-label={it.starred ? 'Remove star' : 'Star'} onClick={() => void toggleStar(it)}>
                          <Star size={18} aria-hidden="true" fill={it.starred ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {items.length < total && (
                  <button type="button" className="btn" onClick={() => void more()} disabled={loadingMore}>
                    {loadingMore && <Spinner />}Show more
                  </button>
                )}
              </>
            )}
          </section>

          <section className="panel sticky-detail" aria-live="polite" aria-label="Selected item">
            {!selected ? (
              <div className="empty"><h3>Pick an item</h3><p>Its full result shows here.</p></div>
            ) : (
              <div className="stack">
                <div className="row-between">
                  <p className="small muted">
                    <time dateTime={selected.created_at}>{dateFmt.format(new Date(selected.created_at))}</time>
                  </p>
                  <div className="row">
                    {selectedItem && (
                      <button type="button" className={`btn btn-sm ${selectedItem.starred ? 'star-on' : ''}`} aria-pressed={selectedItem.starred} onClick={() => void toggleStar(selectedItem as HistoryItem)}>
                        <Star size={16} aria-hidden="true" fill={selectedItem.starred ? 'currentColor' : 'none'} />{selectedItem.starred ? 'Starred' : 'Star'}
                      </button>
                    )}
                    {selected.mode === 'translate' && (
                      <button type="button" className="btn btn-sm" onClick={() => navigate('/reply', { state: { replyTo: selected.source_text } satisfies ReplyDraftState })}>
                        <MessageSquareReply size={16} aria-hidden="true" />Reply
                      </button>
                    )}
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden="true" />Delete</button>
                  </div>
                </div>
                <section aria-labelledby="orig">
                  <h3 id="orig" className="section-title">{selected.mode === 'translate' ? 'Original message' : 'Your English draft'}</h3>
                  <p className="pre">{selected.source_text}</p>
                </section>
                <hr className="divider" />
                {selected.mode === 'translate'
                  ? <TranslationView output={(selected.result as TranslateResult).output} meta={(selected.result as TranslateResult).meta} source={selected.source_text} />
                  : <ComposeView output={(selected.result as ComposeResult).output} meta={(selected.result as ComposeResult).meta}
                      target={(selected.result as ComposeResult).request?.target ?? selected.target_lang}
                      register={(selected.result as ComposeResult).request?.register} draft={selected.source_text} />}
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog open={confirmDelete} title="Delete this item?" confirmLabel="Delete" danger
        onConfirm={() => void removeSelected()} onClose={() => setConfirmDelete(false)}>
        <p>It is removed from history for good.</p>
      </ConfirmDialog>
      <ConfirmDialog open={clearOpen} title="Clear history" confirmLabel="Clear history" danger confirmDisabled={clearText !== 'DELETE'}
        onConfirm={() => void clearAll()} onClose={() => { setClearOpen(false); setClearText(''); }}>
        <p>This deletes saved translations and replies permanently.</p>
        <Switch checked={keepStarred} onChange={setKeepStarred} label="Keep starred items" />
        <div className="field">
          <label htmlFor="clr">Type DELETE to confirm</label>
          <input id="clr" className="input" value={clearText} onChange={(e) => setClearText(e.target.value)} autoComplete="off" />
        </div>
      </ConfirmDialog>
    </>
  );
}
