import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AsrAdapter, AudioFrame } from '../adapters.ts';

/**
 * whisper.cpp local ASR.
 *
 * Why this engine: the in-repo local sidecar uses faster-whisper, whose CTranslate2 backend
 * publishes win_amd64 wheels but no win_arm64 wheel (verified against PyPI metadata), so it
 * cannot install on this workstation. whisper.cpp is plain C/C++ and builds natively for
 * Windows ARM64 with clang-cl, and its GGML models are small enough to run on CPU.
 *
 * Honest limits:
 *  - no streaming. whisper.cpp transcribes a *complete* utterance, so `final: false`
 *    yields '' rather than inventing partials.
 *  - 16 kHz mono float32 in, 16-bit PCM WAV on disk, because the CLI takes a file. The
 *    temporary file is bounded, written outside the repo, and removed in `finally`.
 */

export const ASR_SAMPLE_RATE = 16_000;
export const ASR_MAX_SECONDS = 30;

export type AsrConfigProblem =
  | 'engine-missing'
  | 'engine-not-executable'
  | 'model-missing'
  | 'temp-dir-missing'
  | 'bad-config';

export interface WhisperCppConfig {
  /** Absolute path to whisper-cli (or main.exe in older builds). */
  executable: string;
  /** Absolute path to a ggml-*.bin model, preferably on D:. */
  modelPath: string;
  /** Scratch directory for the temporary WAV. Must exist; never the repo. */
  tempDir: string;
  language?: string;
  threads?: number;
  timeoutMs?: number;
  maxSeconds?: number;
  /**
   * Arguments placed before the engine flags. Only needed when the engine is reached
   * through an interpreter entry point (for example a packaged script or a test fixture).
   */
  argsPrefix?: string[];
}

export interface AsrReadiness {
  ready: boolean;
  problem?: AsrConfigProblem;
  detail: string;
}

/**
 * Validate configuration without running anything. Every failure has a distinct reason so
 * the interface can say "model missing" rather than "voice unavailable".
 */
export function inspectAsrConfig(config: Partial<WhisperCppConfig> | undefined): AsrReadiness {
  if (!config) return { ready: false, problem: 'bad-config', detail: 'No speech configuration was supplied.' };
  const { executable, modelPath, tempDir } = config;
  if (!executable || !modelPath || !tempDir) {
    return { ready: false, problem: 'bad-config', detail: 'executable, modelPath and tempDir are all required.' };
  }
  if (!existsSync(executable)) return { ready: false, problem: 'engine-missing', detail: `Speech engine not found at ${executable}` };
  try {
    if (!statSync(executable).isFile()) return { ready: false, problem: 'engine-not-executable', detail: `${executable} is not a file.` };
  } catch {
    return { ready: false, problem: 'engine-not-executable', detail: `${executable} could not be read.` };
  }
  if (!existsSync(modelPath)) return { ready: false, problem: 'model-missing', detail: `Speech model not found at ${modelPath}` };
  if (!modelPath.toLowerCase().endsWith('.bin')) return { ready: false, problem: 'model-missing', detail: 'Speech model must be a ggml .bin file.' };
  if (!existsSync(tempDir)) return { ready: false, problem: 'temp-dir-missing', detail: `Scratch directory not found at ${tempDir}` };
  if ((config.maxSeconds ?? ASR_MAX_SECONDS) <= 0) return { ready: false, problem: 'bad-config', detail: 'maxSeconds must be positive.' };
  if ((config.timeoutMs ?? 20_000) <= 0) return { ready: false, problem: 'bad-config', detail: 'timeoutMs must be positive.' };
  return { ready: true, detail: 'Speech engine and model are present.' };
}

/** Float32 frames → 16-bit PCM WAV. Rejects anything the engine cannot consume. */
export function encodeWav(frames: readonly AudioFrame[], maxSeconds = ASR_MAX_SECONDS): Buffer {
  if (!frames.length) throw new Error('no audio frames');
  let total = 0;
  for (const frame of frames) {
    if (!(frame.samples instanceof Float32Array)) throw new Error('audio frame samples must be Float32Array');
    if (frame.sampleRate !== ASR_SAMPLE_RATE) throw new Error(`audio must be ${ASR_SAMPLE_RATE} Hz mono, got ${frame.sampleRate}`);
    for (const sample of frame.samples) if (!Number.isFinite(sample)) throw new Error('audio contains a non-finite sample');
    total += frame.samples.length;
    if (total > ASR_SAMPLE_RATE * maxSeconds) throw new Error(`audio exceeds the ${maxSeconds}s limit`);
  }
  if (total === 0) throw new Error('no audio samples');

  const data = Buffer.alloc(total * 2);
  let offset = 0;
  for (const frame of frames) {
    for (const sample of frame.samples) {
      const clamped = Math.max(-1, Math.min(1, sample));
      data.writeInt16LE(Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), offset);
      offset += 2;
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(ASR_SAMPLE_RATE, 24);
  header.writeUInt32LE(ASR_SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** whisper.cpp prints one segment per line; drop its decorations and noise markers. */
export function cleanTranscript(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\[[\d:.\s\->]+\]\s*/, '').trim())
    .filter(line => line.length > 0 && !/^\[(BLANK_AUDIO|MUSIC|SOUND|NOISE)\]$/i.test(line) && !/^\((.*)\)$/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4096);
}

const MAX_STDOUT_BYTES = 64 * 1024;

export class WhisperCppAsrAdapter implements AsrAdapter {
  constructor(private readonly config: WhisperCppConfig) {}

  readiness(): AsrReadiness { return inspectAsrConfig(this.config); }

  /**
   * Transcribe one utterance. Arguments are passed as an array with no shell, so a path or
   * a language tag can never be interpreted as a command.
   */
  async transcribe(frames: AudioFrame[], final: boolean, signal: AbortSignal): Promise<string> {
    // whisper.cpp is not streaming: a partial would be an invention, not an observation.
    if (!final) return '';
    if (signal.aborted) throw new Error('speech recognition cancelled');
    const readiness = this.readiness();
    if (!readiness.ready) throw new Error(readiness.detail);

    const maxSeconds = this.config.maxSeconds ?? ASR_MAX_SECONDS;
    const wav = encodeWav(frames, maxSeconds);
    const dir = mkdtempSync(join(this.config.tempDir, 'jarvis-asr-'));
    const file = join(dir, 'utterance.wav');
    writeFileSync(file, wav, { mode: 0o600 });

    try {
      return await this.run(file, signal);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort: bounded, private scratch */ }
    }
  }

  private run(file: string, signal: AbortSignal): Promise<string> {
    const timeoutMs = this.config.timeoutMs ?? 20_000;
    const args = [
      ...(this.config.argsPrefix ?? []),
      '-m', this.config.modelPath,
      '-f', file,
      '-l', this.config.language ?? 'en',
      '-t', String(Math.max(1, this.config.threads ?? 4)),
      '-nt', '-np',   // no timestamps, no progress output
    ];
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = {};
      for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP'] ) if (process.env[key]) env[key] = process.env[key];
      const child = spawn(this.config.executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env, shell: false });
      let stdout = '';
      let stderr = '';
      let killedBy: 'timeout' | 'cancel' | undefined;
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(cleanTranscript(stdout));
      };
      const terminate = (reason: 'timeout' | 'cancel') => {
        killedBy = reason;
        if (!child.killed) child.kill();
      };
      const cancel = () => terminate('cancel');
      const timer = setTimeout(() => terminate('timeout'), timeoutMs);
      signal.addEventListener('abort', cancel, { once: true });

      child.stdout.on('data', (chunk: Buffer) => { if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 2048) stderr += chunk.toString('utf8'); });
      child.once('error', error => finish(new Error(`speech engine failed to start: ${error.message}`)));
      child.once('exit', (code) => {
        if (killedBy === 'cancel') return finish(new Error('speech recognition cancelled'));
        if (killedBy === 'timeout') return finish(new Error('speech recognition timed out'));
        if (code !== 0) return finish(new Error(`speech engine exited with ${code}${stderr ? ': ' + stderr.trim().slice(0, 200) : ''}`));
        finish();
      });
    });
  }
}
