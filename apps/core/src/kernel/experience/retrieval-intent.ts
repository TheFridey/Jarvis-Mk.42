import type { MemoryCategory } from './personal-memory.ts';

/**
 * What the turn needs to *know*, separated from how it should *sound*.
 *
 * The defect this fixes: a casually phrased question ("mate, tell me everything you know about my
 * previous career") was budgeted by conversational register, so CASUAL meant two records — and the
 * model, given two records, said it had nothing else. Register is how to answer; intent is how much
 * evidence the answer needs. They are decided separately, and neither touches privacy.
 *
 * Deterministic and local: no model call, no network, no cost.
 */

export type RetrievalIntent =
  | 'SOCIAL' | 'BANTER' | 'TARGETED_FACT' | 'ENTITY_DETAIL' | 'CAREER_HISTORY'
  | 'PROJECT_INVENTORY' | 'RECENT_PROGRESS' | 'PROFILE_OVERVIEW' | 'REFLECTIVE'
  | 'ENCOURAGEMENT' | 'TECHNICAL_OPERATION' | 'GENERAL_KNOWLEDGE'
  | 'COMPREHENSIVE_RECALL' | 'FOLLOW_UP';

export interface IntentPlan {
  intent: RetrievalIntent;
  /** Maximum records. A ceiling, never a target. */
  limit: number;
  minScore: number;
  categories?: MemoryCategory[];
  /** Prefer distinct subjects over several facts about one. */
  diversify: boolean;
  /** Extra guidance the answer should follow about what it was given. */
  completeness: 'none' | 'partial' | 'broad';
}

const CAREER: MemoryCategory[] = ['history', 'skill', 'milestone', 'decision', 'business'];
const PROJECTS: MemoryCategory[] = ['project', 'decision', 'milestone', 'constraint', 'business'];
const PROFILE: MemoryCategory[] = ['history', 'preference', 'communication', 'interest', 'skill', 'learning', 'ambition', 'business', 'project', 'milestone', 'decision'];
const REFLECT: MemoryCategory[] = ['milestone', 'history', 'decision', 'ambition', 'project', 'business'];
const ENCOURAGE: MemoryCategory[] = ['milestone', 'history', 'ambition', 'skill', 'business', 'project', 'communication'];

const at = (text: string, ...needles: string[]) => needles.some(needle => text.includes(needle));

export function retrievalIntentFor(raw: string): IntentPlan {
  const text = raw.toLowerCase().replace(/[’']/g, "'");

  // Expansion is checked first: "what else" must not be read as a fresh narrow question.
  if (at(text, 'what else', 'anything else', 'other than that', 'what other work', 'what other projects',
    'what haven\'t you mentioned', 'what have you not mentioned', 'tell me more', 'go deeper', 'dig deeper',
    'and the rest', 'anything other than')) {
    return { intent: 'FOLLOW_UP', limit: 24, minScore: 0.25, categories: PROFILE, diversify: true, completeness: 'broad' };
  }

  if (at(text, 'everything you know', 'everything about', 'all you know', 'full history', 'complete history',
    'tell me everything', 'the whole story', 'my entire')) {
    return { intent: 'COMPREHENSIVE_RECALL', limit: 24, minScore: 0.2, categories: PROFILE, diversify: true, completeness: 'broad' };
  }

  if (at(text, 'hype', 'pump me up', 'big me up', 'gee me up')) {
    return { intent: 'ENCOURAGEMENT', limit: 16, minScore: 0.3, categories: ENCOURAGE, diversify: true, completeness: 'broad' };
  }

  if (at(text, 'know about me', 'my profile', 'about me as a person', 'describe me', 'sum up what you know', 'what have you got on me')) {
    return { intent: 'PROFILE_OVERVIEW', limit: 20, minScore: 0.3, categories: PROFILE, diversify: true, completeness: 'broad' };
  }

  if (at(text, 'before scale', 'before founding', 'before that', 'previous career', 'previous job', 'used to do',
    'work history', 'career', 'my history before', 'what did i do before', 'other work')) {
    return { intent: 'CAREER_HISTORY', limit: 15, minScore: 0.28, categories: CAREER, diversify: true, completeness: 'broad' };
  }

  if (at(text, 'projects are we', 'projects we', 'what projects', 'current projects', 'working on', 'in flight',
    'what are we building', 'roadmap')) {
    return { intent: 'PROJECT_INVENTORY', limit: 15, minScore: 0.28, categories: PROJECTS, diversify: true, completeness: 'partial' };
  }

  if (at(text, 'how far have we come', 'recently', 'progress', 'this week', 'this month', 'lately', 'looking back')) {
    return { intent: 'RECENT_PROGRESS', limit: 12, minScore: 0.3, categories: REFLECT, diversify: true, completeness: 'partial' };
  }

  if (at(text, 'tell me about', 'what about', 'details on', 'everything on')) {
    return { intent: 'ENTITY_DETAIL', limit: 10, minScore: 0.35, categories: undefined, diversify: false, completeness: 'partial' };
  }

  if (at(text, 'morning', 'afternoon', 'evening', 'hello', 'hi ', 'hey', 'good night')) {
    return { intent: 'SOCIAL', limit: 2, minScore: 0.5, categories: ['communication', 'preference'], diversify: false, completeness: 'none' };
  }

  if (at(text, 'only having a laugh', 'joking', 'banter', 'wind my neck', 'taking the piss')) {
    return { intent: 'BANTER', limit: 1, minScore: 0.5, categories: ['communication'], diversify: false, completeness: 'none' };
  }

  if (at(text, 'restart', 'deploy', 'migrate', 'diagnostics', 'healthz', 'run the', 'build the', 'commit')) {
    return { intent: 'TECHNICAL_OPERATION', limit: 3, minScore: 0.45, categories: ['constraint', 'decision', 'project'], diversify: false, completeness: 'none' };
  }

  // A question that is plainly not about the owner should not drag memory in.
  if (at(text, 'difference between', 'what is a', 'what are the', 'explain', 'how does', 'why does')) {
    return { intent: 'GENERAL_KNOWLEDGE', limit: 0, minScore: 1, categories: undefined, diversify: false, completeness: 'none' };
  }

  return { intent: 'TARGETED_FACT', limit: 4, minScore: 0.35, categories: undefined, diversify: true, completeness: 'partial' };
}

/** Grouping key for diversity: the first meaningful words of a subject. */
export function entityKey(subject: string): string {
  const words = subject.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const generic = new Set(['the', 'a', 'an', 'my', 'our', 'current', 'former', 'previous', 'project', 'note']);
  const meaningful = words.filter(word => !generic.has(word));
  // Fall back to the raw words when a subject is made entirely of generic ones.
  return (meaningful.length ? meaningful : words).slice(0, 2).join(' ') || subject.toLowerCase().trim();
}
