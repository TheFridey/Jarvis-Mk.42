/**
 * Minimal forward-only SQL migration runner.
 *
 * Reasons for a hand-rolled runner rather than drizzle-kit here: the `events`
 * table uses native declarative LIST partitioning, which drizzle-kit cannot
 * express. Migrations are plain `.sql` files applied in filename order and
 * tracked in `public._migrations`. No runtime schema mutation - migrations run
 * at deploy / test setup only (ADR-0003).
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Sql } from './client.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function runMigrations(sql: Sql, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  await sql`
    create table if not exists public._migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const done = new Set(
    (await sql<{ name: string }[]>`select name from public._migrations`).map((r) => r.name),
  );

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const file of files) {
    if (done.has(file)) {
      alreadyApplied.push(file);
      continue;
    }
    const contents = await readFile(path.join(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`insert into public._migrations (name) values (${file})`;
    });
    applied.push(file);
  }

  return { applied, alreadyApplied };
}
