/**
 * PostgreSQL connection + Drizzle instance.
 *
 * One pool per process. The Kernel holds the DB credentials; no other process
 * connects to authoritative schemas (DATA_OWNERSHIP.md sec 3).
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';

export type Sql = postgres.Sql;

/**
 * postgres.js `sql.json()` expects a structural `JSONValue`; our contract
 * interfaces (no index signature) do not match it nominally even though they
 * are JSON-serialisable. This helper is the single sanctioned cast.
 */
export function jsonParam(v: unknown): Parameters<Sql['json']>[0] {
  return v as Parameters<Sql['json']>[0];
}
export type Db = ReturnType<typeof makeDb>;

export interface DbConfig {
  url: string;
  /** Max pool connections. */
  max?: number;
  /** Statement timeout in ms. */
  statementTimeoutMs?: number;
}

function makeDb(sql: Sql) {
  return drizzle(sql, { schema });
}

export interface PgHandle {
  sql: Sql;
  db: Db;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function createPg(config: DbConfig): PgHandle {
  const sql = postgres(config.url, {
    max: config.max ?? 20,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    onnotice: () => undefined,
    connection: {
      statement_timeout: config.statementTimeoutMs ?? 15_000,
      application_name: 'jarvis-core',
    },
  });

  return {
    sql,
    db: makeDb(sql),
    async ping() {
      try {
        await sql`select 1`;
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
