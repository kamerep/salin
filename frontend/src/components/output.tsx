import { Download, Square, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useSettings } from '../state';
import { useToast } from './toast';
import { Spinner } from './ui';

function browserVoice(tag: string): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === 'undefined' || !tag) return undefined;
  const voices = speechSynthesis.getVoices();
  const base = tag.split('-')[0].toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === tag.toLowerCase())
    ?? voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base);
}

function useVoicesReady() {
  const [, force] = useState(0);
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const on = () => force((n) => n + 1);
    speechSynthesis.addEventListener('voiceschanged', on);
    return () => speechSynthesis.removeEventListener('voiceschanged', on);
  }, []);
}

/** Read text aloud: a matching browser voice first, then the offline
 * server voice. Hidden when neither exists for the language. */
export function ListenButton({ text, lang }: { text: string; lang: string }) {
  const { settings, languages } = useSettings();
  const toast = useToast();
  useVoicesReady();
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef('');
  useEffect(() => () => {
    audio.current?.pause();
    if (url.current) URL.revokeObjectURL(url.current);
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }, []);

  const tts = languages.find((l) => l.code === lang)?.tts_code || lang;
  const voice = browserVoice(tts);
  const server = settings?.speech.voices.includes(lang.split('-')[0]) ?? false;
  if (!voice && !server) return null;

  function stop() {
    audio.current?.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setState('idle');
  }

  async function play() {
    if (voice) {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.onend = () => setState('idle');
      u.onerror = () => setState('idle');
      setState('playing');
      speechSynthesis.speak(u);
      return;
    }
    setState('loading');
    try {
      const blob = await api.speak(text.slice(0, 3000), lang);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(blob);
      audio.current = new Audio(url.current);
      audio.current.onended = () => setState('idle');
      await audio.current.play();
      setState('playing');
    } catch (e) {
      setState('idle');
      toast.show((e as Error).message, { tone: 'bad' });
    }
  }

  return state === 'playing' ? (
    <button type="button" className="btn btn-sm" onClick={stop}><Square size={14} aria-hidden="true" fill="currentColor" />Stop</button>
  ) : (
    <button type="button" className="btn btn-sm" onClick={() => void play()} disabled={state === 'loading'}
      title={voice ? undefined : 'Offline voice'}>
      {state === 'loading' ? <Spinner /> : <Volume2 size={16} aria-hidden="true" />}Listen
    </button>
  );
}

/** Save the result as a plain text file. */
export function DownloadButton({ filename, sections }: { filename: string; sections: [string, string][] }) {
  function save() {
    const stamp = new Date();
    const body = [`Salin, ${stamp.toLocaleString()}`, '', ...sections.filter(([, v]) => v.trim()).flatMap(([h, v]) => [h, v, ''])].join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${stamp.toISOString().slice(0, 16).replace(/[:T]/g, '')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <button type="button" className="btn btn-sm" onClick={save}><Download size={16} aria-hidden="true" />Download</button>
  );
}
