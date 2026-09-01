import { describe, expect, it, vi } from 'vitest';
import { makeEvent } from '@jarvis/testkit';
import { ReplayBus, isReplay } from './replay.ts';

describe('replay != re-execution', () => {
  it('tags every replayed event with meta.replay=true', async () => {
    const bus = new ReplayBus();
    const seen: boolean[] = [];
    bus.registerProjector('p', async (e) => {
      seen.push(isReplay(e));
    });
    await bus.feed(makeEvent());
    expect(seen).toEqual([true]);
  });

  it('fans a replayed event to every registered projector', async () => {
    const bus = new ReplayBus();
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    bus.registerProjector('a', a);
    bus.registerProjector('b', b);
    await bus.feed(makeEvent());
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('isReplay is false for a normal live event', () => {
    expect(isReplay(makeEvent())).toBe(false);
    expect(isReplay(makeEvent({ meta: { replay: 'true' } }))).toBe(true);
  });
});
