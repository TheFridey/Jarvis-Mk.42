import { VoiceActivityDetector, type VadPhase } from './voice-vad.ts';

/**
 * Browser microphone capture for a single utterance.
 *
 * Push once, speak, and capture ends when the voice actually stops — measured against the
 * room rather than a fixed threshold, so a fan or a fridge no longer keeps the microphone
 * open until the ceiling. A small ring of recent frames is kept so the first phoneme of the
 * first word is not lost to start-up, which is the other half of why "Go Tom Phil" arrived
 * as "Tom Phil".
 *
 * Everything is local. The WAV is handed back to be posted to the Kernel's own voice
 * endpoint, which owns transcription authority; this module holds no permissions.
 */

export interface CapturedUtterance {
  wav: Blob;
  durationMs: number;
  peak: number;
  /** Why capture ended — reported to the operator, never guessed. */
  ended: 'speech-end' | 'max-duration' | 'manual' | 'no-speech';
}

export interface CaptureOptions {
  maxMs?: number;
  onLevel?: (rms: number) => void;
  onPhase?: (phase: VadPhase) => void;
}

const TARGET_RATE = 16_000;
const FRAME = 1024;
const PRE_ROLL_FRAMES = 8; // about 0.5 s of recent audio, kept until speech begins

export class UtteranceRecorder {
  private stream?: MediaStream;
  private context?: AudioContext;
  private processor?: ScriptProcessorNode;
  private detector: VoiceActivityDetector;
  private chunks: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private speechStarted = false;
  private closed = false;
  private peak = 0;
  private reason: CapturedUtterance['ended'] = 'manual';
  private resolve?: (result: CapturedUtterance | null) => void;
  private finished?: Promise<CapturedUtterance | null>;

  constructor(private readonly options: CaptureOptions = {}) {
    this.detector = new VoiceActivityDetector({ maxUtteranceMs: options.maxMs ?? 20_000, noSpeechMs: 8000 });
  }

  get phase(): VadPhase { return this.detector.currentPhase; }

  /** Must be called from a user gesture: the browser permission prompt depends on it. */
  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot capture audio.');
    this.finished = new Promise(resolve => { this.resolve = resolve; });
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // A device that disappears mid-utterance ends the capture rather than hanging it.
    for (const track of this.stream.getTracks()) track.addEventListener('ended', () => this.cancel());
    // A 16 kHz context makes the browser resample for us; the server refuses anything else.
    this.context = new AudioContext({ sampleRate: TARGET_RATE });
    const source = this.context.createMediaStreamSource(this.stream);
    const processor = this.context.createScriptProcessor(FRAME, 1, 1);
    this.processor = processor;
    processor.onaudioprocess = event => this.collect(event.inputBuffer.getChannelData(0));
    source.connect(processor);
    const sink = this.context.createGain();
    sink.gain.value = 0; // never play the microphone back
    processor.connect(sink);
    sink.connect(this.context.destination);
    this.options.onPhase?.(this.detector.currentPhase);
  }

  private collect(samples: Float32Array): void {
    if (this.closed) return;
    const copy = new Float32Array(samples);
    let sum = 0;
    for (const sample of copy) sum += sample * sample;
    const rms = Math.sqrt(sum / Math.max(1, copy.length));
    this.peak = Math.max(this.peak, rms);
    this.options.onLevel?.(rms);

    const frameMs = (copy.length / TARGET_RATE) * 1000;
    const events = this.detector.push({ rms, frameMs });
    this.options.onPhase?.(this.detector.currentPhase);

    if (!this.speechStarted) this.preRoll = [...this.preRoll, copy].slice(-PRE_ROLL_FRAMES);
    this.chunks.push(copy);

    for (const event of events) {
      if (event === 'speech-start') {
        // Prepend the pre-roll so the leading phoneme survives, then stop growing it.
        this.speechStarted = true;
        const head = [...this.preRoll];
        this.chunks = [...head, ...this.chunks];
        this.preRoll = [];
      }
      if (event === 'speech-end') { this.reason = 'speech-end'; void this.stop(); }
      if (event === 'max-duration') { this.reason = 'max-duration'; void this.stop(); }
      if (event === 'no-speech') { this.reason = 'no-speech'; void this.stop(); }
    }
  }

  /** Ends capture now, releases the device and returns the encoded utterance. */
  async stop(): Promise<CapturedUtterance | null> {
    if (this.closed) return null;
    this.closed = true;
    const reason = this.reason;
    const samples = this.merge();
    const peak = this.peak;
    const resolve = this.resolve;
    this.release();
    const result = reason === 'no-speech' || samples.length === 0
      ? null
      : { wav: encodeWav(samples), durationMs: Math.round((samples.length / TARGET_RATE) * 1000), peak, ended: reason };
    resolve?.(result);
    return result;
  }

  /** Cancellation: same cleanup, no audio returned. */
  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    const resolve = this.resolve;
    this.chunks = [];
    this.preRoll = [];
    this.release();
    resolve?.(null);
  }

  /** Resolves when capture ends — by silence, by the ceiling, or by cancellation. */
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
    try { this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); } catch { /* already gone */ }
    void this.context?.close().catch(() => undefined);
    this.processor = undefined; this.stream = undefined; this.context = undefined;
    this.resolve = undefined;
    this.chunks = [];
    this.preRoll = [];
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
