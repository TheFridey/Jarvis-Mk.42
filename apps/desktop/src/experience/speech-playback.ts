/**
 * Plays Jarvis's answer, chunk by chunk, as the Kernel synthesises it.
 *
 * The Kernel sends NDJSON frames: {index, text, seconds, wav}. Chunk 0 is decoded and started while
 * chunks 1..n are still being synthesised, which is the only way this hardware can speak promptly —
 * warm synthesis runs at roughly real time, so waiting for a whole answer would mean seconds of silence.
 *
 * Cancellation is generation-based. Every stop() invalidates the generation, so a chunk that was already
 * in flight when the owner interrupted can never restart playback after the fact.
 */
export interface SpeechPlaybackHooks {
  onState?: (state: 'idle' | 'buffering' | 'speaking' | 'error') => void;
  /** Real played-audio amplitude, 0..1, for visual reactivity. Never synthetic. */
  onLevel?: (level: number) => void;
  onChunk?: (index: number, seconds: number) => void;
}

export interface SpeechPlaybackOptions extends SpeechPlaybackHooks {
  voice?: string;
  signal?: AbortSignal;
}

export class SpeechPlayback {
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private generation = 0;
  private abort?: AbortController;
  private sources: AudioBufferSourceNode[] = [];

  /** True while audio is being produced or played, so the interface can show SPEAKING honestly. */
  get speaking(): boolean { return this.sources.length > 0; }

  async speak(request: (init: { signal: AbortSignal; voice?: string }) => Promise<Response>, options: SpeechPlaybackOptions = {}): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const signal = abort.signal;
    options.signal?.addEventListener('abort', () => abort.abort(), { once: true });

    const context = this.context ??= new AudioContext();
    await context.resume().catch(() => undefined);
    options.onState?.('buffering');

    try {
      const response = await request({ signal, ...(options.voice ? { voice: options.voice } : {}) });
      if (!response.ok || !response.body) throw new Error(`speech ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let started = false;
      // Playback is sequential: the second chunk is only started when the first ends, but decoding and
      // synthesis of later chunks happen while earlier audio plays.
      let playhead = 0;

      while (true) {
        const read = await reader.read();
        if (read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf(String.fromCharCode(10))) >= 0) {
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);
          if (!line) continue;
          const frame = JSON.parse(line) as { index?: number; seconds?: number; wav?: string; error?: string };
          if (frame.error) throw new Error(frame.error);
          if (!frame.wav || generation !== this.generation) continue;
          const bytes = Uint8Array.from(atob(frame.wav), character => character.charCodeAt(0));
          const audio = await context.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
          if (generation !== this.generation) return;
          const source = context.createBufferSource();
          source.buffer = audio;
          const gain = context.createGain();
          const analyser = this.analyser ??= context.createAnalyser();
          analyser.fftSize = 256;
          source.connect(gain).connect(analyser).connect(context.destination);
          const startAt = Math.max(context.currentTime + 0.05, playhead);
          source.start(startAt);
          playhead = startAt + audio.duration;
          this.sources.push(source);
          options.onChunk?.(frame.index ?? 0, frame.seconds ?? audio.duration);
          if (!started) { started = true; options.onState?.('speaking'); }

          const meter = window.setInterval(() => {
            if (generation !== this.generation) { window.clearInterval(meter); return; }
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const value of data) { const centred = (value - 128) / 128; sum += centred * centred; }
            options.onLevel?.(Math.min(1, Math.sqrt(sum / data.length) * 3));
          }, 60);
          source.onended = () => {
            window.clearInterval(meter);
            this.sources = this.sources.filter(entry => entry !== source);
            if (generation === this.generation && this.sources.length === 0) {
              options.onLevel?.(0);
              options.onState?.('idle');
            }
          };
        }
      }
      if (!started) options.onState?.('error');
    } catch (error) {
      if (generation === this.generation) {
        options.onLevel?.(0);
        options.onState?.('error');
      }
      if ((error as Error).name !== 'AbortError') throw error;
    }
  }

  /** Immediate silence: every queued buffer is stopped, the fetch is aborted and the generation advances. */
  stop(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    for (const source of this.sources) { try { source.stop(); } catch { /* already ended */ } }
    this.sources = [];
  }
}
