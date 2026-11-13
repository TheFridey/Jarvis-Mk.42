import type { MemoryCategory, MemoryRecord, PrivacyClass, ReviewStatus } from './personal-memory.ts';
import { MEMORY_POLICY_VERSION } from './personal-memory.ts';

/**
 * Storage for personal memory. Thin on purpose: every decision is made in
 * `personal-memory.ts`, so this file only reads and writes rows.
 *
 * Two invariants are enforced by the database as well as here: an approved row is only ever
 * written by an explicit approval, and a revoked row stays as a tombstone so "stopped using"
 * is distinguishable from "never existed".
 */

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export interface NewMemory {
  id: string;
  principalId: string;
  category: MemoryCategory;
  subject: string;
  statement: string;
  source: string;
  confidence?: number;
  privacyClass?: PrivacyClass;
  cloudEligible?: boolean;
}

interface Row {
  id: string; principal_id: string; category: string; subject: string; statement: string;
  source: string; confidence: number; privacy_class: string; cloud_eligible: boolean;
  review_status: string; recorded_at: string; last_verified_at: string | null;
  superseded_by: string | null; revoked_at: string | null;
}

const toRecord = (row: Row): MemoryRecord => ({
  id: row.id,
  principalId: row.principal_id,
  category: row.category as MemoryCategory,
  subject: row.subject,
  statement: row.statement,
  source: row.source,
  confidence: Number(row.confidence),
  privacyClass: row.privacy_class as PrivacyClass,
  cloudEligible: row.cloud_eligible,
  reviewStatus: row.review_status as ReviewStatus,
  recordedAt: row.recorded_at,
  ...(row.last_verified_at ? { lastVerifiedAt: row.last_verified_at } : {}),
  ...(row.superseded_by ? { supersededBy: row.superseded_by } : {}),
  ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
});

export class PersonalMemoryStore {
  constructor(private readonly sql: Sql) {}

  /** A candidate is pending and cloud-ineligible until a human says otherwise. */
  async propose(memory: NewMemory): Promise<string> {
    await this.sql`
      insert into experience.personal_memories
        (id, principal_id, category, subject, statement, source, confidence, privacy_class, cloud_eligible, review_status, policy_version)
      values (${memory.id}, ${memory.principalId}, ${memory.category}, ${memory.subject}, ${memory.statement},
              ${memory.source}, ${memory.confidence ?? 0.5}, ${memory.privacyClass ?? 'SENSITIVE'},
              ${memory.cloudEligible ?? false}, 'pending', ${MEMORY_POLICY_VERSION})
      on conflict (id) do nothing`;
    return memory.id;
  }

  /** Approval is the only route to a usable record, and it can lower the class, never raise it. */
  async approve(id: string, options: { privacyClass?: PrivacyClass; cloudEligible?: boolean } = {}): Promise<void> {
    await this.sql`
      update experience.personal_memories
         set review_status = 'approved',
             privacy_class = coalesce(${options.privacyClass ?? null}, privacy_class),
             cloud_eligible = coalesce(${options.cloudEligible ?? null}, cloud_eligible),
             last_verified_at = now()
       where id = ${id} and revoked_at is null`;
  }

  async reject(id: string): Promise<void> {
    await this.sql`update experience.personal_memories set review_status = 'rejected' where id = ${id} and revoked_at is null`;
  }

  /** Corrections supersede rather than overwrite: the old statement stays auditable. */
  async correct(previousId: string, replacement: NewMemory): Promise<string> {
    await this.propose(replacement);
    await this.sql`
      update experience.personal_memories
         set superseded_by = ${replacement.id}, revoked_at = now(), revoked_reason = 'superseded'
       where id = ${previousId}`;
    return replacement.id;
  }

  async revoke(id: string, reason: string): Promise<void> {
    await this.sql`update experience.personal_memories set revoked_at = now(), revoked_reason = ${reason} where id = ${id} and revoked_at is null`;
  }

  /** Everything selection may consider: approved, live and owned by this principal. */
  async loadForSelection(principalId: string): Promise<MemoryRecord[]> {
    const rows = await this.sql`
      select * from experience.personal_memories
       where principal_id = ${principalId} and review_status = 'approved' and revoked_at is null and superseded_by is null`;
    return (rows as Row[]).map(toRecord);
  }

  /** The owner's review queue — pending first, then what is currently approved. */
  async listForReview(principalId: string): Promise<MemoryRecord[]> {
    const rows = await this.sql`
      select * from experience.personal_memories
       where principal_id = ${principalId}
       order by (review_status = 'pending') desc, recorded_at desc`;
    return (rows as Row[]).map(toRecord);
  }

  async exportApproved(principalId: string): Promise<MemoryRecord[]> {
    const rows = await this.sql`
      select * from experience.personal_memories
       where principal_id = ${principalId} and review_status = 'approved' and revoked_at is null and superseded_by is null`;
    return (rows as Row[]).map(toRecord);
  }
}
