import { AsyncLocalStorage } from 'node:async_hooks';
import { DomainAccessError, type DomainScope } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';

const scopes = new AsyncLocalStorage<DomainScope>();
export const personalDomainId = (principalId: string) => `${principalId}:personal`;
export const systemDomainId = (principalId: string) => `${principalId}:system`;
export function currentDomainScope() { return scopes.getStore(); }
/** Internal Kernel operation; external requests go through DomainService.run. */
export function inDomainScope<T>(scope: DomainScope, run: () => T): T {
  return scopes.run(Object.freeze({ ...scope, readableDomainIds: [...scope.readableDomainIds] }), run);
}
export function domainFor(principalId: string): string {
  if (principalId === 'system') return systemDomainId(principalId);
  const scope = scopes.getStore();
  if (scope && scope.principalId !== principalId) throw new DomainAccessError('domain principal mismatch');
  return scope?.domainId ?? (principalId === 'system' ? systemDomainId(principalId) : personalDomainId(principalId));
}
/** Used by stores before ranking/limits, including id-only retrievals. */
export function domainReadSql(sql: Sql, alias: string) {
  if (!/^[a-z_]+$/.test(alias)) throw new Error('invalid internal SQL alias');
  const scope = currentDomainScope();
  if (!scope) return sql`true`;
  const row = sql.unsafe(`to_jsonb(${alias})`);
  return sql`identity.domain_can_read(${scope.principalId},${scope.domainId},${scope.readableDomainIds}::text[],${scope.purpose},${row})`;
}
export function readableDomains(principalId: string): string[] {
  const scope = scopes.getStore();
  domainFor(principalId);
  return scope?.readableDomainIds ?? [domainFor(principalId)];
}
export function assertDomainItem(principalId: string, domainId: string, privacyClass: string): boolean {
  const scope = scopes.getStore();
  if (!readableDomains(principalId).includes(domainId)) return false;
  return !scope || domainId === scope.domainId || ['PUBLIC', 'INTERNAL'].includes(privacyClass);
}

/** Fusion grants confer retrieval only, never mutation authority in the source domain. */
export function domainWriteSql(sql:Sql,alias:string){
  if(!/^[a-z_]+$/.test(alias))throw new Error('invalid internal SQL alias');
  const scope=currentDomainScope();if(!scope)return sql`true`;
  return sql`${sql.unsafe(alias+'.principal_id')}=${scope.principalId} and ${sql.unsafe(alias+'.domain_id')}=${scope.domainId}`;
}
