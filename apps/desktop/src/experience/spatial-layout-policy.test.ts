import { describe, expect, it } from 'vitest';
import { spatialLayout } from './spatial-layout-policy.ts';

describe('spatial layout policy', () => {
  it('places cloud models above and local models below the locality boundary', () => {
    const layout = spatialLayout({ width: 1920, height: 1080, models: [{ locality: 'local' }, { locality: 'cloud-ok' }], agentCount: 0 });
    expect(layout.models[1]!.y).toBeLessThan(layout.core.y);
    expect(layout.models[0]!.y).toBeGreaterThan(layout.core.y);
    expect(layout.models.every(point => point.x > layout.core.x)).toBe(true);
  });
  it('keeps model labels on screen and the Core dominant across displays', () => {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160], [1366, 768], [1280, 800]] as const) {
      const layout = spatialLayout({ width, height, models: Array.from({ length: 6 }, (_, i) => ({ locality: i % 2 ? 'cloud-ok' as const : 'local' as const })), agentCount: 3 });
      expect(Math.max(...layout.models.map(point => point.x))).toBeLessThan(width - 280 - 170);
      expect(layout.conversation.x - layout.conversationWidth).toBeGreaterThanOrEqual(0);
      expect(layout.coreRadius).toBeGreaterThan(height * .12);
      expect(layout.agents.every(point => point.x < layout.core.x)).toBe(true);
    }
  });
  it('switches to a narrow composition on small viewports', () => {
    expect(spatialLayout({ width: 420, height: 860, models: [], agentCount: 0 }).narrow).toBe(true);
    expect(spatialLayout({ width: 1024, height: 900, models: [], agentCount: 0 }).narrow).toBe(true);
    expect(spatialLayout({ width: 1280, height: 800, models: [], agentCount: 0 }).narrow).toBe(false);
  });
});
