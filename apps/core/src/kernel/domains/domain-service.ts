import { randomUUID } from 'node:crypto';
import { DomainAccessError, DomainKinds, type DomainInstance, type DomainKind, type DomainRequest, type DomainScope } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';
import { currentDomainScope, inDomainScope, personalDomainId, systemDomainId } from './scope.ts';

interface Row { id: string; principal_id: string; kind: DomainKind; name: string; status: 'active'|'archived'; version: number; }
const map = (r: Row): DomainInstance => ({ id: r.id, principalId: r.principal_id, kind: r.kind, name: r.name, status: r.status, version: r.version });
/** PostgreSQL is the sole authority. No model/agent can mint fusion authority. */
export class DomainService {
  constructor(private readonly sql: Sql) {}
  async ensure(principalId: string) {
    for (const [id, kind, name] of [[personalDomainId(principalId), 'PERSONAL', 'Personal'], [systemDomainId(principalId), 'SYSTEM', 'System / unclassified legacy']] as const) {
      await this.sql`insert into identity.domains(id,principal_id,kind,name) values(${id},${principalId},${kind},${name}) on conflict(id) do nothing`;
    }
  }
  async create(principalId: string, input: { id?: string; kind: DomainKind; name: string }) {
    if (!principalId || !DomainKinds.includes(input.kind) || !input.name?.trim() || input.name.length > 200) throw new DomainAccessError('invalid domain');
    const id = input.id ?? randomUUID();
    const [row] = await this.sql<Row[]>`insert into identity.domains(id,principal_id,kind,name) values(${id},${principalId},${input.kind},${input.name.trim()}) returning *`;
    return map(row!);
  }
  async get(principalId: string, id: string) {
    const [row] = await this.sql<Row[]>`select * from identity.domains where id=${id} and principal_id=${principalId} and status='active'`;
    if (!row) throw new DomainAccessError();
    return map(row);
  }
  async list(principalId: string) { await this.ensure(principalId); return (await this.sql<Row[]>`select * from identity.domains where principal_id=${principalId} order by kind,name`).map(map); }
  async selected(principalId: string, nodeId: string) {
    const [row] = await this.sql<{domain_id:string;version:number}[]>`select domain_id,version from identity.domain_selections where principal_id=${principalId} and node_id=${nodeId}`;
    return row ?? { domain_id: personalDomainId(principalId), version: 0 };
  }
  async switch(principalId: string, nodeId: string, domainId: string, expectedVersion: number) {
    await this.ensure(principalId); await this.get(principalId, domainId);
    return this.sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`domain:${principalId}:${nodeId}`},0))`;
      const [node] = await tx<{principal_id:string;trust_tier:string;node_type:string;status:string}[]>`select principal_id,trust_tier,node_type,status from nodes.registry where node_id=${nodeId}`;
      if (!node || node.principal_id !== principalId || ['revoked','isolated','disconnected'].includes(node.status) || ['mobile','display'].includes(node.node_type) || !['owned-secure','kernel-local'].includes(node.trust_tier)) throw new DomainAccessError('node cannot select a domain');
      const [old] = await tx<{version:number}[]>`select version from identity.domain_selections where principal_id=${principalId} and node_id=${nodeId}`;
      if ((old?.version ?? 0) !== expectedVersion) throw new DomainAccessError('stale domain selection');
      const [selection] = await tx<{domain_id:string;version:number}[]>`insert into identity.domain_selections(principal_id,node_id,domain_id,version) values(${principalId},${nodeId},${domainId},${expectedVersion+1}) on conflict(principal_id,node_id) do update set domain_id=excluded.domain_id,version=excluded.version returning domain_id,version`;
      return selection!;
    });
  }
  async resolve(principalId: string, req: DomainRequest = {}): Promise<DomainScope> {
    await this.ensure(principalId);
    if(req.nodeId){const [node]=await this.sql<{principal_id:string;status:string}[]>`select principal_id,status from nodes.registry where node_id=${req.nodeId}`;if(!node||node.principal_id!==principalId||['revoked','isolated','disconnected'].includes(node.status))throw new DomainAccessError('node domain ownership denied');}
    if((req.sourceDomainIds&&!Array.isArray(req.sourceDomainIds))||(req.fusionGrantIds&&!Array.isArray(req.fusionGrantIds))||(req.sourceDomainIds?.length??0)>32||(req.fusionGrantIds?.length??0)>32)throw new DomainAccessError('invalid domain sources');
    const selection = req.nodeId ? await this.selected(principalId, req.nodeId) : undefined;
    if (req.domainSelectionVersion !== undefined && (!selection || selection.version !== req.domainSelectionVersion)) throw new DomainAccessError('stale domain selection');
    const domain = await this.get(principalId, req.domainId ?? selection?.domain_id ?? personalDomainId(principalId));
    if (selection && req.domainSelectionVersion !== undefined && selection.domain_id !== domain.id) throw new DomainAccessError('selected domain changed');
    const purpose = req.domainPurpose ?? (domain.kind === 'FINANCIAL' ? 'financial' : 'general');
    if (!['general','research','coding','financial','system'].includes(purpose)) throw new DomainAccessError('invalid domain purpose');
    const readableDomainIds = [domain.id];
    for (const sourceId of new Set(req.sourceDomainIds ?? [])) {
      if (sourceId === domain.id) continue;
      await this.get(principalId, sourceId);
      const grants = await this.sql<{id:string}[]>`select id from identity.domain_fusion_grants where principal_id=${principalId} and source_domain_id=${sourceId} and target_domain_id=${domain.id} and purpose=${purpose} and id=any(${req.fusionGrantIds??[]}::text[]) and revoked_at is null and expires_at>clock_timestamp()`;
      if (!grants.length) throw new DomainAccessError('explicit cross-domain fusion grant required');
      readableDomainIds.push(sourceId);
    }
    return { principalId, domainId: domain.id, kind: domain.kind, domainName:domain.name, purpose, readableDomainIds, crossDomainPrivacyCeiling: 'INTERNAL', ...(selection ? { selectionVersion: selection.version, nodeId: req.nodeId } : {}) };
  }
  async run<T>(principalId: string, req: DomainRequest, correlationId: string, run: (scope: DomainScope) => Promise<T>): Promise<T> {
    const inherited = currentDomainScope();
    const scope = inherited && !req.domainId && !req.nodeId && !req.sourceDomainIds && !req.domainPurpose ? inherited : await this.resolve(principalId, req);
    if (scope.principalId !== principalId) throw new DomainAccessError('domain principal mismatch');
    await this.bind(scope, correlationId);
    return inDomainScope(scope, () => run(scope));
  }
  async bound(principalId: string, correlationId: string) {
    const [row] = await this.sql<{domain_id:string;purpose:DomainScope['purpose']}[]>`select domain_id,purpose from identity.domain_bindings where principal_id=${principalId} and correlation_id=${correlationId}`;
    return row ? { domainId: row.domain_id, domainPurpose: row.purpose } : {};
  }
  async bind(scope: DomainScope, correlationId: string) {
    const [row] = await this.sql<{domain_id:string;purpose:string}[]>`insert into identity.domain_bindings(principal_id,correlation_id,domain_id,purpose) values(${scope.principalId},${correlationId},${scope.domainId},${scope.purpose}) on conflict(principal_id,correlation_id) do update set correlation_id=excluded.correlation_id returning domain_id,purpose`;
    if (row?.domain_id !== scope.domainId || row.purpose !== scope.purpose) throw new DomainAccessError('correlation is bound to another domain or purpose');
  }
  async revokeFusionGrant(principalId:string,id:string){const rows=await this.sql`update identity.domain_fusion_grants set revoked_at=clock_timestamp() where principal_id=${principalId} and id=${id} returning id`;if(!rows.length)throw new DomainAccessError();}
  async fusionGrant(principalId: string, input: { sourceDomainId: string; targetDomainId: string; purpose: DomainScope['purpose']; expiresAt: string }) {
    await this.get(principalId, input.sourceDomainId); await this.get(principalId, input.targetDomainId);
    if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) throw new DomainAccessError('fusion grant must expire');
    const id = randomUUID();
    await this.sql`insert into identity.domain_fusion_grants(id,principal_id,source_domain_id,target_domain_id,purpose,expires_at) values(${id},${principalId},${input.sourceDomainId},${input.targetDomainId},${input.purpose},${input.expiresAt})`;
    return id;
  }
}
