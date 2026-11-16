'use client';
/**
 * The presence microphone control.
 *
 * It is not a new voice path: it composes the same trusted session hook the
 * command centre uses (`useRtcSession`), which performs `getUserMedia` only
 * inside this explicit gesture and always releases the track on stop,
 * disconnect or unmount. Presence fixes the speech mode to the existing local
 * engine; routing audio to a paid cloud service is not offered here and remains
 * an explicit command-centre decision.
 *
 * No amplitude is invented. The visual response comes from the Kernel's own
 * `voiceAudio` observation, which the GPU envelope already consumes.
 */
import { Mic, MicOff } from 'lucide-react';
import type { DesktopKernelSnapshot } from '@jarvis/scene';
import type { DataLiveness } from '../experience-phase-policy.ts';
import { useRtcSession } from '../use-rtc-session.ts';
import type { SceneTransport } from '../scene-client.ts';
import { presenceVoiceStatus } from './presence-policy.ts';

export function PresenceMic({ transport, live, available, liveness, picture }: {
  transport: SceneTransport; live: boolean; available: boolean; liveness: DataLiveness; picture?: DesktopKernelSnapshot | undefined;
}) {
  const rtc = useRtcSession({ transport, available, live });
  const status = presenceVoiceStatus({ liveness, micActive: rtc.state === 'live', available: rtc.available, picture });
  const connecting = rtc.state === 'connecting';
  const disabled = status.state === 'UNAVAILABLE';
  const label = connecting ? 'CANCEL VOICE CONNECTION' : rtc.state === 'live' ? 'STOP MICROPHONE' : 'START MICROPHONE';
  return <div className="presence-voice" data-voice={status.state.toLowerCase()} data-rtc={rtc.state}>
    <button type="button" className="presence-mic" onClick={() => void rtc.toggle()} disabled={disabled}
      aria-pressed={rtc.state === 'live'} aria-label={label} title={status.detail}>
      {rtc.state === 'live' ? <Mic size={15} aria-hidden="true"/> : <MicOff size={15} aria-hidden="true"/>}
      <span className="presence-mic-label" aria-hidden="true">{connecting ? 'LINKING' : rtc.state === 'live' ? 'MIC' : ''}</span>
    </button>
    {rtc.error ? <p className="presence-voice-error" role="status">{rtc.error}</p> : null}
  </div>;
}
