/**
 * End-of-speech detection for one utterance.
 *
 * The first implementation compared every frame to one fixed threshold, so a room with any
 * steady noise never produced silence and capture ran to the 20-second ceiling — "the mic
 * stayed on for ages". This measures the room instead: an ambient floor learned before the
 * operator speaks, a high threshold to start, a lower threshold to stop, and a pause only
 * counts once it has lasted long enough to be an ending rather than a breath.
 *
 * Pure and synchronous: give it frame energies, it tells you what happened. No audio, no
 * timers, no browser.
 */

export type VadPhase = 'idle' | 'calibrating' | 'listening' | 'speech' | 'finished';

export interface VadOptions {
  /** Frames of ambient audio to learn before speech can start. */
  calibrateMs?: number;
  /** Sustained silence after speech that ends the utterance. */
  endSilenceMs?: number;
  /** Speech shorter than this is treated as a cough and capture re-arms. */
  minSpeechMs?: number;
  /** Hard ceiling on one utterance. */
  maxUtteranceMs?: number;
  /** Give up if nothing is said. */
  noSpeechMs?: number;
  /** Absolute floors, so a silent room does not produce a zero threshold. */
  minStartRms?: number;
  minEndRms?: number;
}

export interface VadReading {
  rms: number;
  frameMs: number;
}

export type VadEvent = 'speech-start' | 'speech-end' | 'retracted' | 'max-duration' | 'no-speech';

const defaults = {
  calibrateMs: 300,
  endSilenceMs: 850,
  minSpeechMs: 250,
  maxUtteranceMs: 20_000,
  noSpeechMs: 8000,
  minStartRms: 0.009,
  minEndRms: 0.006,
} satisfies Required<VadOptions>;

export class VoiceActivityDetector {
  private readonly options: Required<VadOptions>;
  private phase: VadPhase = 'calibrating';
  private elapsedMs = 0;
  private quietMs = 0;
  private speechMs = 0;
  private calibratedMs = 0;
  private floorSum = 0;
  private floorCount = 0;
  private floorRms = 0.004;
  private loudFrames = 0;

  constructor(options: VadOptions = {}) {
    this.options = { ...defaults, ...options };
  }

  get currentPhase(): VadPhase { return this.phase; }

  /** The learned ambient floor, exposed so the interface can report what it heard. */
  get noiseFloor(): number { return this.floorRms; }

  /** Threshold used to begin speech — the higher of the absolute floor and the room. */
  get startThreshold(): number { return Math.max(this.options.minStartRms, this.floorRms * 3.2); }

  /** Threshold below which a frame counts as silence once speech has begun. */
  get endThreshold(): number { return Math.max(this.options.minEndRms, this.floorRms * 2); }

  push({ rms, frameMs }: VadReading): VadEvent[] {
    if (this.phase === 'finished' || this.phase === 'idle') return [];
    const events: VadEvent[] = [];
    this.elapsedMs += frameMs;

    if (this.phase === 'calibrating') {
      this.floorSum += rms;
      this.floorCount += 1;
      this.calibratedMs += frameMs;
      if (this.calibratedMs >= this.options.calibrateMs) {
        // Cap the estimate: if calibration happened during speech, an honest absolute floor
        // still lets the operator start. A room louder than this is not usable anyway.
        this.floorRms = Math.min(0.03, Math.max(0.002, this.floorSum / Math.max(1, this.floorCount)));
        this.phase = 'listening';
      }
      return events;
    }

    if (this.phase === 'listening') {
      // Track the room only while nothing is being said, so a word cannot raise the floor.
      if (rms < this.floorRms * 2.5) this.floorRms = this.floorRms * 0.9 + rms * 0.1;
      if (rms > this.startThreshold) {
        // Two consecutive loud frames: a click or a door is one frame, a voice is not.
        this.loudFrames += 1;
        if (this.loudFrames >= 2) {
          this.phase = 'speech';
          this.speechMs = frameMs * 2;
          this.quietMs = 0;
          events.push('speech-start');
        }
      } else {
        this.loudFrames = 0;
      }
      if (this.phase === 'listening' && this.elapsedMs >= this.options.noSpeechMs) {
        this.phase = 'finished';
        events.push('no-speech');
      }
      return events;
    }

    // speech
    // Speech time counts voiced frames only: a cough plus the silence after it is not speech.
    if (rms < this.endThreshold) {
      this.quietMs += frameMs;
    } else {
      this.quietMs = 0;
      this.speechMs += frameMs;
    }

    if (this.quietMs >= this.options.endSilenceMs) {
      if (this.speechMs >= this.options.minSpeechMs) {
        this.phase = 'finished';
        events.push('speech-end');
        return events;
      }
      // Too short to be speech: back to listening, keeping the ambient estimate.
      this.phase = 'listening';
      this.speechMs = 0;
      this.quietMs = 0;
      this.loudFrames = 0;
      events.push('retracted');
      return events;
    }

    if (this.elapsedMs >= this.options.maxUtteranceMs) {
      this.phase = 'finished';
      events.push('max-duration');
    }
    return events;
  }

  /** Wall-clock milliseconds from first frame to the ending that fired. */
  get utteranceMs(): number { return this.elapsedMs; }
}
