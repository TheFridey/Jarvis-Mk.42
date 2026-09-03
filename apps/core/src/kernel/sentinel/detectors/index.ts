import type { SentinelThresholds } from '../thresholds.ts';
export interface SecuritySignal { type: string; time: string; actorId?: string; nodeId?: string; capabilityId?: string; action?: string; riskClass?: string; payload?: Record<string, unknown>; }
export interface Finding { detector: string; severity: 'low' | 'elevated' | 'high' | 'critical'; corroboration: number; evidence: string[]; nodeId?: string; }
export type Detector = (events: SecuritySignal[], cfg: SentinelThresholds, now: string) => Finding[];
const countBy = (events: SecuritySignal[], key: (event: SecuritySignal) => string | undefined) => { const map = new Map<string, SecuritySignal[]>(); for (const event of events) { const id = key(event); if (id) map.set(id, [...(map.get(id) ?? []), event]); } return map; };
const threshold = (id: string, severity: Finding['severity'], n: number, filter: (e: SecuritySignal) => boolean, key: (e: SecuritySignal) => string | undefined): Detector => (events) => [...countBy(events.filter(filter), key)].filter(([, rows]) => rows.length >= n).map(([subject, rows]) => ({ detector: id, severity, corroboration: rows.length, evidence: rows.map((e) => `${e.type}:${e.time}:${subject}`) }));
export const DETECTORS: Detector[] = [
  (e,c)=>threshold('auth.bruteforce','high',c.bruteforceN,x=>x.type.endsWith('auth_failed'),x=>x.actorId)(e,c,''),
  threshold('auth.unexpected-node','high',1,e=>e.type==='auth.unexpected-node',e=>e.nodeId),
  threshold('perm.escalation','high',1,e=>e.type==='permission.escalation',e=>e.actorId),
  (e,c)=>threshold('perm.denial-storm','elevated',c.denialN,x=>x.type.endsWith('invocation.denied'),x=>x.actorId)(e,c,''),
  (e,c)=>threshold('cap.rate-anomaly','elevated',c.rateN,x=>x.type.endsWith('invocation.proposed'),x=>`${x.capabilityId}:${x.action}`)(e,c,''),
  threshold('cap.first-critical','high',1,e=>e.riskClass==='CRITICAL'&&e.type.endsWith('invocation.proposed'),e=>e.actorId),
  threshold('cred.mint-anomaly','critical',1,e=>e.type.endsWith('credential.minted')&&e.payload?.matchingStarted===false,e=>String(e.payload?.invocationId)),
  threshold('integrity.cert-expiry','elevated',1,e=>e.type==='integrity.cert-expiry',e=>e.nodeId),
  threshold('integrity.backup-stale','high',1,e=>e.type==='integrity.backup-stale',()=> 'backup'),
  threshold('integrity.event-gap','critical',1,e=>e.type==='integrity.event-gap',e=>e.nodeId??'ledger'),
  threshold('proc.unexpected','high',1,e=>e.type==='telemetry.unexpected-process',e=>e.nodeId),
  threshold('dep.vuln','high',1,e=>e.type==='dependency.advisory',e=>String(e.payload?.package)),
];
