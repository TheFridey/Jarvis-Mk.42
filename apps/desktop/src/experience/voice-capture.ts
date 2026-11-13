/**
 * Browser microphone capture for a single utterance.
 *
 * Push-to-talk: the caller starts it from a real user gesture and calls `stop()` when the
 * button is released, or silence ends it. Everything happens locally — the encoded WAV is
 * handed back to be posted to the Kernel's own voice endpoint, which owns transcription
 * authority. This module holds no permissions of its own and makes no decisions.
 */

export interface CapturedUtterance {
  wav: Blob;
  durationMs: number;
  peak: number;
}

export interface CaptureOptions {
  /** Hard ceiling; the adapter enforces the same bound server-side. */
  maxMs?: number;
  /** Stop when this long has passed below the silence threshold, after speech began. */
  silenceMs?: number;
  onLevel?: (rms: number) => void;
}

const TARGET_RATE = 16_000;
const SILENCE_RMS = 0.006;

export class UtteranceRecorder {
  private stream?: MediaStream;
  private context?: AudioContext;
  private processor?: ScriptProcessorNode;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private speechAt = 0;
  private quietSince = 0;
  private closed = false;
  private peak = 0;
  private resolveStop?: (result: CapturedUtterance | null) => void;
  private finished?: Promise<CapturedUtterance | null>;

  constructor(private readonly options: CaptureOptions = {}) {}

  /** Must be awaited inside a user gesture handler: the browser prompt depends on it. */
  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot capture audio.');
    this.finished = new Promise(resolve => { this.resolveStop = resolve; });
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // A 16 kHz context makes the browser resample for us; the server refuses anything else.
    this.context = new AudioContext({ sampleRate: TARGET_RATE });
    const source = this.context.createMediaStreamSource(this.stream);
    const processor = this.context.createScriptProcessor(1024, 1, 1);
    this.processor = processor;
    processor.onaudioprocess = event => this.collect(event.inputBuffer.getChannelData(0));
    source.connect(processor);
    // A muted sink keeps the graph alive without playing the microphone back.
    const silence = this.context.createGain();
    silence.gain.value = 0;
    processor.connect(silence);
    silence.connect(this.context.destination);
    this.startedAt = performance.now();
  }

  private collect(samples: Float32Array): void {
    if (this.closed) return;
    const now = performance.now();
    const copy = new Float32Array(samples);
    this.chunks.push(copy);
    let sum = 0;
    for (const sample of copy) sum += sample * sample;
    const rms = Math.sqrt(sum / Math.max(1, copy.length));
    this.peak = Math.max(this.peak, rms);
    this.options.onLevel?.(rms);

    if (rms > SILENCE_RMS) { this.speechAt = now; this.quietSince = 0; }
    else if (this.speechAt > 0) { if (!this.quietSince) this.quietSince = now; }

    const elapsed = now - this.startedAt;
    const quietFor = this.quietSince ? now - this.quietSince : 0;
    if (elapsed >= (this.options.maxMs ?? 20_000)) void this.stop();
    else if (this.speechAt > 0 && quietFor >= (this.options.silenceMs ?? 900)) void this.stop();
  }

  /** Ends capture, releases the device and returns the encoded utterance. */
  async stop(): Promise<CapturedUtterance | null> {
    if (this.closed) return null;
    this.closed = true;
    const samples = this.merge();
    const peak = this.peak;
    const resolveStop = this.resolveStop;
    this.release();
    const result = samples.length ? { wav: encodeWav(samples), durationMs: Math.round((samples.length / TARGET_RATE) * 1000), peak } : null;
    resolveStop?.(result);
    return result;
  }

  /** Cancellation: same cleanup, no audio returned. */
  cancel(): void {
    this.closed = true;
    this.chunks = [];
    const resolveStop = this.resolveStop;
    this.release();
    resolveStop?.(null);
  }

  /** Resolves when capture ends by silence or by the time limit — press once, then speak. */
  wait(): Promise<CapturedUtterance | null> {
    return this.finished ?? Promise.resolve(null);
  }

  private merge(): Float32Array {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.chunks) { merged.set(chunk, offset); offset += chunk.length; }
    return merged;
  }

  private release(): void {
    try { this.processor?.disconnect(); } catch { /* already gone */ }
    try { this.stream?.getTracks().forEach(track => track.stop()); } catch { /* already gone */ }
    void this.context?.close().catch(() => undefined);
    this.processor = undefined; this.stream = undefined; this.context = undefined;
    this.resolveStop = undefined;
  }
}

/** 16-bit mono WAV, the format the Kernel's voice endpoint accepts. */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
