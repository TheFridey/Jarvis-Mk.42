import { describe, expect, it, beforeEach } from 'vitest';
import type { Entity } from '@jarvis/contracts';
import { FakeClock } from '../../runtime/clock.ts';
import { UlidGen } from '../../runtime/ids.ts';
import { DeterministicEmbeddingClient } from '../embedding/embedding-client.ts';
import { EntityResolver } from './entity-resolver.ts';
import type { AtlasStore } from './stores.ts';

/** Minimal in-memory AtlasStore covering only what EntityResolver touches. */
function fakeStore() {
  const entities = new Map<string, Entity & { embedding?: number[] }>();
  const aliases = new Map<string, Set<string>>();
  const embeddings = new DeterministicEmbeddingClient();
  const store = {
    async getEntity(id: string) { return entities.get(id); },
    async findEntityByName(_p: string, name: string) {
      return [...entities.values()].find((e) => e.canonicalName.toLowerCase() === name.toLowerCase());
    },
    async findEntityByAlias(_p: string, alias: string) {
      for (const [eid, set] of aliases) if ([...set].some((a) => a.toLowerCase() === alias.toLowerCase())) return entities.get(eid);
      return undefined;
    },
    async nearestEntities(_p: string, vec: number[], min: number) {
      const { cosineSimilarity } = await import('@jarvis/contracts');
      const scored = [...entities.values()]
        .filter((e) => e.embedding)
        .map((e) => ({ entity: e, similarity: cosineSimilarity(vec, e.embedding!) }))
        .filter((x) => x.similarity >= min)
        .sort((a, b) => b.similarity - a.similarity);
      return scored;
    },
    async insertEntity(e: { id: string; type: string; canonicalName: string; principalId: string; privacyClass: string; embedding?: number[] }) {
      entities.set(e.id, { ...(e as unknown as Entity), aliases: [], metadata: {}, createdAt: '', updatedAt: '', embedding: e.embedding });
    },
    async addAlias(id: string, alias: string) {
      (aliases.get(id) ?? aliases.set(id, new Set()).get(id)!).add(alias);
    },
  } as unknown as AtlasStore;
  return { store, entities, aliases, embeddings };
}

describe('EntityResolver', () => {
  let f: ReturnType<typeof fakeStore>;
  let resolver: EntityResolver;
  beforeEach(() => {
    f = fakeStore();
    resolver = new EntityResolver({ store: f.store, embeddings: f.embeddings, clock: new FakeClock(0), ids: new UlidGen() });
  });

  it('creates a new entity when nothing matches, with a type hint', async () => {
    const r = await resolver.resolve({ principalId: 'p1', ref: 'ScaleSmiths', typeHint: 'business' });
    expect(r.created).toBe(true);
    expect(r.method).toBe('created');
    expect([...f.entities.values()][0]?.type).toBe('business');
  });

  it('resolves by exact canonical name on the second call', async () => {
    const first = await resolver.resolve({ principalId: 'p1', ref: 'ScaleSmiths', typeHint: 'business' });
    const second = await resolver.resolve({ principalId: 'p1', ref: 'scalesmiths' });
    expect(second.created).toBe(false);
    expect(second.method).toBe('canonical_name');
    expect(second.entityId).toBe(first.entityId);
  });

  it('resolves an email descriptor to the same entity via an alias key', async () => {
    const created = await resolver.resolve({ principalId: 'p1', ref: 'Rhys Lacy', typeHint: 'person' });
    await f.store.addAlias(created.entityId, 'email:rhys@scalesmiths.com', 'test');
    const byEmail = await resolver.resolve({ principalId: 'p1', ref: 'email: rhys@scalesmiths.com' });
    expect(byEmail.entityId).toBe(created.entityId);
    expect(byEmail.method).toBe('alias');
  });

  it('resolves a near-identical name by embedding similarity, not a new entity', async () => {
    const created = await resolver.resolve({ principalId: 'p1', ref: 'ScaleSmiths analytics platform', typeHint: 'project' });
    const near = await resolver.resolve({ principalId: 'p1', ref: 'the ScaleSmiths analytics platform' });
    expect(near.created).toBe(false);
    expect(near.method).toBe('embedding');
    expect(near.entityId).toBe(created.entityId);
    expect(near.similarity).toBeGreaterThanOrEqual(0.82);
  });

  it('does NOT merge genuinely different entities', async () => {
    await resolver.resolve({ principalId: 'p1', ref: 'The Office Server', typeHint: 'infrastructure' });
    const other = await resolver.resolve({ principalId: 'p1', ref: 'quarterly board meeting notes' });
    expect(other.created).toBe(true);
  });

  it('resolves a ULID ref straight to the entity id', async () => {
    const created = await resolver.resolve({ principalId: 'p1', ref: 'Aurora', typeHint: 'project' });
    const byId = await resolver.resolve({ principalId: 'p1', ref: created.entityId });
    expect(byId.method).toBe('id');
    expect(byId.entityId).toBe(created.entityId);
  });
});
