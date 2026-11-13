import { join } from 'node:path';
import { inspectAsrConfig, type AsrReadiness, type WhisperCppConfig } from './whisper-cpp-adapter.ts';

/**
 * Speech configuration from the environment, with D: as the default home for models.
 *
 * Nothing is downloaded, nothing is discovered by scanning disks, and a missing value
 * produces a specific reason rather than a silent fallback to the cloud or to a browser
 * API that might not be local.
 */
export const DEFAULT_MODEL_ROOT = 'D:\\AI\\Models\\SpeechRecognition';
export const DEFAULT_RUNTIME_ROOT = 'D:\\AI\\Runtimes\\whisper-arm64\\Release';
export const DEFAULT_SPEECH_DATA = 'D:\\JarvisData\\Speech';

export type AsrEngine = 'whisper-cpp' | 'windows' | 'none';

export interface ResolvedAsr {
  engine: AsrEngine;
  readiness: AsrReadiness;
  config?: WhisperCppConfig;
}

export function resolveAsrConfig(env: NodeJS.ProcessEnv = process.env): ResolvedAsr {
  const requested = (env.JARVIS_ASR_ENGINE ?? 'none').trim().toLowerCase();
  if (requested === 'none' || requested === '') {
    return { engine: 'none', readiness: { ready: false, problem: 'bad-config', detail: 'No local speech engine is configured (JARVIS_ASR_ENGINE).' } };
  }
  if (requested === 'windows') {
    // Windows System.Speech is a streaming recogniser driven by WindowsSpeechInput; it is
    // not a frame-based AsrAdapter, so it is reported as an engine without a config here.
    return { engine: 'windows', readiness: { ready: true, detail: 'Windows System.Speech is available through the native recogniser path.' } };
  }
  if (requested !== 'whisper-cpp') {
    return { engine: 'none', readiness: { ready: false, problem: 'bad-config', detail: `Unsupported JARVIS_ASR_ENGINE: ${requested}` } };
  }

  const config: WhisperCppConfig = {
    executable: env.JARVIS_ASR_EXECUTABLE?.trim() || join(env.JARVIS_AI_ROOT ?? DEFAULT_RUNTIME_ROOT, 'whisper-cli.exe'),
    modelPath: env.JARVIS_ASR_MODEL_PATH?.trim() || join(DEFAULT_MODEL_ROOT, 'ggml-small.en.bin'),
    tempDir: env.JARVIS_ASR_TEMP_DIR?.trim() || join(env.JARVIS_DATA_ROOT ?? DEFAULT_SPEECH_DATA, 'tmp'),
    language: env.JARVIS_ASR_LANGUAGE?.trim() || 'en',
    ...(env.JARVIS_ASR_THREADS ? { threads: Number(env.JARVIS_ASR_THREADS) } : {}),
    ...(env.JARVIS_ASR_TIMEOUT_MS ? { timeoutMs: Number(env.JARVIS_ASR_TIMEOUT_MS) } : {}),
  };
  return { engine: 'whisper-cpp', readiness: inspectAsrConfig(config), config };
}

/** One line for the operator, with no paths that could contain anything sensitive. */
export function describeAsr(resolved: ResolvedAsr): string {
  return resolved.readiness.ready
    ? `asr.ready engine=${resolved.engine}`
    : `asr.unavailable engine=${resolved.engine} problem=${resolved.readiness.problem ?? 'unknown'} detail=${resolved.readiness.detail}`;
}
