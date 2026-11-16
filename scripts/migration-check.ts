/**
 * Proves migration 0021 against a real, isolated PostgreSQL instance: created, migrated with the
 * production migration runner, inspected, dropped. No owner database is touched.
 */
import { spawnSync } from 'node:child_process';
import { createPg } from '../packages/persistence/src/client.ts';

const name = `jarvis_mig_check_${Date.now().toString(36)}`;
const host = 'postgres://jarvis:jarvis@127.0.0.1:5433';
const admin = createPg({ url: `${host}/postgres` });
await admin.sql.unsafe(`create database ${name}`);
await admin.close();

const url = `${host}/${name}`;
const migrated = spawnSync(process.execPath, [`${process.cwd()}/node_modules/tsx/dist/cli.mjs`, 'src/migrate-cli.ts'], {
  cwd: 'packages/persistence', env: { ...process.env, JARVIS_DB_URL: url }, encoding: 'utf8',
});
process.stdout.write(`migrate exit ${migrated.status}\n`);
if (migrated.status !== 0) process.stdout.write(`${(migrated.stderr ?? '').slice(-400)}\n`);

const db = createPg({ url });
const column = await db.sql<{ column_name: string }[]>`select column_name from information_schema.columns where table_schema='experience' and table_name='conversation_turns' and column_name='memory_record_ids'`;
const turns = await db.sql<{ count: number }[]>`select count(*)::int as count from experience.conversation_turns`;
process.stdout.write(`0021 column present: ${column.length === 1}\n`);
process.stdout.write(`conversation_turns exists, rows: ${turns[0]?.count ?? 'n/a'}\n`);
await db.close();

const cleanup = createPg({ url: `${host}/postgres` });
await cleanup.sql.unsafe(`drop database ${name} with (force)`);
await cleanup.close();
process.stdout.write('isolated database dropped\n');
