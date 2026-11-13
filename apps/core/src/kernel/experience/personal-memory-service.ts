import { PersonalMemoryStore, type NewMemory } from './personal-memory-store.ts';
import { MEMORY_POLICY_VERSION, type MemoryCategory, type MemoryRecord, type PrivacyClass } from './personal-memory.ts';

/**
 * The authoritative memory application service.
 *
 * Everything that touches personal memory goes through here: the CLI, the import path, and the
 * candidate created by an explicit "remember this" request. Nothing else writes approved rows,
 * and a model cannot reach this class at all — a proposal from a conversation is a candidate in
 * `pending`, never an approval.
 */

export const IMPORT_SCHEMA_VERSION = 1;
export const MAX_STATEMENT = 2000;
export const MAX_SUBJECT = 200;

const CATEGORIES: MemoryCategory[] = [
  'preference', 'communication', 'interest', 'skill', 'learning', 'family_priority',
  'ambition', 'business', 'project', 'history', 'decision', 'milestone', 'constraint',
];
const CLASSES: PrivacyClass[] = ['PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED'];

export interface ImportRecordInput {
  recordId?: string;
  category: string;
  subject: string;
  statement: string;
  source: string;
  sourceType?: string;
  confidence?: number;
  privacyClass?: string;
  cloudEligible?: boolean;
  reviewStatus?: string;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  rejected: { index: number; reason: string }[];
}

/** Imported text is untrusted data: bounds, whitelists, and no authority transfer. */
export function validateImportRecord(input: unknown, index: number): { ok: true; value: NewMemory } | { ok: false; reason: string } {
  const record = input as Partial<ImportRecordInput>;
  if (!record || typeof record !== 'object') return { ok: false, reason: `record ${index} is not an object` };
  const subject = String(record.subject ?? '').trim();
  const statement = String(record.statement ?? '').trim();
  if (!subject) return { ok: false, reason: `record ${index} has no subject` };
  if (!statement) return { ok: false, reason: `record ${index} has no statement` };
  if (subject.length > MAX_SUBJECT) return { ok: false, reason: `record ${index} subject too long` };
  if (statement.length > MAX_STATEMENT) return { ok: false, reason: `record ${index} statement too long` };
  if (!CATEGORIES.includes(record.category as MemoryCategory)) return { ok: false, reason: `record ${index} has an unknown category` };
  const privacyClass = (record.privacyClass ?? 'SENSITIVE').toUpperCase();
  if (!CLASSES.includes(privacyClass as PrivacyClass)) return { ok: false, reason: `record ${index} has an invalid classification` };
  const confidence = record.confidence === undefined ? 0.6 : Number(record.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { ok: false, reason: `record ${index} has an invalid confidence` };
  // A file cannot approve itself, and a file cannot grant cloud disclosure.
  return {
    ok: true,
    value: {
      id: String(record.recordId ?? `mem_${index}_${Date.now().toString(36)}`),
      principalId: '',
      category: record.category as MemoryCategory,
      subject,
      statement,
      source: String(record.source ?? 'import'),
      confidence,
      privacyClass: privacyClass as PrivacyClass,
      cloudEligible: false,
    },
  };
}

export class PersonalMemoryService {
  constructor(private readonly store: PersonalMemoryStore) {}

  async propose(principalId: string, memory: Omit<NewMemory, 'principalId'>): Promise<string> {
    return this.store.propose({ ...memory, principalId });
  }

  /** What an explicit "remember this" produces: a candidate, stated honestly as such. */
  async proposeFromConversation(principalId: string, statement: string, source = 'conversation-request'): Promise<string> {
    return this.store.propose({
      id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      principalId, category: 'preference', subject: 'Owner stated preference',
      statement: statement.slice(0, MAX_STATEMENT), source,
      confidence: 0.9, privacyClass: 'SENSITIVE', cloudEligible: false,
    });
  }

  async importPack(principalId: string, pack: unknown): Promise<ImportResult> {
    const parsed = pack as { schemaVersion?: number; records?: unknown[] };
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.records)) throw new Error('import must contain a records array');
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== IMPORT_SCHEMA_VERSION) {
      throw new Error(`unsupported import schema version ${String(parsed.schemaVersion)}`);
    }
    const result: ImportResult = { imported: 0, duplicates: 0, rejected: [] };
    for (const [index, entry] of parsed.records.entries()) {
      const validated = validateImportRecord(entry, index);
      if (!validated.ok) { result.rejected.push({ index, reason: validated.reason }); continue; }
      const record = { ...validated.value, principalId };
      const existing = (await this.store.listForReview(principalId)).some(
        held => held.subject.toLowerCase() === record.subject.toLowerCase() && held.statement === record.statement,
      );
      if (existing) { result.duplicates += 1; continue; }
      await this.store.propose(record);
      result.imported += 1;
    }
    return result;
  }

  async approve(principalId: string, id: string): Promise<void> {
    const record = await this.requireOwned(principalId, id);
    await this.store.approve(record.id);
  }

  /** Cloud disclosure is a separate, explicit grant on one record. */
  async grantCloud(principalId: string, id: string): Promise<void> {
    const record = await this.requireOwned(principalId, id);
    if (record.privacyClass === 'SENSITIVE' || record.privacyClass === 'RESTRICTED') {
      throw new Error('this record is classified above the cloud ceiling and cannot be granted');
    }
    await this.store.approve(record.id, { privacyClass: record.privacyClass, cloudEligible: true });
  }

  async revokeCloud(principalId: string, id: string): Promise<void> {
    await this.requireOwned(principalId, id);
    await this.store.setCloudEligible(id, false);
  }

  async reject(principalId: string, id: string): Promise<void> {
    await this.requireOwned(principalId, id);
    await this.store.reject(id);
  }

  async correct(principalId: string, id: string, replacement: { subject: string; statement: string; category?: MemoryCategory }): Promise<string> {
    const record = await this.requireOwned(principalId, id);
    return this.store.correct(id, {
      id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      principalId, category: replacement.category ?? record.category,
      subject: replacement.subject, statement: replacement.statement,
      source: 'owner-correction', confidence: 1, privacyClass: record.privacyClass, cloudEligible: record.cloudEligible,
    });
  }

  /** Revocation: stop using it anywhere. The statement is retained, and says so. */
  async revokeUse(principalId: string, id: string): Promise<void> {
    await this.requireOwned(principalId, id);
    await this.store.revoke(id, 'owner-revoked');
  }

  /** Deletion: the statement itself is removed. Audit keeps only the fact of deletion. */
  async deleteContent(principalId: string, id: string): Promise<void> {
    await this.requireOwned(principalId, id);
    await this.store.deleteContent(id);
  }

  async list(principalId: string): Promise<MemoryRecord[]> { return this.store.listForReview(principalId); }
  async active(principalId: string): Promise<MemoryRecord[]> { return this.store.loadForSelection(principalId); }
  async exportApproved(principalId: string): Promise<MemoryRecord[]> { return this.store.exportApproved(principalId); }

  get policyVersion(): number { return MEMORY_POLICY_VERSION; }

  private async requireOwned(principalId: string, id: string): Promise<MemoryRecord> {
    const record = (await this.store.listForReview(principalId)).find(held => held.id === id);
    if (!record) throw new Error(`no such memory for this principal: ${id}`);
    return record;
  }
}
