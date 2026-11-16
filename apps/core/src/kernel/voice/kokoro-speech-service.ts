import { TextEncoder } from 'node:util';

/**
 * Local speech synthesis, warm and cancellable.
 *
 * Kokoro-82M runs on onnxruntime-node's arm64 build inside the Kernel process, so the model is loaded
 * once and stays loaded. Measured on this workstation: fp32 is roughly twice as fast as the q8 quantised
 * build (warm RTF ~1.0 versus ~2.3), which is counter-intuitive and the reason it is measured rather than
 * assumed. Warm RTF 1.0 means synthesis keeps up with playback only just, so answers are spoken in
 * sentence-sized chunks: the first chunk is audible in 1–3 seconds instead of waiting for the whole answer.
 *
 * Nothing leaves this machine: no text is sent anywhere, and no audio is written to disk.
 */

export interface SpeechChunk {
  index: number;
  text: string;
  wav: Uint8Array;
  seconds: number;
}

export interface SpeechOptions {
  voice?: string;
  signal?: AbortSignal;
}

export const DEFAULT_VOICE = 'bm_george';
export const SELECTABLE_VOICES = ['bm_george', 'bm_lewis', 'bm_fable'] as const;

/** Sentence-ish chunks: long enough to sound natural, short enough that the first is quick. */
export const MAX_CHUNK_CHARS = 90;

export function speechChunks(text: string, limit = MAX_CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  // Split after sentence enders, then greedily rejoin until the limit is reached. A chunk boundary is
  // always a sentence boundary, so a pause never lands mid-clause.
  const sentences = (clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean])
    .flatMap(sentence => sentence.length <= limit ? [sentence] : sentence.split(/(?<=,)\s+/));
  const chunks: string[] = [];
  let current = '';
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (!current) { current = sentence; continue; }
    if ((current + ' ' + sentence).length <= limit) { current += ' ' + sentence; continue; }
    chunks.push(current);
    current = sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

type KokoroModel = { generate: (text: string, options: { voice: string; speed?: number }) => Promise<{ audio: Float32Array; sampling_rate: number; toWav: () => ArrayBuffer }> };

export class KokoroSpeechService {
  private model?: Promise<KokoroModel>;
  private generation = 0;
  private loadMs?: number;

  constructor(private readonly options: { voice?: string; enabled?: boolean } = {}) {}

  get voice(): string { return this.options.voice ?? DEFAULT_VOICE; }
  get warmMs(): number | undefined { return this.loadMs; }

  private async load(): Promise<KokoroModel> {
    if (this.options.enabled === false) throw new Error('speech synthesis is disabled');
    this.model ??= (async () => {
      const started = Date.now();
      const module = await import('kokoro-js');
      const loaded = await module.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32' as never, device: 'cpu' });
      this.loadMs = Date.now() - started;
      return loaded as unknown as KokoroModel;
    })();
    return this.model;
  }

  /** Load now so the first real request is not the one that pays for it. */
  async warm(): Promise<void> {
    try { await this.load(); } catch { /* reported per request; warming is best effort */ }
  }

  /** Invalidate every in-flight synthesis. Chunks already returned will not be followed by more. */
  cancel(): void { this.generation++; }

  async *speak(text: string, options: SpeechOptions = {}): AsyncGenerator<SpeechChunk> {
    const model = await this.load();
    const mine = ++this.generation;
    const voice = options.voice ?? this.voice;
    const chunks = speechChunks(text);
    for (const [index, chunk] of chunks.entries()) {
      // A cancelled or superseded request stops before spending another inference, and the caller can
      // never receive a chunk that belongs to a generation it has already abandoned.
      if (mine !== this.generation) return;
      if (options.signal?.aborted) return;
      const audio = await model.generate(chunk, { voice, speed: 1 });
      if (mine !== this.generation) return;
      const wav = new Uint8Array(audio.toWav());
      yield { index, text: chunk, wav, seconds: audio.audio.length / audio.sampling_rate };
    }
  }
}

export function chunkTextBytes(chunk: SpeechChunk): number { return chunk.wav.byteLength; }

/** Base64 for the NDJSON frame; the browser decodes it directly into an ArrayBuffer. */
export function encodeChunk(chunk: SpeechChunk): string {
  return Buffer.from(chunk.wav).toString('base64');
}

export const speechServiceEncoder = new TextEncoder();
