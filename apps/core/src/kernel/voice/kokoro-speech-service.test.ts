import { describe, expect, it } from 'vitest';
import { MAX_CHUNK_CHARS, speechChunks } from './kokoro-speech-service.ts';

describe('speech chunking', () => {
  it('keeps every chunk under the ceiling and never splits mid-word', () => {
    const text = "Afternoon, mate. Everything's running smoothly. I've checked the results and there are two things worth looking at before we move forward.";
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(chunk).not.toMatch(/\s+$/);
    }
    expect(chunks.join(' ')).toContain('two things worth looking at');
  });

  it('breaks a long sentence at commas rather than emitting one slow chunk', () => {
    const long = 'There are a few different ways we could approach this, and the simplest one gives us reliable evidence, which matters more than the elegant one right now.';
    const chunks = speechChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  });

  it('returns nothing for empty or whitespace-only text', () => {
    expect(speechChunks('   ')).toHaveLength(0);
  });
});
