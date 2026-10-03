/**
 * Entity resolution (ATLAS_MODEL.md §4.1). Runs ONCE per ingestion item, inside
 * the Knowledge Ingestion mediator.
 *
 * Order, deterministic keys first:
 *   1. exact entity id
 *   2. exact canonical name (per principal, case-insensitive)
 *   3. exact alias
 *   4. embedding cosine >= threshold  (ADR-0011: a threshold gate, not a truth
 *      oracle — below threshold we CREATE rather than guess)
 *
 * A `descriptor` may carry a `type:` / `email:` / `url:` prefix as a hint; those
 * become deterministic alias keys on the created entity.
 */
import type { EntityType, Ulid } from '@jarvis/contracts';
import type { EmbeddingClient } from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import type { AtlasStore } from './stores.ts';

export interface ResolveInput {
  principalId: string;
  /** Entity id (26-char ULID) or a free-text descriptor / name. */
  ref: string;
  /** Hint used only when creating. */
  typeHint?: EntityType;
  privacyClass?: 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' | 'RESTRICTED';
  /** Provenance source label for any alias rows written. */
  source?: string;
}

export interface ResolveResult {
  entityId: Ulid;
  created: boolean;
  method: 'id' | 'canonical_name' | 'alias' | 'embedding' | 'created';
  similarity?: number;
}

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const SIMILARITY_THRESHOLD = 0.82;

export class EntityResolver {
  constructor(
    private readonly deps: {
      store: AtlasStore;
      embeddings: EmbeddingClient;
      clock: Clock;
      ids: IdGen;
    },
  ) {}

  async resolve(input: ResolveInput): Promise<ResolveResult> {
    const { store } = this.deps;
    const raw = input.ref.trim();

    // 1. exact id
    if (ULID_RE.test(raw)) {
      const byId = await store.getEntity(raw);
      if (byId && byId.principalId === input.principalId) return { entityId: byId.id, created: false, method: 'id' };
    }

    const { name, aliasKeys, typeHint } = parseDescriptor(raw, input.typeHint);

    // 2. canonical name
    const byName = await store.findEntityByName(input.principalId, name);
    if (byName) {
      for (const k of aliasKeys) await store.addAlias(byName.id, k, input.source ?? 'resolver');
      return { entityId: byName.id, created: false, method: 'canonical_name' };
    }

    // 3. alias (the descriptor's own keys, then the bare name)
    for (const key of [...aliasKeys, name]) {
      const byAlias = await store.findEntityByAlias(input.principalId, key);
      if (byAlias) return { entityId: byAlias.id, created: false, method: 'alias' };
    }

    // 4. embedding similarity
    const { vector } = await this.deps.embeddings.embed(name);
    const near = await store.nearestEntities(input.principalId, vector, SIMILARITY_THRESHOLD, 3);
    if (!/^(scalesmiths|calendar|gmail):/.test(raw) && near.length > 0 && near[0]) {
      const hit = near[0];
      for (const k of aliasKeys) await store.addAlias(hit.entity.id, k, input.source ?? 'resolver');
      return { entityId: hit.entity.id, created: false, method: 'embedding', similarity: hit.similarity };
    }

    // 5. create
    const id = this.deps.ids.ulid();
    await store.insertEntity({
      id,
      type: typeHint ?? 'concept',
      canonicalName: name,
      privacyClass: input.privacyClass ?? 'INTERNAL',
      principalId: input.principalId,
      embedding: vector,
      embeddingModelId: this.deps.embeddings.modelId,
    });
    for (const k of aliasKeys) await store.addAlias(id, k, input.source ?? 'resolver');
    return { entityId: id, created: true, method: 'created' };
  }
}

function parseDescriptor(
  raw: string, typeHint?: EntityType,
): { name: string; aliasKeys: string[]; typeHint?: EntityType } {
  const aliasKeys: string[] = [];
  let name = raw;
  let hint = typeHint;
  const m = /^(type|email|url|repo|node|slug):\s*(.+)$/i.exec(raw);
  if (m && m[1] && m[2]) {
    const kind = m[1].toLowerCase();
    const val = m[2].trim();
    if (kind === 'type') {
      hint = val as EntityType;
      name = val;
    } else {
      aliasKeys.push(`${kind}:${val.toLowerCase()}`);
      name = val;
    }
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(name)) aliasKeys.push(`email:${name.toLowerCase()}`);
  if (/^https?:\/\//i.test(name)) aliasKeys.push(`url:${name.toLowerCase()}`);
  return { name, aliasKeys, ...(hint ? { typeHint: hint } : {}) };
}
