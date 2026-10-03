/** Local inference contracts. None of these interfaces can submit Kernel commands. */
export interface AudioFrame { samples: Float32Array; sampleRate: number; capturedAt: number }
export interface WakeWordAdapter { detect(frame: AudioFrame): Promise<{ detected: boolean; confidence: number }>; reset(): void }
export interface VadAdapter { detect(frame: AudioFrame): Promise<{ speech: boolean; confidence: number }> }
export interface AsrAdapter { transcribe(frames: AudioFrame[], final: boolean, signal: AbortSignal): Promise<string> }
export interface TtsAdapter { synthesize(text: string, signal: AbortSignal): AsyncIterable<AudioFrame> }
export interface PlaybackAdapter { play(frames: AsyncIterable<AudioFrame>, signal: AbortSignal): Promise<void>; cancel(): Promise<void>; selectDevice(id: string): Promise<void> }
export interface AudioDevice { id: string; name: string; input: boolean; output: boolean; defaultInput: boolean; defaultOutput: boolean }
export interface AudioDeviceManager { enumerate(): Promise<AudioDevice[]>; selectInput(id: string): Promise<void>; selectOutput(id: string): Promise<void> }
export interface VoiceMeasurement { name: 'wake'|'asr'|'interruption'|'response'|'device-recovery'; latencyMs: number; observedAt: string }
