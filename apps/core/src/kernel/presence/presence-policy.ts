/**
 * Presence derivation - PURE. Maps a bounded window of observable evidence to a
 * PresenceState + confidence. NEVER infers mental/emotional/medical state
 * (PERCEPTION_MODEL.md, spec constraint). Deterministic: same evidence in,
 * same state out.
 *
 * Model: each evidence kind contributes a weighted vote toward a state, decayed
 * by age. The highest-scoring state wins; confidence is the normalised margin.
 */
import type { PresenceEvidence, PresenceState } from '@jarvis/contracts';

const HALF_LIFE_MS = 60_000; // evidence contribution halves every minute

interface Vote {
  state: PresenceState;
  weight: number;
}

function voteFor(kind: PresenceEvidence['kind']): Vote {
  switch (kind) {
    case 'voice_interaction':
      return { state: 'ENGAGED', weight: 1.0 };
    case 'workspace_interaction':
      return { state: 'FOCUSED', weight: 0.9 };
    case 'input_activity':
      return { state: 'ENGAGED', weight: 0.7 };
    case 'camera_presence':
      return { state: 'PRESENT', weight: 0.8 };
    case 'node_presence':
      return { state: 'PRESENT', weight: 0.4 };
    case 'camera_absence':
      return { state: 'ABSENT', weight: 0.8 };
    case 'idle_timeout':
      return { state: 'ABSENT', weight: 0.6 };
  }
}

export interface PresenceDerivation {
  state: PresenceState;
  confidence: number;
}

export function derivePresence(
  evidence: PresenceEvidence[],
  nowMs: number,
): PresenceDerivation {
  if (evidence.length === 0) return { state: 'UNKNOWN', confidence: 0 };

  const scores: Record<PresenceState, number> = {
    UNKNOWN: 0,
    ABSENT: 0,
    PRESENT: 0,
    ENGAGED: 0,
    FOCUSED: 0,
  };

  for (const e of evidence) {
    const ageMs = Math.max(0, nowMs - Date.parse(e.observedAt));
    const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
    const v = voteFor(e.kind);
    scores[v.state] += v.weight * decay * e.confidence;
  }

  // FOCUSED implies ENGAGED implies PRESENT: propagate upward so a strong
  // FOCUSED signal also supports the weaker states rather than splitting votes.
  scores.ENGAGED += scores.FOCUSED * 0.5;
  scores.PRESENT += scores.ENGAGED * 0.5;

  let best: PresenceState = 'UNKNOWN';
  let bestScore = 0;
  let total = 0;
  for (const s of Object.keys(scores) as PresenceState[]) {
    total += scores[s];
    if (scores[s] > bestScore) {
      bestScore = scores[s];
      best = s;
    }
  }

  // Negligible total decayed weight -> we effectively have no current evidence.
  if (bestScore < 0.05) return { state: 'UNKNOWN', confidence: 0 };
  // ABSENT wins only if it clearly dominates the "present" family.
  const presentFamily = scores.PRESENT + scores.ENGAGED + scores.FOCUSED;
  if (best === 'ABSENT' && scores.ABSENT < presentFamily) {
    best = strongestPresent(scores);
    bestScore = scores[best];
  }

  const confidence = total > 0 ? Math.min(1, bestScore / total) : 0;
  return { state: best, confidence: Number(confidence.toFixed(3)) };
}

function strongestPresent(scores: Record<PresenceState, number>): PresenceState {
  const order: PresenceState[] = ['FOCUSED', 'ENGAGED', 'PRESENT'];
  let best: PresenceState = 'PRESENT';
  let bestScore = -1;
  for (const s of order) {
    if (scores[s] > bestScore) {
      bestScore = scores[s];
      best = s;
    }
  }
  return best;
}
