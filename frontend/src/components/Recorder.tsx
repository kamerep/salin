import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useSettings } from '../state';
import type { Transcript } from '../types';
import { Notice, Spinner } from './ui';

const MAX_SECONDS = 300;
type Phase = 'idle' | 'asking' | 'recording' | 'transcribing';

function pickMime(): string | undefined {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Record speech, transcribe it on the server (locally, in the container), and
 * hand the text back. The transcript is never sent anywhere automatically. */
export function Recorder({ language, onText, label = 'Record' }: {
  language: string; onText: (text: string, t: Transcript) => void; label?: string;
}) {
  const { settings } = useSettings();
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number>(undefined);
  const stream = useRef<MediaStream | null>(null);
  const abort = useRef<AbortController | null>(null);

  const stopTracks = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => () => { window.clearInterval(timer.current); stopTracks(); abort.current?.abort(); }, []);

  if (!settings?.speech_input) return null;

  const secure = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  if (!secure) {
    return (
      <p className="hint">
        Recording needs a secure address.{' '}
        {settings.local_url
          ? <>Open Salin from the desktop launcher or at <a href={settings.local_url + window.location.pathname}>{settings.local_url.replace(/^https?:\/\//, '')}</a>.</>
          : 'Open Salin over HTTPS or on localhost.'}
      </p>
    );
  }

  async function start() {
    setError('');
    setWarnings([]);
    setPhase('asking');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setPhase('idle');
      const name = (e as DOMException).name;
      setError(name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it for this site in the browser, then try again.'
        : name === 'NotFoundError' ? 'No microphone was found.' : 'The microphone could not be started.');
      return;
    }
    const mime = pickMime();
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (ev) => { if (ev.data.size) chunks.current.push(ev.data); };
    r.onstop = () => void finish(r.mimeType);
    rec.current = r;
    r.start(1000);
    setSeconds(0);
    setPhase('recording');
    timer.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) stop();
        return s + 1;
      });
    }, 1000);
  }

  function stop() {
    window.clearInterval(timer.current);
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    stopTracks();
  }

  async function finish(mime: string) {
    setPhase('transcribing');
    abort.current = new AbortController();
    try {
      const t = await api.transcribe(new Blob(chunks.current, { type: mime || 'audio/webm' }), language, abort.current.signal);
      setWarnings(t.warnings);
      if (t.text) onText(t.text, t);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      chunks.current = [];
      setPhase('idle');
    }
  }

  return (
    <div className="recorder">
      <div className="row">
        {phase === 'recording' ? (
          <button type="button" className="btn btn-sm btn-danger" onClick={stop}>
            <Square size={14} aria-hidden="true" fill="currentColor" />Stop
            <span className="rec-time" aria-live="off">{fmt(seconds)}</span>
          </button>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => void start()} disabled={phase !== 'idle'}>
            {phase === 'idle' ? <Mic size={16} aria-hidden="true" /> : <Spinner />}
            {phase === 'asking' ? 'Waiting for microphone' : phase === 'transcribing' ? 'Transcribing' : label}
          </button>
        )}
        {phase === 'recording' && <span className="rec-dot" role="status">Recording</span>}
        {phase === 'transcribing' && !settings.speech.loaded && (
          <span className="hint">The first transcription loads the speech model and takes longer.</span>
        )}
      </div>
      {error && <Notice tone="bad"><p>{error}</p></Notice>}
      {warnings.length > 0 && <Notice tone="warn"><ul className="bullets">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></Notice>}
    </div>
  );
}
