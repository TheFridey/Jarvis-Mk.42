import { describe, expect, it } from 'vitest';
import { ExperienceReducer } from './experience-reducer.ts';
import type { ExperienceStreamUpdate, JarvisOperatingPicture } from './live.ts';

const picture = (stateVersion = 4, sceneVersion = 4) => ({ schemaVersion: 2, operatingPictureVersion: 1, stateVersion, sceneVersion, generatedAt: '2026-09-29T00:00:00Z', scene: { version: sceneVersion } } as JarvisOperatingPicture);
const update = (sequence: number, patch: Partial<JarvisOperatingPicture> = picture(), options: Partial<ExperienceStreamUpdate> = {}): ExperienceStreamUpdate => ({ type: 'experience.update', schemaVersion: 1, streamId: 'stream-a', sequence, generatedAt: '2026-09-29T00:00:00Z', stateVersion: 4, sceneVersion: 4, channels: ['system'], full: true, patch, ...options });

describe('ExperienceReducer', () => {
  it('is duplicate tolerant and rejects out-of-order updates', () => { const r = new ExperienceReducer(); expect(r.apply(update(2)).status).toBe('applied'); expect(r.apply(update(2)).status).toBe('duplicate'); expect(r.apply(update(1)).status).toBe('out_of_order'); });
  it('rejects stale authoritative versions', () => { const r = new ExperienceReducer(); r.bootstrap(picture(5, 5)); expect(r.apply(update(3, picture(4, 4), { stateVersion: 4, sceneVersion: 4 })).status).toBe('resync_required'); });
  it('rejects a scene version conflict', () => { const r = new ExperienceReducer(); r.bootstrap(picture()); expect(r.apply(update(3, { ...picture(), scene: { ...picture().scene, version: 3 } }, { sceneVersion: 4 })).status).toBe('resync_required'); });
  it('requires a full update after a Kernel stream restart', () => { const r = new ExperienceReducer(); r.apply(update(1)); expect(r.apply(update(1, {}, { streamId: 'stream-b', full: false })).status).toBe('resync_required'); expect(r.apply(update(1, picture(), { streamId: 'stream-b', full: true })).status).toBe('applied'); });
});
