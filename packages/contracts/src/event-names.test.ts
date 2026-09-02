import { describe, expect, it } from 'vitest';
import { EventNames } from './index.ts';

describe('MK.46 knowledge event names', () => {
  it('exposes jarvis.world.* names with the correct grammar', () => {
    expect(EventNames.WorldFactAsserted).toBe('jarvis.world.fact.asserted');
    expect(EventNames.WorldFactSuperseded).toBe('jarvis.world.fact.superseded');
    expect(EventNames.WorldConflictRecorded).toBe('jarvis.world.conflict.recorded');
    expect(EventNames.WorldEntityMerged).toBe('jarvis.world.entity.merged');
    expect(EventNames.WorldForgotten).toBe('jarvis.world.record.forgotten');
    expect(EventNames.WorldCausalHypothesised).toBe('jarvis.world.causal.hypothesised');
  });

  it('exposes jarvis.memory.* names with the correct grammar', () => {
    expect(EventNames.MemoryEpisodeRecorded).toBe('jarvis.memory.episode.recorded');
    expect(EventNames.MemoryCandidateScored).toBe('jarvis.memory.candidate.scored');
    expect(EventNames.MemoryCandidateDisposed).toBe('jarvis.memory.candidate.disposed');
    expect(EventNames.MemoryConsolidationCompleted).toBe('jarvis.memory.consolidation.completed');
    expect(EventNames.MemoryInsightAvailable).toBe('jarvis.memory.insight.available');
    expect(EventNames.MemoryForgotten).toBe('jarvis.memory.record.forgotten');
  });

  it('every name matches jarvis.<plane>.<domain>.<name>', () => {
    for (const v of Object.values(EventNames)) {
      expect(v).toMatch(/^jarvis\.[a-z]+\.[a-z_]+\.[a-z_]+$/);
    }
  });
});
