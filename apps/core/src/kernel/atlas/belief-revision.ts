/**
 * Belief revision (ATLAS_MODEL.md §5, L16). PURE decision logic — no I/O.
 *
 * Given the active facts for one (entity, attribute) and an incoming fact,
 * decide: does the new fact supersede an old one, sit beside it unchanged, or
 * open a conflict? A conflict is NEVER resolved by silent overwrite.
 *
 * Automatic resolution order:
 *   1. epistemic authority: asserted > observed > retrieved > derived > inferred > predicted
 *   2. recency: newer `validFrom` wins
 *   3. confidence: higher wins, but only past a margin
 *   4. still comparable + different value => leave BOTH active, open a conflict
 *
 * A principal assertion always wins and marks the conflict `resolved_by_principal`.
 */
import type { Fact } from '@jarvis/contracts';

type EpistemicStatus = Fact['epistemicStatus'];

const AUTHORITY: Record<EpistemicStatus, number> = {
  asserted: 6,
  observed: 5,
  retrieved: 4,
  derived: 3,
  inferred: 2,
  predicted: 1,
};

const CONFIDENCE_MARGIN = 0.15;

export interface IncomingFact {
  attribute: string;
  value: unknown;
  epistemicStatus: EpistemicStatus;
  confidence: number;
  validFrom: string;
  /** True when this came from an Experience-Plane principal Command. */
  principalAsserted: boolean;
}

export type RevisionOutcome =
  | { action: 'insert_only'; reason: string }
  | { action: 'supersede'; supersedeFactIds: string[]; reason: string }
  | {
      action: 'conflict';
      conflictWithFactIds: string[];
      reason: string;
      /** For a principal assertion the conflict is opened AND immediately resolved. */
      resolvedByPrincipal: boolean;
    };

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function reviseBelief(active: Fact[], incoming: IncomingFact): RevisionOutcome {
  const rivals = active.filter((f) => f.attribute === incoming.attribute && !sameValue(f.value, incoming.value));
  if (rivals.length === 0) {
    return { action: 'insert_only', reason: active.length === 0 ? 'first fact for key' : 'agrees with existing belief' };
  }

  if (incoming.principalAsserted) {
    return {
      action: 'conflict',
      conflictWithFactIds: rivals.map((f) => f.id),
      reason: 'principal assertion overrides prior beliefs',
      resolvedByPrincipal: true,
    };
  }

  const inAuth = AUTHORITY[incoming.epistemicStatus];
  const superseded: string[] = [];
  let ambiguous = false;

  for (const r of rivals) {
    const rAuth = AUTHORITY[r.epistemicStatus];
    if (inAuth > rAuth) {
      superseded.push(r.id);
      continue;
    }
    if (inAuth < rAuth) {
      // incoming is weaker than an existing rival — never supersede; may conflict
      ambiguous = true;
      continue;
    }
    // equal authority -> recency
    if (Date.parse(incoming.validFrom) > Date.parse(r.validFrom)) {
      superseded.push(r.id);
      continue;
    }
    if (Date.parse(incoming.validFrom) < Date.parse(r.validFrom)) {
      ambiguous = true;
      continue;
    }
    // equal authority + equal recency -> confidence past a margin
    if (incoming.confidence - r.confidence > CONFIDENCE_MARGIN) {
      superseded.push(r.id);
      continue;
    }
    ambiguous = true;
  }

  if (ambiguous) {
    return {
      action: 'conflict',
      conflictWithFactIds: rivals.map((f) => f.id),
      reason: 'no clear authority/recency/confidence winner — both beliefs retained',
      resolvedByPrincipal: false,
    };
  }
  return {
    action: 'supersede',
    supersedeFactIds: superseded,
    reason: `incoming (${incoming.epistemicStatus}) outranks prior beliefs`,
  };
}
