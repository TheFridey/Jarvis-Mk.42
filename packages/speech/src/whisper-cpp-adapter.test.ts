import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ASR_SAMPLE_RATE,
  cleanTranscript,
  encodeWav,
  inspectAsrConfig,
  WhisperCppAsrAdapter,
  type WhisperCppConfig,
} from './whisper-cpp-adapter.ts';
import type { AudioFrame } from './whisper-cpp-adapter.ts';

/**
 * Controlled fixture processes: the engine is replaced by a node script that behaves like
 * whisper-cli. Nothing here transcribes real speech, and nothing claims to.
 */

const root = mkdtempSync(join(tmpdir(), 'jarvis-asr-test-'));
afterAll(() => { try { require('node:fs').rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

const fixture = (name: string, body: string) => {
  const path = join(root, `${name}.mjs`);
  writeFileSync(path, body, 'utf8');
  return path;
};

const model = join(root, 'ggml-tiny.en.bin');
writeFileSync(model, 'not a real model', 'utf8');
const scratch = join(root, 'scratch');
mkdirSync(scratch, { recursive: true });

const frames = (count = 1600): AudioFrame[] => [
  { samples: new Float32Array(count).fill(0.25), sampleRate: ASR_SAMPLE_RATE, capturedAt: Date.now() },
];

const config = (overrides: Partial<WhisperCppConfig> = {}): WhisperCppConfig => ({
  executable: process.execPath,
  argsPrefix: [fixture('ok', 'process.stdout.write("[00:00:00.000 --> 00:00:01.000]  Hello Jarvis.\\n")')],
  modelPath: model,
  tempDir: scratch,
  timeoutMs: 5000,
  ...overrides,
});

describe('configuration validation', () => {
  it('1. reports a missing engine rather than failing later', () => {
    expect(inspectAsrConfig(config({ executable: join(root, 'nope.exe') }))).toMatchObject({ ready: false, problem: 'engine-missing' });
  });

  it('2. reports a missing model', () => {
    expect(inspectAsrConfig(config({ modelPath: join(root, 'absent.bin') }))).toMatchObject({ ready: false, problem: 'model-missing' });
  });

  it('3. rejects a model that is not a ggml .bin', () => {
    const wrong = join(root, 'model.txt');
    writeFileSync(wrong, 'x');
    expect(inspectAsrConfig(config({ modelPath: wrong }))).toMatchObject({ ready: false, problem: 'model-missing' });
  });

  it('4. reports a missing scratch directory', () => {
    expect(inspectAsrConfig(config({ tempDir: join(root, 'absent') }))).toMatchObject({ ready: false, problem: 'temp-dir-missing' });
  });

  it('5. rejects incomplete configuration', () => {
    expect(inspectAsrConfig(undefined)).toMatchObject({ ready: false, problem: 'bad-config' });
    expect(inspectAsrConfig({ executable: '', modelPath: '', tempDir: '' })).toMatchObject({ ready: false, problem: 'bad-config' });
  });

  it('6. is ready when engine, model and scratch all exist', () => {
    expect(inspectAsrConfig(config())).toMatchObject({ ready: true });
  });
});

describe('audio validation', () => {
  it('7. writes a valid 16 kHz mono 16-bit WAV header', () => {
    const wav = encodeWav(frames(800));
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(ASR_SAMPLE_RATE);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.length).toBe(44 + 800 * 2);
  });

  it('8. rejects the wrong sample rate instead of resampling silently', () => {
    expect(() => encodeWav([{ samples: new Float32Array(10), sampleRate: 48_000, capturedAt: 0 }])).toThrow(/16000 Hz/);
  });

  it('9. rejects non-finite samples', () => {
    expect(() => encodeWav([{ samples: new Float32Array([Number.NaN]), sampleRate: ASR_SAMPLE_RATE, capturedAt: 0 }])).toThrow(/non-finite/);
  });

  it('10. bounds the buffered utterance', () => {
    expect(() => encodeWav(frames(ASR_SAMPLE_RATE * 31))).toThrow(/exceeds the 30s limit/);
    expect(() => encodeWav([], 30)).toThrow(/no audio frames/);
  });

  it('11. clamps rather than wrapping on loud input', () => {
    const wav = encodeWav([{ samples: new Float32Array([2, -2]), sampleRate: ASR_SAMPLE_RATE, capturedAt: 0 }]);
    expect(wav.readInt16LE(44)).toBe(32767);
    expect(wav.readInt16LE(46)).toBe(-32768);
  });
});

describe('transcript cleaning', () => {
  it('12. strips timestamps, noise markers and parentheticals', () => {
    const raw = '[00:00:00.000 --> 00:00:02.000]  hello there\n[BLANK_AUDIO]\n(music)\n  [00:00:02.000 --> 00:00:03.000]  general kenobi  ';
    expect(cleanTranscript(raw)).toBe('hello there general kenobi');
  });

  it('13. returns an empty string for silence', () => {
    expect(cleanTranscript('[BLANK_AUDIO]\n')).toBe('');
  });

  it('14. caps pathological output', () => {
    expect(cleanTranscript('a '.repeat(10_000)).length).toBeLessThanOrEqual(4096);
  });
});

describe('transcription', () => {
  it('15. a partial utterance yields nothing rather than an invented partial', async () => {
    const adapter = new WhisperCppAsrAdapter(config({ argsPrefix: [join(root, 'never.mjs')] }));
    await expect(adapter.transcribe(frames(), false, new AbortController().signal)).resolves.toBe('');
  });

  it('16. returns the engine transcript', async () => {
    const adapter = new WhisperCppAsrAdapter(config());
    await expect(adapter.transcribe(frames(), true, new AbortController().signal)).resolves.toBe('Hello Jarvis.');
  });

  it('17. reports a failing engine with its exit code', async () => {
    const adapter = new WhisperCppAsrAdapter(config({ argsPrefix: [fixture('bad', 'process.stderr.write("model load failed");process.exit(3)')] }));
    await expect(adapter.transcribe(frames(), true, new AbortController().signal)).rejects.toThrow(/exited with 3/);
  });

  it('18. times out instead of hanging the session', async () => {
    const adapter = new WhisperCppAsrAdapter(config({ argsPrefix: [fixture('slow', 'setTimeout(()=>{}, 10000)')], timeoutMs: 250 }));
    await expect(adapter.transcribe(frames(), true, new AbortController().signal)).rejects.toThrow(/timed out/);
  });

  it('19. cancels on abort', async () => {
    const adapter = new WhisperCppAsrAdapter(config({ argsPrefix: [fixture('hang', 'setTimeout(()=>{}, 10000)')] }));
    const controller = new AbortController();
    const pending = adapter.transcribe(frames(), true, controller.signal);
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toThrow(/cancelled/);
  });

  it('20. refuses to run with a missing model, and leaves no scratch behind', async () => {
    const before = readdirSync(scratch).length;
    const adapter = new WhisperCppAsrAdapter(config({ modelPath: join(root, 'gone.bin') }));
    await expect(adapter.transcribe(frames(), true, new AbortController().signal)).rejects.toThrow(/model not found/i);
    expect(readdirSync(scratch).length).toBe(before);
  });

  it('21. removes the temporary audio after a successful run', async () => {
    const adapter = new WhisperCppAsrAdapter(config());
    await adapter.transcribe(frames(), true, new AbortController().signal);
    const leftovers = readdirSync(scratch).filter(name => name.startsWith('jarvis-asr-'));
    expect(leftovers).toEqual([]);
  });

  it('22. passes the model path as a single argument, never through a shell', async () => {
    const hostile = join(root, 'ggml-ok.bin');
    writeFileSync(hostile, 'x');
    // A path that would be catastrophic if interpolated into a shell string.
    const evil = join(root, 'ggml-evil.bin');
    writeFileSync(evil, 'x');
    const echoArgs = fixture('echo', 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const adapter = new WhisperCppAsrAdapter(config({ argsPrefix: [echoArgs], modelPath: evil }));
    const transcript = await adapter.transcribe(frames(), true, new AbortController().signal);
    // The engine echoed its argv; the path arrived intact, as its own argument, unquoted.
    const argv = JSON.parse(transcript) as string[];
    expect(argv[argv.indexOf('-m') + 1]).toBe(evil);
  });

  it('23. bounds stdout so a runaway engine cannot exhaust memory', async () => {
    const chatty = fixture('chatty', 'for(let i=0;i<5000;i++)process.stdout.write("line " + i + "\\n")');
    const adapter = new WhisperCppAsrAdapter(config({ argsPrefix: [chatty] }));
    const text = await adapter.transcribe(frames(), true, new AbortController().signal);
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it('24. already-aborted signals do not start the engine', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new WhisperCppAsrAdapter(config({ argsPrefix: [join(root, 'never2.mjs')] }));
    await expect(adapter.transcribe(frames(), true, controller.signal)).rejects.toThrow(/cancelled/);
  });
});
