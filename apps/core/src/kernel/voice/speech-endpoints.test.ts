import { describe, expect, it } from 'vitest';
import { cleanSpeechText, synthesiseToWav, SYNTHESIS_MAX_CHARS } from './speech-synthesis.ts';
import { pcmToFrames, UtteranceService, UTTERANCE_MAX_BYTES } from './utterance-service.ts';

/**
 * The connected path's two local edges: audio in, audio out. Both are exercised with
 * synthetic data; the recogniser and synthesiser themselves are qualified separately with
 * the real installed engines.
 */

const pcm = (samples: number[]): Buffer => {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => buffer.writeInt16LE(Math.round(value * 32767), index * 2));
  return buffer;
};

const adapter = (transcript: string, fail?: string) => ({
  async transcribe(_frames: unknown, _final: boolean, signal: AbortSignal) {
    if (signal.aborted) throw new Error('speech recognition cancelled');
    if (fail) throw new Error(fail);
    return transcript;
  },
});

const service = (impl: ReturnType<typeof adapter> | undefined) => new UtteranceService({ adapter: () => impl as never, timeoutMs: 5000 });

describe('utterance audio validation', () => {
  it('converts 16-bit mono PCM to 16 kHz frames', () => {
    const frames = pcmToFrames(pcm([0, 0.5, -0.5]), 16_000, 1);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.sampleRate).toBe(16_000);
    expect(frames[0]!.samples[1]).toBeCloseTo(0.5, 3);
    expect(frames[0]!.samples[2]).toBeCloseTo(-0.5, 3);
  });

  it('rejects the wrong sample rate rather than resampling silently', () => {
    expect(() => pcmToFrames(pcm([0.1]), 48_000, 1)).toThrow('bad_rate');
  });

  it('rejects stereo, odd byte counts and empty bodies', () => {
    expect(() => pcmToFrames(pcm([0.1]), 16_000, 2)).toThrow('bad_channels');
    expect(() => pcmToFrames(Buffer.alloc(3), 16_000, 1)).toThrow('bad_sample_width');
    expect(() => pcmToFrames(Buffer.alloc(0), 16_000, 1)).toThrow('empty');
  });

  it('rejects an utterance longer than the bound', () => {
    expect(() => pcmToFrames(Buffer.alloc(UTTERANCE_MAX_BYTES + 2), 16_000, 1)).toThrow('too_large');
  });

  it('reports a bad request as a problem instead of throwing at the caller', async () => {
    const result = await service(adapter('unused')).transcribe({ body: Buffer.alloc(3), contentType: 'application/octet-stream' });
    expect(result).toMatchObject({ ok: false, problem: 'bad_sample_width' });
  });
});

describe('utterance transcription', () => {
  it('returns the transcript with its duration and latency', async () => {
    const result = await service(adapter('Hello Jarvis.')).transcribe({ body: pcm(new Array(16_000).fill(0.2)), contentType: 'application/octet-stream' });
    expect(result.ok).toBe(true);
    expect(result.transcript).toBe('Hello Jarvis.');
    expect(result.audioMs).toBe(1000);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('reports silence as silence, not as an empty success', async () => {
    const result = await service(adapter('')).transcribe({ body: pcm(new Array(1600).fill(0.1)), contentType: 'application/octet-stream' });
    expect(result).toMatchObject({ ok: true, transcript: '', problem: 'silence' });
  });

  it('reports a missing engine instead of pretending to transcribe', async () => {
    const result = await service(undefined).transcribe({ body: pcm([0.2]), contentType: 'application/octet-stream' });
    expect(result).toMatchObject({ ok: false, problem: 'engine_unavailable' });
    expect(result.transcript).toBeUndefined();
  });

  it('classifies an engine failure without echoing raw audio or paths', async () => {
    const result = await service(adapter('x', 'speech engine exited with 1: D:\\secret\\path')).transcribe({ body: pcm([0.2]), contentType: 'application/octet-stream' });
    expect(result.ok).toBe(false);
    expect(result.detail).not.toContain('\u0000');
    expect((result.detail ?? '').length).toBeLessThanOrEqual(160);
  });
});

describe('synthesis edge', () => {
  it('bounds and cleans the spoken text', () => {
    expect(cleanSpeechText('  Good\u0000   evening  ')).toBe('Good evening');
    expect(cleanSpeechText('a'.repeat(SYNTHESIS_MAX_CHARS + 100)).length).toBe(SYNTHESIS_MAX_CHARS);
  });

  it('refuses to synthesise nothing', async () => {
    await expect(synthesiseToWav('   ')).rejects.toThrow('nothing to speak');
  });

  it('returns audio bytes from the injected runner', async () => {
    const bytes = await synthesiseToWav('Good evening.', { runner: async text => Buffer.from(`WAV:${text}`) });
    expect(bytes.toString()).toBe('WAV:Good evening.');
  });
});
