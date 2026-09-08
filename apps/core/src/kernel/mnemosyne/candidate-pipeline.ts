/**
 * Memory-candidate scorer + disposition (MNEMOSYNE_MODEL.md §4, memory-candidate.ts).
 *
 * Nothing becomes an episode without passing this gate — not every conversation
 * line is stored. The scorer is deterministic and stores its component breakdown
 * so "why do you remember that?" is answerable.
 *
 * PURE: `score()` and `decide()` take an explicit context object (similarity to
 * what is already stored, objective overlap, privacy). The pipeline class wires
 * that context from the stores.
 */
import type { CandidateDisposition, CandidateScore, PrivacyClass } from '@jarvis/contracts';

export interface ScoreContext {
  /** Best similarity (0..1) to an already-stored episode/candidate. */
  maxSimilarityToStored: number;
  /** True if the candidate references an active objective. */
  touchesActiveObjective: boolean;
  /** Producer's confidence in the underlying material, 0..1. */
  confidenceHint: number;
  privacyClass: PrivacyClass;
  /** "event" | "session_outcome" | "objective_outcome" | "decision" | "agent_proposal" | ... */
  sourceKind: string;
  /** True if the candidate looks like a durable fact/procedure rather than a
   *  transient status ping. */
  looksDurable: boolean;
}

export interface DispositionThresholds {
  accept: number;
  reject: number;
  /** duplication at/above this => merge instead of accept. */
  duplicate: number;
  /** sensitivity at/above this => defer for review rather than auto-accept. */
  sensitive: number;
}

export const DEFAULT_THRESHOLDS: DispositionThresholds = {
  accept: 0.55,
  reject: 0.3,
  duplicate: 0.85,
  sensitive: 0.8,
};

const SOURCE_QUALITY: Record<string, number> = {
  principal_assertion: 1.0,
  decision: 0.9,
  objective_outcome: 0.85,
  session_outcome: 0.8,
  action_outcome: 0.8,
  agent_proposal: 0.55,
  event: 0.5,
  conversation: 0.5,
};

const PRIVACY_SENSITIVITY: Record<PrivacyClass, number> = {
  PUBLIC: 0.0,
  INTERNAL: 0.2,
  SENSITIVE: 0.85,
  RESTRICTED: 1.0,
};

export function scoreCandidate(ctx: ScoreContext): CandidateScore {
  const duplication = clamp01(ctx.maxSimilarityToStored);
  const novelty = clamp01(1 - ctx.maxSimilarityToStored);
  const sourceQuality = SOURCE_QUALITY[ctx.sourceKind] ?? 0.4;
  const objectiveRelevance = ctx.touchesActiveObjective ? 1 : 0.3;
  const importance = clamp01(0.4 * sourceQuality + 0.35 * objectiveRelevance + 0.25 * (ctx.looksDurable ? 1 : 0.4));
  const durability = ctx.looksDurable ? 0.85 : 0.35;
  const futureUtility = clamp01(0.5 * objectiveRelevance + 0.3 * durability + 0.2 * novelty);
  const confidence = clamp01(ctx.confidenceHint);
  const sensitivity = PRIVACY_SENSITIVITY[ctx.privacyClass];

  // Weighted blend; duplication and sensitivity are penalties.
  const positive =
    0.22 * novelty + 0.22 * importance + 0.18 * futureUtility + 0.14 * objectiveRelevance +
    0.12 * confidence + 0.12 * durability;
  const composite = clamp01(positive * (1 - 0.6 * duplication) * (1 - 0.25 * sensitivity) + 0.1 * sourceQuality);

  return {
    novelty, importance, futureUtility, objectiveRelevance, confidence,
    duplication, sensitivity, durability, sourceQuality, composite,
  };
}

export function decideDisposition(
  score: CandidateScore, t: DispositionThresholds = DEFAULT_THRESHOLDS,
): CandidateDisposition {
  if (score.duplication >= t.duplicate) return 'merged';
  if (score.sensitivity >= t.sensitive && score.composite < 0.75) return 'deferred';
  if (score.composite >= t.accept) return 'accepted';
  if (score.composite < t.reject) return 'rejected';
  return 'deferred';
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
