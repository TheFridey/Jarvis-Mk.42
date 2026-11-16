import { categoryHintFor, memoryContextLines, selectMemories, type ExcludedMemory, type MemoryRecord, type SelectedMemory } from './personal-memory.ts';
import { retrievalIntentFor, type IntentPlan } from './retrieval-intent.ts';

/**
 * One selection, used for everything that follows it.
 *
 * The live defect this replaces: the request path selected with `categories: categoryHintFor(query)`
 * and no limit, no minScore and no diversity, while the diagnostic recomputed with the intent's
 * categories, limit and minScore. So the trace said "6 selected, 821 bytes" and the database recorded
 * zero ids, and both numbers were produced by real code. The selection that reaches the model must be
 * the selection that is recorded, or neither claim means anything.
 *
 * Two further corrections live here rather than at the call site:
 *  - a follow-up is scored against the topic it follows up on, not against "what else haven't you
 *    mentioned", which shares no words with anything in the owner's history and therefore scored zero;
 *  - the intent decides categories, limit, threshold and diversity unless the query supplies an
 *    explicit, narrower hint.
 */
export interface AdaptiveSelection {
  plan: IntentPlan;
  /** The text the selector scored against: the topic plus the follow-up, when there is one. */
  query: string;
  selected: SelectedMemory[];
  excluded: ExcludedMemory[];
  /** The block the model sees, or '' when nothing was selected. */
  text: string;
  ids: string[];
  bytes: number;
}

export const MEMORY_BLOCK_HEADER = 'Approved context about the owner (use only where relevant; never recite it):';

export function memoryBlock(selected: SelectedMemory[]): string {
  if (!selected.length) return '';
  return ['', '', MEMORY_BLOCK_HEADER, ...memoryContextLines(selected)].join(String.fromCharCode(10));
}

export function adaptiveMemorySelection(input: {
  records: MemoryRecord[];
  query: string;
  principalId: string;
  locality: 'local' | 'cloud';
  /** The previous turn's own question, when this turn is an expansion of it. */
  previousQuery?: string;
  /** Records this conversation has already been given. */
  alreadyGiven?: string[];
}): AdaptiveSelection {
  const plan = retrievalIntentFor(input.query);
  const expanding = plan.intent === 'FOLLOW_UP' && Boolean(input.previousQuery);
  const query = expanding ? `${input.previousQuery} ${input.query}` : input.query;
  const categories = categoryHintFor(query) ?? plan.categories;

  const { selected, excluded } = selectMemories({
    records: input.records,
    query,
    principalId: input.principalId,
    locality: input.locality,
    limit: plan.limit,
    minScore: plan.minScore,
    diversify: plan.diversify,
    ...(categories ? { categories } : {}),
    ...(expanding && input.alreadyGiven?.length ? { exclude: input.alreadyGiven } : {}),
  });

  const text = memoryBlock(selected);
  return { plan, query, selected, excluded, text, ids: selected.map(entry => entry.record.id), bytes: new TextEncoder().encode(text).length };
}

/**
 * The only shape a recall trace may take: counts, an intent name and a length.
 *
 * The live traces contained the owner's actual sentence ("Mate, tell me everything you know about my
 * previous career") and, worse, the combined previous-and-current query used for a follow-up. That is a
 * copy of a private conversation in a log file. Nothing here can be reconstructed into words: the
 * query contributes its character count, and nothing contributes its text.
 */
export function memoryTrace(input: {
  correlationId: string;
  principalId: string;
  locality: 'local' | 'cloud';
  selection: AdaptiveSelection;
  candidates: number;
  approved: number;
  topicChars?: number;
  queryChars: number;
}): Record<string, unknown> {
  const count = (reason: string) => input.selection.excluded.filter(entry => entry.reason === reason).length;
  return {
    component: 'memory_recall', correlationId: input.correlationId, principalId: input.principalId,
    locality: input.locality, intent: input.selection.plan.intent,
    queryChars: input.queryChars, ...(input.topicChars ? { topicChars: input.topicChars } : {}),
    candidates: input.candidates, approved: input.approved,
    irrelevant: count('irrelevant'), cloudIneligible: count('cloud_ineligible'),
    ceilingExceeded: count('ceiling_exceeded'), alreadyProvided: count('already_provided'),
    budget: count('budget'), selected: input.selection.selected.length, blockBytes: input.selection.bytes,
  };
}
