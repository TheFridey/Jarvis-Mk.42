import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWav, WhisperCppAsrAdapter } from './whisper-cpp-adapter.ts';

/**
 * Real-engine qualification. Skipped unless an actual ARM64 whisper-cli and a real model are
 * installed and JARVIS_ASR_REAL_QUALIFY=1 — so the ordinary test run never depends on
 * machine state, and a green suite never implies a working engine.
 *
 * Fixture: a synthetic System.Speech utterance, not a microphone recording.
 */
const engine = process.env.JARVIS_ASR_EXECUTABLE ?? 'D:\\AI\\Runtimes\\whisper-arm64\\Release\\whisper-cli.exe';
const model = process.env.JARVIS_ASR_MODEL_PATH ?? 'D:\\AI\\Models\\SpeechRecognition\\ggml-base.en.bin';
const fixture = process.env.JARVIS_ASR_FIXTURE_WAV ?? 'D:\\JarvisData\\Speech\\fixtures\\spoken-check.wav';
const enabled = process.env.JARVIS_ASR_REAL_QUALIFY === '1' && existsSync(engine) && existsSync(model) && existsSync(fixture);

describe.skipIf(!enabled)('real whisper.cpp engine', () => {
  it('transcribes the synthetic fixture through the adapter', async () => {
    const frames = decodeWav(readFileSync(fixture));
    const adapter = new WhisperCppAsrAdapter({
      executable: engine,
      modelPath: model,
      tempDir: process.env.JARVIS_ASR_TEMP_DIR ?? 'D:\\JarvisData\\Speech\\tmp',
      timeoutMs: 60_000,
    });
    const started = Date.now();
    const transcript = await adapter.transcribe(frames, true, new AbortController().signal);
    const elapsed = Date.now() - started;
    const audioSeconds = frames.reduce((sum, frame) => sum + frame.samples.length, 0) / 16_000;

    expect(transcript.toLowerCase()).toContain('jarvis');
    expect(transcript.toLowerCase()).toContain('microphone check');
    expect(transcript.toLowerCase()).toMatch(/code ?name/);
    expect(transcript.toLowerCase()).toContain('aurora');
    expect(elapsed).toBeLessThan(120_000);

    // Recorded so the qualification leaves a number rather than an impression.
    console.log(`[asr] audio=${audioSeconds.toFixed(2)}s elapsed=${(elapsed / 1000).toFixed(2)}s rtf=${(elapsed / 1000 / audioSeconds).toFixed(2)}`);
  }, 180_000);

  it('returns nothing for silence rather than inventing words', async () => {
    const adapter = new WhisperCppAsrAdapter({
      executable: engine,
      modelPath: model,
      tempDir: process.env.JARVIS_ASR_TEMP_DIR ?? 'D:\\JarvisData\\Speech\\tmp',
      timeoutMs: 60_000,
    });
    const silent = [{ samples: new Float32Array(16_000 * 2), sampleRate: 16_000, capturedAt: Date.now() }];
    const transcript = await adapter.transcribe(silent, true, new AbortController().signal);
    expect(transcript.trim()).toBe('');
  }, 180_000);
});
