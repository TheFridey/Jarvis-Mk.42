/**
 * Deterministic context ranking + budgeting - PURE (COGNITION_MODEL.md sec 4).
 * No AI retrieval in MK.43: relevance is a fixed heuristic over item kind,
 * focus overlap, recency, and confidence. Same inputs => same package.
 */
import type { ContextItem, ContextItemKind, ContextRequest, PrivacyClass } from '@jarvis/contracts';

const PRIVACY_RANK: Record<PrivacyClass, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  SENSITIVE: 2,
  RESTRICTED: 3,
};

/** Base priority per kind: the task-defining items rank highest. */
const KIND_WEIGHT: Record<ContextItemKind, number> = {
  active_objective: 1.0,
  active_workspace: 0.9,
  selected_object: 0.88,
  cursor_target: 0.82,
  gesture_target: 0.82,
  active_application: 0.8,
  conversation_turn: 0.75,
  working_memory: 0.7,
  presence: 0.6,
  location: 0.55,
  recent_event: 0.5,
  available_capability: 0.45,
  policy: 0.5,
  evidence: 0.4,
  long_term_memory: 0.4,
  world_entity: 0.4,
};

export interface RankInput extends Omit<ContextItem, 'relevance'> {
  /** ms since the item's underlying fact/observation, for recency decay. */
  ageMs?: number;
}

/** Compute a deterministic relevance score in [0,1]. */
export function scoreItem(item: RankInput, req: ContextRequest): number {
  const base = KIND_WEIGHT[item.kind] ?? 0.3;
  const focusBoost = focusOverlap(item, req.focusRefs ?? []) ? 0.15 : 0;
  const recency = item.ageMs === undefined ? 0 : Math.max(0, 0.1 * Math.pow(0.5, item.ageMs / 120_000));
  const confidence = 0.1 * (item.provenance.derivedFromUntrusted ? 0.3 : 1);
  return clamp01(base + focusBoost + recency + confidence);
}

function focusOverlap(item: RankInput, focusRefs: string[]): boolean {
  if (focusRefs.length === 0) return false;
  const hay = `${item.summary} ${safeString(item.content)}`.toLowerCase();
  return focusRefs.some((f) => hay.includes(f.toLowerCase()));
}

export interface BuildResult {
  kept: ContextItem[];
  omitted: string[];
  usedUnits: number;
  truncated: boolean;
  byPrivacy: number;
  byDedupe: number;
}

/**
 * Filter by privacy ceiling, dedupe by contentHash, sort by relevance desc
 * (stable: ties broken by contentHash), then greedily fill the unit budget.
 */
export function buildPackage(
  scored: ContextItem[],
  req: ContextRequest,
): BuildResult {
  let byPrivacy = 0;
  const privacyCeiling = PRIVACY_RANK[req.maxPrivacyClass];
  const afterPrivacy = scored.filter((i) => {
    const ok = PRIVACY_RANK[i.privacyClass] <= privacyCeiling;
    if (!ok) byPrivacy++;
    return ok;
  });

  let byDedupe = 0;
  const seen = new Set<string>();
  const afterDedupe = afterPrivacy.filter((i) => {
    if (seen.has(i.contentHash)) {
      byDedupe++;
      return false;
    }
    seen.add(i.contentHash);
    return true;
  });

  afterDedupe.sort((a, b) =>
    b.relevance !== a.relevance ? b.relevance - a.relevance : a.contentHash.localeCompare(b.contentHash),
  );

  const kept: ContextItem[] = [];
  const omitted: string[] = [];
  let usedUnits = 0;
  for (const item of afterDedupe) {
    if (usedUnits + item.sizeUnits <= req.budgetUnits) {
      kept.push(item);
      usedUnits += item.sizeUnits;
    } else {
      omitted.push(item.summary);
    }
  }

  return {
    kept,
    omitted,
    usedUnits,
    truncated: omitted.length > 0,
    byPrivacy,
    byDedupe,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(4))));
}
function safeString(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return '';
  }
}
