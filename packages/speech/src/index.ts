/**
 * Local speech (ASR) shared by the composition roots that need it: the Kernel's voice
 * endpoint and the standalone voice process. Extracted from apps/voice so the Kernel does
 * not import another application.
 */
export * from './whisper-cpp-adapter.ts';
export * from './env.ts';
