import { PersonalMemoryService } from './personal-memory-service.ts';
import type { MemoryRecord } from './personal-memory.ts';

/**
 * Interactive owner review of pending memories.
 *
 * The database is the source of truth and the only progress record: every loop iteration re-reads
 * the pending set, so an interruption, a crash or a second process cannot desynchronise anything.
 * There is no local counter, no bulk mode and no path that approves on an empty answer.
 *
 * The owner's statements are printed to the terminal and nowhere else — no logging, no telemetry,
 * no evidence file.
 */

export type Decision = 'approve' | 'skip' | 'quit' | 'help';

export interface ReviewIo {
  write(line: string): void;
  ask(prompt: string): Promise<string>;
}

export interface ReviewOutcome {
  approved: string[];
  skipped: string[];
  errors: string[];
  remaining: number;
  active: number;
  quit: boolean;
  emptyQueue: boolean;
}

export const REVIEW_HELP = [
  'A — approve locally (does not grant cloud consent)',
  'S — skip for this session, leave pending',
  'Q — quit safely, no further changes',
  'H — show this help',
];

export function parseDecision(answer: string): Decision | 'unknown' {
  switch (answer.trim().toLowerCase()) {
    case 'a': case 'approve': return 'approve';
    case 's': case 'skip': return 'skip';
    case 'q': case 'quit': return 'quit';
    case 'h': case 'help': case '?': return 'help';
    default: return 'unknown';
  }
}

const describe = (record: MemoryRecord, index: number, total: number): string[] => [
  '',
  `[${index + 1}/${total}] ${record.category} · ${record.subject}`,
  `  ${record.statement}`,
  `  source: ${record.source} · confidence: ${record.confidence}`,
  `  class: ${record.privacyClass} · cloud: ${record.cloudEligible ? 'permitted' : 'local only'} · status: ${record.reviewStatus}`,
];

export class ReviewSession {
  constructor(
    private readonly service: PersonalMemoryService,
    private readonly principalId: string,
    private readonly io: ReviewIo,
  ) {}

  /** Returns the outcome; never throws for a per-record failure, which is reported instead. */
  async run(): Promise<ReviewOutcome> {
    const outcome: ReviewOutcome = { approved: [], skipped: [], errors: [], remaining: 0, active: 0, quit: false, emptyQueue: false };
    const all = await this.service.list(this.principalId);
    const active = all.filter(record => record.reviewStatus === 'approved' && !record.revokedAt).length;
    const pending = all.filter(record => record.reviewStatus === 'pending' && !record.revokedAt);

    this.io.write(`Principal: ${this.principalId}`);
    this.io.write(`Records: ${all.length} total · ${active} active · ${pending.length} pending`);
    this.io.write('Local approval records a memory for your own use. It does not grant cloud consent;');
    this.io.write('cloud disclosure is a separate, per-record decision (memory grant-cloud).');

    if (!pending.length) {
      outcome.emptyQueue = true;
      outcome.active = active;
      this.io.write('Nothing pending. Nothing to do.');
      return outcome;
    }

    this.io.write('Press H for help at any prompt.');

    let answered = 0;
    for (;;) {
      // Re-read each iteration: another process, or this one before a crash, may have changed things.
      const current = (await this.service.list(this.principalId)).filter(record => record.reviewStatus === 'pending' && !record.revokedAt);
      if (!current.length) break;
      const record = current[0]!;
      for (const line of describe(record, answered, Math.max(answered + current.length, 1))) this.io.write(line);
      this.io.write('  [A]pprove locally  [S]kip  [Q]uit  [H]elp');
      const answer = await this.io.ask('> ');
      if (answer === '__eof__') {
        // A closed stdin must never approve anything.
        outcome.quit = true;
        break;
      }
      const decision = parseDecision(answer);
      if (decision === 'help') { REVIEW_HELP.forEach(line => this.io.write(`  ${line}`)); continue; }
      if (decision === 'unknown') {
        // An empty or unrecognised answer is not consent.
        if (answer.trim() === '') this.io.write('  Nothing entered — that is not an approval. Type A, S or Q.');
        else this.io.write('  Not understood. Type A, S, Q or H.');
        continue;
      }
      if (decision === 'quit') { outcome.quit = true; break; }
      if (decision === 'skip') { outcome.skipped.push(record.id); answered += 1; continue; }

      try {
        await this.service.approve(this.principalId, record.id);
        // Confirm against persisted state rather than trusting the call.
        const after = (await this.service.list(this.principalId)).find(held => held.id === record.id);
        if (after?.reviewStatus === 'approved') outcome.approved.push(record.id);
        else outcome.errors.push(`${record.id}: approval was not persisted; it is still pending`);
      } catch (error) {
        outcome.errors.push(`${record.id}: ${(error as Error).message.slice(0, 120)}`);
      }
      answered += 1;
    }

    const final = await this.service.list(this.principalId);
    outcome.remaining = final.filter(record => record.reviewStatus === 'pending' && !record.revokedAt).length;
    outcome.active = final.filter(record => record.reviewStatus === 'approved' && !record.revokedAt).length;

    this.io.write('');
    this.io.write(`Approved this session: ${outcome.approved.length}`);
    this.io.write(`Skipped this session: ${outcome.skipped.length}`);
    this.io.write(`Remaining pending: ${outcome.remaining}`);
    this.io.write(`Active records: ${outcome.active}`);
    if (outcome.errors.length) { this.io.write(`Errors: ${outcome.errors.length}`); outcome.errors.forEach(line => this.io.write(`  ${line}`)); }
    if (outcome.remaining) this.io.write('Resume with: node $pnpm memory review');
    return outcome;
  }
}
