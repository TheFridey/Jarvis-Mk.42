'use client';
/**
 * The one trusted RTC session lifecycle, extracted from `RtcControl` so the
 * command centre and Presence Mode share exactly the same permission, consent,
 * cancellation and teardown behaviour instead of drifting apart.
 *
 * Nothing here captures audio on its own: `toggle` must be called from an
 * explicit user gesture, `getUserMedia` runs inside that gesture, and the
 * microphone is always released on stop, disconnect or unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import type { SceneTransport } from './scene-client.ts';
import { startRtcSession } from './rtc-session.ts';

export type RtcState = 'idle' | 'connecting' | 'live';
export type RtcSpeechMode = 'local' | 'cloud';

export interface RtcSession {
  state: RtcState;
  speechMode: RtcSpeechMode;
  setSpeechMode: (mode: RtcSpeechMode) => void;
  error: string;
  /** True when the transport and service could start a session at all. */
  available: boolean;
  toggle: () => Promise<void>;
  release: () => Promise<void>;
}

export function useRtcSession({ transport, available: serviceAvailable, live }: {
  transport: SceneTransport; available: boolean; live: boolean;
}): RtcSession {
  const [state, setState] = useState<RtcState>('idle');
  const [speechMode, setSpeechMode] = useState<RtcSpeechMode>('local');
  const [error, setError] = useState('');
  const room = useRef<Room | undefined>(undefined);
  const generation = useRef(0);
  const audio = useRef<HTMLAudioElement[]>([]);
  const microphone = useRef<MediaStream | undefined>(undefined);

  const release = useCallback(async () => {
    const ended = ++generation.current;
    const previous = room.current;
    room.current = undefined;
    microphone.current?.getTracks().forEach(track => track.stop());
    microphone.current = undefined;
    audio.current.forEach(element => element.remove());
    audio.current = [];
    setState('idle');
    if (previous) await previous.disconnect();
    if (ended === generation.current) await transport.leaveRtc?.().catch(() => undefined);
  }, [transport]);

  useEffect(() => {
    if (!live) void release();
    return () => {
      generation.current++;
      const previous = room.current;
      room.current = undefined;
      microphone.current?.getTracks().forEach(track => track.stop());
      microphone.current = undefined;
      void previous?.disconnect();
      audio.current.forEach(element => element.remove());
      audio.current = [];
      void transport.leaveRtc?.().catch(() => undefined);
    };
  }, [transport, live, release]);

  const toggle = useCallback(async () => {
    if (state !== 'idle') { await release(); return; }
    setError('');
    setState('connecting');
    const turn = ++generation.current;
    let captured: MediaStream | undefined;
    try {
      const { Room, RoomEvent, Track } = await import('livekit-client');
      // Obtain permission within the explicit user gesture; no background capture.
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      captured = media;
      const track = media.getAudioTracks()[0]!;
      if (turn !== generation.current) { media.getTracks().forEach(t => t.stop()); return; }
      microphone.current = media;
      const connection = await transport.joinRtc!(speechMode);
      if (turn !== generation.current) { media.getTracks().forEach(t => t.stop()); await transport.leaveRtc?.(); return; }
      const current = new Room();
      room.current = current;
      current.on(RoomEvent.TrackSubscribed, remote => {
        if (room.current === current && turn === generation.current && remote.kind === Track.Kind.Audio) {
          const element = remote.attach();
          element.autoplay = true;
          document.body.appendChild(element);
          audio.current.push(element);
        }
      });
      current.on(RoomEvent.Disconnected, () => { if (room.current === current) void release(); });
      try {
        const started = await startRtcSession({
          connect: () => current.connect(connection.url, connection.token),
          publish: () => current.localParticipant.publishTrack(track, { source: Track.Source.Microphone }),
          startAudio: () => current.startAudio(),
          isCurrent: () => turn === generation.current && room.current === current,
          discard: async () => { media.getTracks().forEach(t => t.stop()); await current.disconnect(); },
        });
        if (started) setState('live');
      } catch (failure) {
        media.getTracks().forEach(t => t.stop());
        throw failure;
      }
    } catch {
      captured?.getTracks().forEach(track => track.stop());
      if (turn !== generation.current) return;
      await release();
      setError('RTC could not start. Check microphone permission and local media service.');
    }
  }, [state, release, speechMode, transport]);

  return {
    state, speechMode, setSpeechMode, error,
    available: serviceAvailable && Boolean(transport.joinRtc),
    toggle, release,
  };
}
