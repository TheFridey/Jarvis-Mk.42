/**
 * Durable personal memory — selection policy.
 *
 * Pure and synchronous, like the conversation privacy policy it sits beside: given approved
 * records, a query and where inference will run, it decides what may enter the context and
 * records why everything else was left out. Storage lives in `personal-memory-store.ts`.
 *
 * The rules that matter:
 *
 *  - private by default — a record is only usable when a human approved it;
 *  - a record belongs to one principal and is never visible to another;
 *  - relevance is required: a greeting must not drag in an entire profile;
 *  - cloud is a ceiling, not a switch — SENSITIVE and RESTRICTED never leave the machine;
 *  - a revoked record is gone from selection, not merely flagged;
 *  - nothing here can authorise anything. Memory is context, never capability.
 */

export const MEMORY_POLICY_VERSION = 1;

/** Same ceiling as conversations: INTERNAL is the most that may leave this machine. */
export const MEMORY_CLOUD_CEILING: PrivacyClass = 'INTERNAL';

export const MEMORY_CONTEXT_LIMIT = 6;
/** Below this lexical score a memory is noise, not context. */
export const MEMORY_MIN_SCORE = 0.4;

export type PrivacyClass = 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' | 'RESTRICTED';

export type MemoryCategory =
  | 'preference' | 'communication' | 'interest' | 'skill' | 'learning'
  | 'family_priority' | 'ambition' | 'business' | 'project' | 'history'
  | 'decision' | 'milestone' | 'constraint';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface MemoryRecord {
  id: string;
  principalId: string;
  category: MemoryCategory;
  subject: string;
  statement: string;
  source: string;
  confidence: number;
  privacyClass: PrivacyClass;
  cloudEligible: boolean;
  reviewStatus: ReviewStatus;
  recordedAt: string;
  lastVerifiedAt?: string;
  supersededBy?: string;
  revokedAt?: string;
}

export type ExclusionReason =
  | 'wrong_principal' | 'revoked' | 'superseded' | 'not_approved' | 'rejected'
  | 'cloud_ineligible' | 'ceiling_exceeded' | 'irrelevant' | 'budget';

/**
 * Broad conversational requests that refer to a kind of memory rather than words inside one.
 * The register is a relevance hint: it widens *what may be considered*, and nothing else — every
 * record still passes principal, approval, class and disclosure checks.
 */
export function categoryHintFor(input: string): MemoryCategory[] | undefined {
  const text = input.toLowerCase();
  if (/\b(hype|big me up|pump me up|go deeper|more personal)\b/.test(text)) {
    return ['milestone', 'business', 'project', 'ambition', 'history', 'decision', 'skill', 'communication'];
  }
  if (/\b(how far (have|has) (we|it) come|what have we (built|done)|progress so far|looking back|over the (years|months)|journey)\b/.test(text)) {
    return ['milestone', 'decision', 'project', 'business', 'history', 'ambition', 'skill', 'constraint'];
  }
  if (/\b(what are we (currently )?working on|what'?s in flight|current projects?|what projects?|what'?s next)\b/.test(text)) {
    return ['project', 'decision', 'milestone', 'business', 'constraint'];
  }
  if (/\b(before (scale ?smiths|this company|that company)|used to do|previous (job|work|role)|career|my history)\b/.test(text)) {
    return ['history', 'skill', 'milestone', 'decision'];
  }
  if (/\b(what do you (actually |really )?know about me|what have you (got|remember) on me|my profile)\b/.test(text)) {
    return ['preference', 'communication', 'interest', 'skill', 'learning', 'ambition', 'business', 'project', 'milestone', 'history', 'decision', 'constraint'];
  }
  if (text.includes('what should we')) return ['project', 'decision', 'constraint', 'ambition'];
  return undefined;
}

/**
 * An explicit instruction to remember something, or undefined.
 *
 * Only an imperative counts. "Imagine I preferred..." and "don't remember that" are not requests
 * to store anything, and a hypothetical must never become a fact about the owner.
 */
export function rememberRequest(input: string): string | undefined {
  const text = input.trim();
  if (!/^(?:please\s+)?remember\b/i.test(text)) return undefined;
  if (/\b(?:don'?t|do not|never|stop)\b/i.test(text)) return undefined;
  const body = text.replace(/^(?:please\s+)?remember(?:\s+that)?[:,\s]+/i, '').trim();
  if (body.length < 3) return undefined;
  if (/\b(?:imagine|pretend|hypothetical(?:ly)?|suppose|what if|if i said)\b/i.test(body)) return undefined;
  return body.slice(0, 2000);
}

/**
 * How much memory a moment deserves.
 *
 * Conversational mode changes relevance and budget only. It never changes eligibility: a request
 * for a deeper hype session does not widen who may see what, and no phrase in a message can raise
 * a privacy ceiling or grant consent.
 */
export type RetrievalMode = 'CASUAL' | 'ADVISOR' | 'REFLECTIVE' | 'HYPE' | 'OPERATOR';

export interface RetrievalBudget { mode: RetrievalMode; limit: number; minScore: number }

export function retrievalModeFor(input: string): RetrievalMode {
  const text = input.toLowerCase();
  if (/\b(hype|pump me up|big me up|go deeper|more personal)\b/.test(text)) return 'HYPE';
  if (/\b(how far have we come|looking back|over the (years|months)|what i'?ve built|journey)\b/.test(text)) return 'REFLECTIVE';
  if (/\b(restart|deploy|install|run|execute|audit|commit|build|migrate|diagnostics|status)\b/.test(text)) return 'OPERATOR';
  if (/\b(business mode|strategy|pricing|price|margin|revenue|should we|project|roadmap)\b/.test(text)) return 'ADVISOR';
  return 'CASUAL';
}

const BUDGETS: Record<RetrievalMode, { limit: number; minScore: number }> = {
  // A greeting should carry at most a communication preference, and only if it is plainly relevant.
  // The budget, not the threshold, is what keeps chat light — raising the bar here would drop a
  // plainly relevant preference because the phrasing did not match its subject words.
  CASUAL: { limit: 2, minScore: 0.4 },
  OPERATOR: { limit: 3, minScore: 0.5 },
  ADVISOR: { limit: 5, minScore: 0.4 },
  REFLECTIVE: { limit: 7, minScore: 0.35 },
  HYPE: { limit: 8, minScore: 0.35 },
};

export function retrievalBudgetFor(input: string): RetrievalBudget {
  const mode = retrievalModeFor(input);
  return { mode, ...BUDGETS[mode] };
}

export interface SelectionInput {
  records: MemoryRecord[];
  query: string;
  principalId: string;
  locality: 'local' | 'cloud';
  limit?: number;
  minScore?: number;
  /** Categories that count as relevant for a broad request, before lexical scoring. */
  categories?: MemoryCategory[];
}

export interface SelectedMemory { record: MemoryRecord; score: number }
export interface ExcludedMemory { id: string; reason: ExclusionReason }

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'i', 'we', 'you', 'it', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'for', 'with', 'my', 'me', 'our', 'that', 'this', 'be', 'have', 'has', 'do', 'does', 'as', 'at', 'so', 'if', 'about', 'what', 'how', 'why', 'just']);

export function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(word => word.length > 2 && !STOP.has(word));
}

/**
 * Lexical relevance, bounded and explainable. Deliberately not an embedding model: this
 * workstation has no headroom for one, and a score you can argue about is better than a
 * similarity you cannot inspect.
 */
export function memoryRelevance(record: MemoryRecord, query: string): number {
  const wanted = new Set(tokens(query));
  if (wanted.size === 0) return 0;
  const subject = new Set(tokens(record.subject));
  const body = new Set(tokens(`${record.statement} ${record.category.replace(/_/g, ' ')}`));
  let hits = 0;
  for (const word of wanted) {
    if (subject.has(word)) hits += 1.5;           // subject match is worth more than a mention
    else if (body.has(word)) hits += 1;
  }
  // Normalise by the query, not the record: a long record must not out-score a precise one.
  const score = hits / Math.sqrt(wanted.size);
  return Math.round(score * 100) / 100;
}

/** True when the record's class is allowed to leave the machine. */
export function classPermitsCloud(record: MemoryRecord): boolean {
  if (!record.cloudEligible) return false;
  return record.privacyClass === 'PUBLIC' || record.privacyClass === 'INTERNAL';
}

export function selectMemories(input: SelectionInput): { selected: SelectedMemory[]; excluded: ExcludedMemory[] } {
  const limit = input.limit ?? MEMORY_CONTEXT_LIMIT;
  const minScore = input.minScore ?? MEMORY_MIN_SCORE;
  const selected: SelectedMemory[] = [];
  const excluded: ExcludedMemory[] = [];

  for (const record of input.records) {
    // Order matters: provenance and governance before relevance, so a revoked private record
    // is never reported as "irrelevant" and mistaken for something that could be re-approved.
    if (record.principalId !== input.principalId) { excluded.push({ id: record.id, reason: 'wrong_principal' }); continue; }
    if (record.revokedAt) { excluded.push({ id: record.id, reason: 'revoked' }); continue; }
    if (record.supersededBy) { excluded.push({ id: record.id, reason: 'superseded' }); continue; }
    if (record.reviewStatus === 'rejected') { excluded.push({ id: record.id, reason: 'rejected' }); continue; }
    if (record.reviewStatus !== 'approved') { excluded.push({ id: record.id, reason: 'not_approved' }); continue; }
    if (input.locality === 'cloud') {
      if (!classPermitsCloud(record)) { excluded.push({ id: record.id, reason: 'cloud_ineligible' }); continue; }
      if (record.privacyClass === 'RESTRICTED' || record.privacyClass === 'SENSITIVE') { excluded.push({ id: record.id, reason: 'ceiling_exceeded' }); continue; }
    }
    const lexical = memoryRelevance(record, input.query);
    // A broad request is answered by the kind of record it asks for, not by the words in it,
    // but it never becomes an excuse to include a weakly-scored one.
    const categoryFit = input.categories?.includes(record.category) ? 0.75 : 0;
    const score = Math.max(lexical, categoryFit + Math.min(lexical, 0.2));
    if (score < minScore) { excluded.push({ id: record.id, reason: 'irrelevant' }); continue; }
    selected.push({ record, score });
  }

  selected.sort((left, right) => right.score - left.score || right.record.confidence - left.record.confidence);
  for (const overflow of selected.splice(limit)) excluded.push({ id: overflow.record.id, reason: 'budget' });
  return { selected, excluded };
}

/**
 * The text a model may see. Subject then statement, no ids, no provenance paths, no
 * classification labels — those are for the operator, not the conversation.
 */
/**
 * Counts for one retrieval, never content.
 *
 * Exists because the live failure this diagnoses was silent: the repository answered, selection
 * returned nothing, and the model correctly said it had nothing. A principal mismatch and an empty
 * table look identical from the outside unless something counts the stages.
 */
export interface RecallDiagnostics {
  mode: RetrievalMode;
  candidates: number;
  approved: number;
  wrongPrincipal: number;
  classEligible: number;
  cloudEligible: number;
  irrelevant: number;
  budgetDropped: number;
  selected: number;
  blockBytes: number;
}

export function recallDiagnostics(input: SelectionInput & { records: MemoryRecord[] }): RecallDiagnostics {
  const budget = retrievalBudgetFor(input.query);
  // Same hinting the production selector uses; a trace that omits it would under-report selection.
  const { selected, excluded } = selectMemories({ ...input, categories: input.categories ?? categoryHintFor(input.query), limit: budget.limit, minScore: budget.minScore });
  const count = (reason: ExclusionReason) => excluded.filter(entry => entry.reason === reason).length;
  return {
    mode: budget.mode,
    candidates: input.records.length,
    approved: input.records.filter(record => record.reviewStatus === 'approved' && !record.revokedAt).length,
    wrongPrincipal: count('wrong_principal'),
    classEligible: input.records.filter(record => record.reviewStatus === 'approved' && !record.revokedAt && (!input.locality || input.locality === 'local' || classPermitsCloud(record))).length,
    cloudEligible: input.records.filter(record => classPermitsCloud(record)).length,
    irrelevant: count('irrelevant'),
    budgetDropped: count('budget'),
    selected: selected.length,
    blockBytes: memoryContextLines(selected).join(String.fromCharCode(10)).length,
  };
}

/** The exact text block that may accompany a turn. One place, so both call sites agree. */
export function composeMemoryContext(records: MemoryRecord[], input: { query: string; principalId: string; locality: 'local' | 'cloud' }): string {
  if (!records.length) return '';
  const budget = retrievalBudgetFor(input.query);
  const { selected } = selectMemories({ records, query: input.query, principalId: input.principalId, locality: input.locality, categories: categoryHintFor(input.query), limit: budget.limit, minScore: budget.minScore });
  if (!selected.length) return '';
  return ['', '', 'Approved context about the owner (use only where relevant; never recite it):', ...memoryContextLines(selected)].join(String.fromCharCode(10));
}

export function memoryContextLines(selected: SelectedMemory[]): string[] {
  return selected.map(({ record }) => `- ${record.subject}: ${record.statement}`);
}
