import type { Capability, Grant } from '@jarvis/contracts';
import web from '../../../../../capabilities/web/definition.ts';
import type { WebFetchPolicy } from './web-fetch.ts';

/**
 * capabilities.web is registered by default; JARVIS_ENABLE_WEB_FETCH=0 removes it.
 * The grant never proceeds without live operator approval. JARVIS_WEB_FETCH_ALLOWED_DOMAINS
 * (comma-separated hostnames) can only narrow it, via a domain-allow resource constraint.
 */
export function loadWebFetch(principalId: string, nodeId: string, env: Record<string, string | undefined> = process.env, issuedAt = new Date().toISOString()): { capabilities: Array<{ manifest: Capability; moduleUrl: string }>; bootstrapGrants: Grant[]; policy: Partial<WebFetchPolicy> } {
  if (env.JARVIS_ENABLE_WEB_FETCH === '0') return { capabilities: [], bootstrapGrants: [], policy: {} };
  const domains = (env.JARVIS_WEB_FETCH_ALLOWED_DOMAINS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const standingRead = ['1','true'].includes(env.JARVIS_WEB_READ_AUTO_APPROVE ?? '');
  if (domains.some(domain => !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))) throw new Error('JARVIS_WEB_FETCH_ALLOWED_DOMAINS must list plain hostnames');
  return {
    capabilities: [{ manifest: web.manifest, moduleUrl: new URL('../../../../../capabilities/web/definition.ts', import.meta.url).href }],
    bootstrapGrants: [{ id: `web-fetch:${principalId}:${nodeId}`, principalId, holder: { kind: 'principal', id: principalId }, scopes: ['web.fetch'], maxRiskWithoutLiveApproval: standingRead?'LOW':'AMBIENT', mayProceedWithoutLiveApproval: standingRead, issuedAt, version: standingRead?2:1, resourceConstraints: domains.length ? [{ kind: 'domain-allow', values: domains }] : [], nodeConstraints: [nodeId], timeWindows: [] }],
    policy: domains.length ? { allowedHosts: domains } : {},
  };
}
