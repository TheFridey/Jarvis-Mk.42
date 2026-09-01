import type { Sql } from '@jarvis/persistence';
import type { TxRunner } from '../kernel/event-fabric/event-manager.ts';

/** Wraps postgres.js `sql.begin` behind the TxRunner interface. */
export class PgTxRunner implements TxRunner {
  constructor(private readonly sql: Sql) {}
  begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    return this.sql.begin((tx) => fn(tx as unknown as Sql)) as Promise<T>;
  }
}
