import { describe, expect, it } from 'vitest';
import { VoiceActivityDetector, type VadEvent } from './voice-vad.ts';

/**
 * End-of-speech detection, exercised with synthetic energies whose boundaries are known.
 * The point of the exercise is the operator's complaint: the microphone stayed open long
 * after they stopped speaking. Every case here measures when capture would have ended.
 */

const FRAME_MS = 64; // one 1024-sample frame at 16 kHz

const run = (levels: number[], options = {}) => {
  const detector = new VoiceActivityDetector(options);
  const events: VadEvent[] = [];
  let endingAt: number | null = null;
  levels.forEach((rms, index) => {
    const before = events.length;
    events.push(...detector.push({ rms, frameMs: FRAME_MS }));
    if (endingAt === null && events.length > before && (detector.currentPhase === 'finished')) {
      endingAt = (index + 1) * FRAME_MS;
    }
  });
  return { detector, events, endingAt };
};

const repeat = (rms: number, ms: number) => new Array(Math.round(ms / FRAME_MS)).fill(rms);

describe('voice activity detection', () => {
  it('learns a noisy room and still ends promptly after speech', () => {
    // A fan at 0.012 RMS is louder than the old fixed 0.006 silence threshold, which is
    // exactly why the microphone never closed.
    const levels = [...repeat(0.012, 400), ...repeat(0.18, 1600), ...repeat(0.012, 3000)];
    const { events, endingAt } = run(levels);
    expect(events).toContain('speech-start');
    expect(events).toContain('speech-end');
    expect(endingAt).not.toBeNull();
    const silenceStartsAt = 400 + 1600;
    const trailingSilence = (endingAt ?? 0) - silenceStartsAt;
    // Natural ending, not the 20 s ceiling: 0.7–1.2 s of sustained silence.
    expect(trailingSilence).toBeGreaterThanOrEqual(800);
    expect(trailingSilence).toBeLessThanOrEqual(1200);
  });

  it('does not truncate speech at a natural pause', () => {
    const levels = [
      ...repeat(0.005, 400),
      ...repeat(0.2, 800),
      ...repeat(0.005, 384), // a breath, well under the ending threshold duration
      ...repeat(0.2, 800),
      ...repeat(0.005, 2000),
    ];
    const { events } = run(levels);
    expect(events.filter(event => event === 'speech-end')).toHaveLength(1);
  });

  it('ignores a cough rather than transcribing it', () => {
    const levels = [...repeat(0.005, 400), ...repeat(0.25, 128), ...repeat(0.005, 1500)];
    const { events, detector } = run(levels);
    expect(events).toContain('retracted');
    expect(events).not.toContain('speech-end');
    expect(detector.currentPhase).not.toBe('finished');
  });

  it('gives up when nothing is said instead of running forever', () => {
    const { events, endingAt } = run(repeat(0.004, 12_000));
    expect(events).toContain('no-speech');
    expect(events).not.toContain('speech-end');
    expect(endingAt).toBeLessThanOrEqual(9000);
  });

  it('stops at the ceiling on continuous speech', () => {
    const { events, endingAt } = run([...repeat(0.005, 400), ...repeat(0.2, 25_000)], { maxUtteranceMs: 20_000 });
    expect(events).toContain('max-duration');
    expect(endingAt).toBeLessThanOrEqual(20_500);
  });

  it('requires two loud frames before deciding a voice started', () => {
    const levels = [...repeat(0.004, 400), 0.3, ...repeat(0.004, 1000)];
    const { events } = run(levels);
    expect(events).not.toContain('speech-start');
  });

  it('raises its start threshold with the room rather than firing on noise', () => {
    const { detector } = run(repeat(0.02, 400));
    expect(detector.noiseFloor).toBeGreaterThan(0.015);
    expect(detector.startThreshold).toBeGreaterThan(0.05);
    expect(detector.endThreshold).toBeGreaterThan(0.03);
  });

  it('reports nothing once finished', () => {
    const { detector } = run([...repeat(0.005, 400), ...repeat(0.2, 800), ...repeat(0.005, 2000)]);
    expect(detector.push({ rms: 0.2, frameMs: FRAME_MS })).toEqual([]);
  });
});
