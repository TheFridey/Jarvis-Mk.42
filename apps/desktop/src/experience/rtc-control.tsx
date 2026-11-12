'use client';
/**
 * Command-centre RTC control. Presentation only: the session lifecycle lives in
 * `useRtcSession` so Presence Mode and this control cannot drift apart.
 */
import { AudioLines } from 'lucide-react';
import type { SceneTransport } from './scene-client.ts';
import { useRtcSession } from './use-rtc-session.ts';

export function RtcControl({transport,available,live}:{transport:SceneTransport;available:boolean;live:boolean}) {
  const rtc = useRtcSession({ transport, available, live });
  const { state } = rtc;
  return <div className="rtc-control">
    <button aria-label={state==='live'?'Stop RTC voice':state==='connecting'?'Cancel RTC connection':'Start RTC voice'} disabled={state==='idle'&&(!live||!rtc.available)} onClick={()=>void rtc.toggle()} title={state==='live'?'Microphone live; click to stop':available?'Start a private audio session':'RTC service unavailable'}>
      <AudioLines size={17}/><span>{state==='live'?'MIC LIVE':state==='connecting'?'CONNECTING':''}</span>
    </button>
    <select aria-label="RTC speech processing" value={rtc.speechMode} disabled={state!=='idle'} onChange={event=>rtc.setSpeechMode(event.target.value as 'local'|'cloud')}>
      <option value="local">LOCAL SPEECH</option><option value="cloud">CLOUD SPEECH</option>
    </select>
    {rtc.error&&<p role="status">{rtc.error}</p>}
  </div>;
}
