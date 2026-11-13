import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeAsr, resolveAsrConfig } from './env.ts';

/**
 * Configuration resolution. These tests are about what the process says when something is
 * missing or wrong: a precise reason is the difference between "voice unavailable" and
 * "the model file is not where you think it is".
 */

const root = mkdtempSync(join(tmpdir(), 'jarvis-asr-env-'));

describe('speech configuration from the environment', () => {
  it('1. reports that no engine is configured', () => {
    const resolved = resolveAsrConfig({});
    expect(resolved.engine).toBe('none');
    expect(resolved.readiness.problem).toBe('bad-config');
    expect(describeAsr(resolved)).toContain('asr.unavailable');
  });

  it('2. rejects an unknown engine instead of guessing one', () => {
    const resolved = resolveAsrConfig({ JARVIS_ASR_ENGINE: 'cloud-whisper' });
    expect(resolved.engine).toBe('none');
    expect(resolved.readiness.ready).toBe(false);
  });

  it('3. recognises the native Windows recogniser as its own path', () => {
    const resolved = resolveAsrConfig({ JARVIS_ASR_ENGINE: 'windows' });
    expect(resolved.engine).toBe('windows');
    expect(resolved.readiness.ready).toBe(true);
    expect(describeAsr(resolved)).toBe('asr.ready engine=windows');
  });

  it('4. points at D: by default for both the engine and the model', () => {
    const resolved = resolveAsrConfig({ JARVIS_ASR_ENGINE: 'whisper-cpp' });
    expect(resolved.config?.modelPath).toBe('D:\\AI\\Models\\SpeechRecognition\\ggml-small.en.bin');
    expect(resolved.config?.executable).toBe('D:\\AI\\Runtimes\\whisper\\whisper-cli.exe');
    expect(resolved.config?.tempDir).toBe('D:\\JarvisData\\Speech\\tmp');
  });

  it('5. honours explicit overrides', () => {
    const resolved = resolveAsrConfig({
      JARVIS_ASR_ENGINE: 'whisper-cpp', JARVIS_ASR_EXECUTABLE: 'D:\\x\\whisper-cli.exe',
      JARVIS_ASR_MODEL_PATH: 'D:\\x\\ggml-tiny.en.bin', JARVIS_ASR_TEMP_DIR: 'D:\\x\\tmp',
      JARVIS_ASR_LANGUAGE: 'en-GB', JARVIS_ASR_THREADS: '6', JARVIS_ASR_TIMEOUT_MS: '15000',
    });
    expect(resolved.config).toMatchObject({ language: 'en-GB', threads: 6, timeoutMs: 15000 });
  });

  it('6. reports a missing engine file rather than a generic failure', () => {
    const resolved = resolveAsrConfig({ JARVIS_ASR_ENGINE: 'whisper-cpp', JARVIS_ASR_EXECUTABLE: join(root, 'missing.exe'), JARVIS_ASR_MODEL_PATH: join(root, 'ggml-small.en.bin'), JARVIS_ASR_TEMP_DIR: root });
    expect(resolved.readiness.problem).toBe('engine-missing');
    expect(describeAsr(resolved)).toContain('engine-missing');
  });

  it('7. is ready when all three paths exist', () => {
    const dir = mkdtempSync(join(root, 'ok-'));
    const exe = join(dir, 'whisper-cli.exe');
    const bin = join(dir, 'ggml-tiny.en.bin');
    writeFileSync(exe, ''); writeFileSync(bin, '');
    mkdirSync(join(dir, 'tmp'));
    const resolved = resolveAsrConfig({ JARVIS_ASR_ENGINE: 'whisper-cpp', JARVIS_ASR_EXECUTABLE: exe, JARVIS_ASR_MODEL_PATH: bin, JARVIS_ASR_TEMP_DIR: join(dir, 'tmp') });
    expect(resolved.readiness.ready).toBe(true);
    expect(describeAsr(resolved)).toBe('asr.ready engine=whisper-cpp');
  });

  it('8. never reports ready for an unsupported engine name', () => {
    for (const name of ['', 'none', 'vosk', 'azure']) {
      expect(resolveAsrConfig({ JARVIS_ASR_ENGINE: name }).readiness.ready).toBe(false);
    }
  });
});
