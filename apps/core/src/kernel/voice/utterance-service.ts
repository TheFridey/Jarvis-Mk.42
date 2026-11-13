import { Buffer } from 'node:buffer';
import type { AsrAdapter, AudioFrame } from '@jarvis/speech';
import { decodeWav } from '@jarvis/speech';

/**
 * One utterance, transcribed.
 *
 * The browser sends PCM it captured locally; this turns that into the frames the local
 * recogniser takes, enforces the same bounds the adapter does, and returns a single final
 * transcript. Nothing here decides *authority* — the HTTP layer has already authenticated a
 * desktop session, and the transcript re-enters the normal conversation path afterwards,
 * where the privacy and grant rules apply exactly as they do to typing.
 */

export const UTTERANCE_SAMPLE_RATE = 16_000;
export const UTTERANCE_MAX_SECONDS = 30;
/** 16 kHz mono 16-bit: 32 000 bytes per second. */
export const UTTERANCE_MAX_BYTES = UTTERANCE_SAMPLE_RATE * 2 * UTTERANCE_MAX_SECONDS;

export type UtteranceProblem =
  | 'empty'
  | 'too_large'
  | 'bad_rate'
  | 'bad_channels'
  | 'bad_sample_width'
  | 'silence'
  | 'engine_unavailable';

export interface UtteranceResult {
  ok: boolean;
  transcript?: string;
  problem?: UtteranceProblem;
  detail?: string;
  audioMs?: number;
  latencyMs?: number;
}

/** 16-bit little-endian mono PCM → frames, with no resampling guesswork. */
export function pcmToFrames(pcm: Buffer, sampleRate: number, channels: number, bytesPerSample = 2): AudioFrame[] {
  if (channels !== 1) throw new Error('bad_channels');
  if (sampleRate !== UTTERANCE_SAMPLE_RATE) throw new Error('bad_rate');
  if (bytesPerSample !== 2) throw new Error('bad_sample_width');
  if (pcm.length === 0) throw new Error('empty');
  if (pcm.length % 2 !== 0) throw new Error('bad_sample_width');
  if (pcm.length > UTTERANCE_MAX_BYTES) throw new Error('too_large');
  const count = pcm.length / 2;
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const value = pcm.readInt16LE(index * 2);
    samples[index] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }
  return [{ samples, sampleRate: UTTERANCE_SAMPLE_RATE, capturedAt: Date.now() }];
}

export interface UtteranceServiceDeps {
  /** Resolved at call time so a missing engine is reported, not thrown at boot. */
  adapter: () => AsrAdapter | undefined;
  timeoutMs: number;
}

export class UtteranceService {
  constructor(private readonly deps: UtteranceServiceDeps) {}

  async transcribe(input: { body: Buffer; contentType: string }): Promise<UtteranceResult> {
    let frames: AudioFrame[];
    try {
      // WAV is accepted because a recorded file is the honest way to test this path;
      // raw PCM is what the browser sends.
      // Sniff the container rather than trusting a header the caller controls.
      const isWav = input.body.length > 12 && input.body.subarray(0, 4).toString() === 'RIFF' && input.body.subarray(8, 12).toString() === 'WAVE';
      frames = isWav ? decodeWav(input.body) : pcmToFrames(input.body, UTTERANCE_SAMPLE_RATE, 1);
    } catch (error) {
      const problem = (error as Error).message as UtteranceProblem;
      const known: UtteranceProblem[] = ['empty', 'too_large', 'bad_rate', 'bad_channels', 'bad_sample_width'];
      return { ok: false, problem: known.includes(problem) ? problem : 'bad_sample_width', detail: 'Audio was rejected before transcription.' };
    }

    const adapter = this.deps.adapter();
    if (!adapter) return { ok: false, problem: 'engine_unavailable', detail: 'No local speech engine is configured.' };

    const audioMs = Math.round((frames.reduce((sum, frame) => sum + frame.samples.length, 0) / UTTERANCE_SAMPLE_RATE) * 1000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs);
    const started = Date.now();
    try {
      const transcript = await adapter.transcribe(frames, true, controller.signal);
      const latencyMs = Date.now() - started;
      if (!transcript.trim()) return { ok: true, transcript: '', problem: 'silence', audioMs, latencyMs };
      return { ok: true, transcript, audioMs, latencyMs };
    } catch (error) {
      // Keep the classification the adapter produced; never echo raw audio or model paths.
      const message = (error as Error).message;
      const problem: UtteranceProblem = /cancelled/i.test(message) ? 'silence' : /timed out/i.test(message) ? 'silence' : 'engine_unavailable';
      return { ok: false, problem, detail: message.slice(0, 160), audioMs };
    } finally {
      clearTimeout(timer);
    }
  }
}
