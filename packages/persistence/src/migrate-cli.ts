/**
 * `pnpm db:migrate` - apply pending SQL migrations against $JARVIS_DB_URL
 * (or the dev default). Forward-only.
 */
import { createPg } from './client.ts';
import { runMigrations } from './migrator.ts';

const url =
  process.env.JARVIS_DB_URL ??
  'postgres://jarvis:jarvis@localhost:5433/jarvis';

const pg = createPg({ url });
try {
  const result = await runMigrations(pg.sql);
  if (result.applied.length === 0) {
    console.log(`No pending migrations (${result.alreadyApplied.length} already applied).`);
  } else {
    console.log(`Applied ${result.applied.length} migration(s):`);
    for (const m of result.applied) console.log(`  + ${m}`);
  }
} finally {
  await pg.close();
}
