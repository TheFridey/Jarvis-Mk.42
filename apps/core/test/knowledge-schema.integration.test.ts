import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPg, runMigrations, type PgHandle } from '@jarvis/persistence';
import { isDockerAvailable, startEphemeralPg, type EphemeralPg } from '@jarvis/testkit';

const migrationPath = (file: string) =>
  fileURLToPath(new URL(`../../../packages/persistence/src/migrations/${file}`, import.meta.url));

const dockerOk = await isDockerAvailable();

describe.skipIf(!dockerOk)('MK.46 knowledge schema (integration)', () => {
  let container: EphemeralPg;
  let pg: PgHandle;

  beforeAll(async () => {
    container = await startEphemeralPg();
    pg = createPg({ url: container.url });
    await runMigrations(pg.sql);
  }, 120_000);

  afterAll(async () => {
    await pg?.close().catch(() => undefined);
    await container?.stop().catch(() => undefined);
  });

  it('creates the atlas and mnemosyne schemas', async () => {
    const rows = await pg.sql<{ schema_name: string }[]>`
      select schema_name from information_schema.schemata
      where schema_name in ('atlas','mnemosyne')`;
    expect(rows.map((r) => r.schema_name).sort()).toEqual(['atlas', 'mnemosyne']);
  });

  it('creates every ATLAS table', async () => {
    const rows = await pg.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'atlas'`;
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'causal_hypotheses', 'conflicts', 'entities', 'entity_aliases',
      'entity_relationships', 'evidence', 'facts', 'facts_archive', 'observations',
    ]);
  });

  it('creates every MNEMOSYNE table', async () => {
    const rows = await pg.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'mnemosyne'`;
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'candidates', 'consolidation_runs', 'episodes', 'insights',
      'preferences', 'procedures', 'semantic',
    ]);
  });

  it('has the vector extension available', async () => {
    const rows = await pg.sql<{ extname: string }[]>`
      select extname from pg_extension where extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it('creates both per-schema roles', async () => {
    const rows = await pg.sql<{ rolname: string }[]>`
      select rolname from pg_roles where rolname in ('jarvis_atlas','jarvis_mnemosyne')`;
    expect(rows.map((r) => r.rolname).sort()).toEqual(['jarvis_atlas', 'jarvis_mnemosyne']);
  });

  it('grants jarvis_atlas on atlas but NOT on mnemosyne (boundary proof)', async () => {
    const canAtlas = await pg.sql<{ has: boolean }[]>`
      select has_schema_privilege('jarvis_atlas', 'atlas', 'usage') as has`;
    const canMnemosyne = await pg.sql<{ has: boolean }[]>`
      select has_schema_privilege('jarvis_atlas', 'mnemosyne', 'usage') as has`;
    expect(canAtlas[0]?.has).toBe(true);
    expect(canMnemosyne[0]?.has).toBe(false);
  });

  it('grants jarvis_mnemosyne on mnemosyne but NOT on atlas (boundary proof)', async () => {
    const canMnemosyne = await pg.sql<{ has: boolean }[]>`
      select has_schema_privilege('jarvis_mnemosyne', 'mnemosyne', 'usage') as has`;
    const canAtlas = await pg.sql<{ has: boolean }[]>`
      select has_schema_privilege('jarvis_mnemosyne', 'atlas', 'usage') as has`;
    expect(canMnemosyne[0]?.has).toBe(true);
    expect(canAtlas[0]?.has).toBe(false);
  });

  it('re-running migrations is a no-op (idempotent)', async () => {
    const result = await runMigrations(pg.sql);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toContain('0005_atlas.sql');
    expect(result.alreadyApplied).toContain('0006_mnemosyne.sql');
  });

  it('applying 0005 and 0006 SQL a second time does not throw (guard discipline)', async () => {
    for (const file of ['0005_atlas.sql', '0006_mnemosyne.sql']) {
      const text = await readFile(migrationPath(file), 'utf8');
      // first re-apply
      await expect(pg.sql.unsafe(text)).resolves.toBeDefined();
      // second re-apply — exercises `create ... if not exists` + guarded-role blocks
      await expect(pg.sql.unsafe(text)).resolves.toBeDefined();
    }
  });

  it('rejects an insight row with empty evidence (evidence chain mandatory)', async () => {
    await expect(
      pg.sql`insert into mnemosyne.insights
        (id, statement, significance, provenance, evidence, consolidation_run_id, principal_id)
        values ('01TEST', 'x', 0.9, '{}', '{}', '01RUN', 'p1')`,
    ).rejects.toThrow(/insights_evidence_nonempty_ck/);
  });

  it('rejects a fact row with confidence outside 0..1', async () => {
    // entity FK first
    await pg.sql`insert into atlas.entities (id, type, canonical_name, principal_id)
                 values ('01ENT', 'person', 'Test', 'p1') on conflict do nothing`;
    await expect(
      pg.sql`insert into atlas.facts
        (id, subject_entity_id, attribute, value, epistemic_status, provenance, confidence, principal_id)
        values ('01F', '01ENT', 'role', '"x"', 'asserted', '{}', 1.5, 'p1')`,
    ).rejects.toThrow(/facts_confidence_ck/);
  });

  it('rejects a fact row whose status is not active (facts_status_active_ck)', async () => {
    await pg.sql`insert into atlas.entities (id, type, canonical_name, principal_id)
                 values ('01ENT', 'person', 'Test', 'p1') on conflict do nothing`;
    await expect(
      pg.sql`insert into atlas.facts
        (id, subject_entity_id, attribute, value, epistemic_status, provenance, confidence, status, principal_id)
        values ('01FS', '01ENT', 'role', '"x"', 'asserted', '{}', 0.9, 'superseded', 'p1')`,
    ).rejects.toThrow(/facts_status_active_ck/);
  });

  it('jarvis_atlas has NO usage on projections (ADR-0020 boundary proof point 1)', async () => {
    const rows = await pg.sql<{ h: boolean }[]>`
      select has_schema_privilege('jarvis_atlas', 'projections', 'usage') as h`;
    expect(rows[0]?.h).toBe(false);
  });
});
