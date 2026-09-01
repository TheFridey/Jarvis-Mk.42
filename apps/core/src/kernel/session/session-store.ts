/**
 * PostgreSQL access for the Session Manager (session schema).
 */
import { type Sql, jsonParam } from '@jarvis/persistence';
import type { Session, SessionHandoff, SessionState, SessionType } from '@jarvis/contracts';

interface Row {
  id: string;
  type: string;
  principal_id: string;
  nodes: unknown;
  state: string;
  started_at: string;
  ended_at: string | null;
  last_activity_at: string;
  opened_by_correlation_id: string;
  parent_session_id: string | null;
  handoff: unknown;
  context_ref: string | null;
  version: number;
}

function toSession(r: Row): Session {
  return {
    id: r.id,
    type: r.type as SessionType,
    principalId: r.principal_id,
    nodes: (r.nodes as string[]) ?? [],
    state: r.state as SessionState,
    startedAt: r.started_at,
    ...(r.ended_at ? { endedAt: r.ended_at } : {}),
    lastActivityAt: r.last_activity_at,
    openedByCorrelationId: r.opened_by_correlation_id,
    ...(r.parent_session_id ? { parentSessionId: r.parent_session_id } : {}),
    ...(r.handoff ? { handoff: r.handoff as SessionHandoff } : {}),
    ...(r.context_ref ? { contextRef: r.context_ref } : {}),
    version: r.version,
  };
}

export class SessionStore {
  constructor(private readonly sql: Sql) {}

  async insert(s: Session): Promise<void> {
    await this.sql`
      insert into session.sessions
        (id, type, principal_id, nodes, state, started_at, last_activity_at,
         opened_by_correlation_id, parent_session_id, context_ref, version)
      values (${s.id}, ${s.type}, ${s.principalId}, ${this.sql.json(jsonParam(s.nodes))}, ${s.state},
              ${s.startedAt}, ${s.lastActivityAt}, ${s.openedByCorrelationId},
              ${s.parentSessionId ?? null}, ${s.contextRef ?? null}, ${s.version})`;
  }

  async get(id: string): Promise<Session | null> {
    const rows = await this.sql<Row[]>`select * from session.sessions where id = ${id} limit 1`;
    return rows[0] ? toSession(rows[0]) : null;
  }

  /** Lock the row and return its version (optimistic-concurrency gate). */
  async lockVersion(tx: Sql, id: string): Promise<number | null> {
    const rows = await tx<{ version: number }[]>`
      select version from session.sessions where id = ${id} for update`;
    return rows[0]?.version ?? null;
  }

  async applyTransition(
    tx: Sql,
    args: {
      id: string;
      state: SessionState;
      newVersion: number;
      endedAt?: string;
      handoff?: SessionHandoff | null;
      nodes?: string[];
      lastActivityAt: string;
    },
  ): Promise<void> {
    await tx`
      update session.sessions set
        state = ${args.state},
        version = ${args.newVersion},
        last_activity_at = ${args.lastActivityAt},
        ended_at = ${args.endedAt ?? null},
        handoff = ${args.handoff ? tx.json(jsonParam(args.handoff)) : null},
        nodes = coalesce(${args.nodes ? tx.json(jsonParam(args.nodes)) : null}, nodes)
      where id = ${args.id}`;
  }

  async touch(id: string, atIso: string): Promise<void> {
    await this.sql`update session.sessions set last_activity_at = ${atIso} where id = ${id}`;
  }

  async countActive(): Promise<{ total: number; byType: Record<string, number> }> {
    const rows = await this.sql<{ type: string; c: string }[]>`
      select type, count(*)::text as c from session.sessions
      where state <> 'ended' group by type`;
    const byType: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byType[r.type] = Number(r.c);
      total += Number(r.c);
    }
    return { total, byType };
  }

  async listActive(): Promise<Session[]> {
    const rows = await this.sql<Row[]>`
      select * from session.sessions where state <> 'ended' order by started_at desc`;
    return rows.map(toSession);
  }
}
