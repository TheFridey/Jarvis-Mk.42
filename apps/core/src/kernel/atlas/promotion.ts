/**
 * Observation -> fact promotion (ATLAS_MODEL.md §6). Promotion is NOT automatic
 * on arrival: a scheduled evaluator aggregates corroborating observations and,
 * above a corroboration + confidence threshold, PROPOSES a fact. It never writes
 * one — the proposal goes to the Knowledge Ingestion mediator like any other.
 *
 * The generic rule: an observation `kind` shaped `"<subjectRef>/<attribute>"`
 * (e.g. `"principal-operator/at_workstation"`, `"node:office-01/reachable"`)
 * describes a belief. N corroborating unexpired observations of that kind with
 * mean confidence >= floor => one fact proposal, `epistemicStatus: 'observed'`,
 * evidence = the observation ids. Kinds without a `/` are left for a
 * domain-specific rule and never auto-promoted.
 */
import type { AtlasObservation } from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { AtlasStore } from './stores.ts';

export interface PromotionProposal {
  principalId: string;
  subjectRef: string;
  attribute: string;
  value: unknown;
  confidence: number;
  observationIds: string[];
  observedAt: string;
}

export interface PromotionConfig {
  /** Minimum corroborating observations of one kind. */
  minCorroboration: number;
  /** Minimum mean confidence across the corroborating set. */
  minMeanConfidence: number;
}

export const DEFAULT_PROMOTION_CONFIG: PromotionConfig = {
  minCorroboration: 2,
  minMeanConfidence: 0.6,
};

export class ObservationPromoter {
  constructor(
    private readonly deps: { store: AtlasStore; clock: Clock },
    private readonly config: PromotionConfig = DEFAULT_PROMOTION_CONFIG,
  ) {}

  /** Evaluate every principal's unpromoted observations; return fact proposals.
   *  Caller (the routine) forwards each to Knowledge Ingestion and, on success,
   *  calls `store.markObservationsPromoted`. */
  async evaluate(principalIds: string[]): Promise<PromotionProposal[]> {
    const now = this.deps.clock.nowIso();
    const proposals: PromotionProposal[] = [];
    for (const principalId of principalIds) {
      const kinds = await this.deps.store.distinctUnpromotedKinds(principalId, now);
      for (const kind of kinds) {
        const slash = kind.indexOf('/');
        if (slash < 0) continue;
        const subjectRef = kind.slice(0, slash);
        const attribute = kind.slice(slash + 1);
        if (!subjectRef || !attribute) continue;

        const obs = await this.deps.store.unpromotedObservations(principalId, kind, now);
        if (obs.length < this.config.minCorroboration) continue;

        // corroboration = agreement on the value (the observation summary)
        const byValue = groupBy(obs, (o) => o.summary);
        const [topValue, group] = largestGroup(byValue);
        if (!group || group.length < this.config.minCorroboration) continue;

        const mean = group.reduce((s, o) => s + o.confidence, 0) / group.length;
        if (mean < this.config.minMeanConfidence) continue;

        proposals.push({
          principalId,
          subjectRef,
          attribute,
          value: topValue,
          // aggregate confidence: mean lifted a little by corroboration, capped.
          confidence: Math.min(0.98, mean + Math.min(0.2, 0.05 * (group.length - this.config.minCorroboration))),
          observationIds: group.map((o) => o.id),
          observedAt: group.map((o) => o.observedAt).sort().at(-1) ?? now,
        });
      }
    }
    return proposals;
  }
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    (m.get(k) ?? m.set(k, []).get(k)!).push(it);
  }
  return m;
}
function largestGroup(m: Map<string, AtlasObservation[]>): [string, AtlasObservation[] | undefined] {
  let best: [string, AtlasObservation[] | undefined] = ['', undefined];
  for (const [k, v] of m) if (!best[1] || v.length > best[1].length) best = [k, v];
  return best;
}
