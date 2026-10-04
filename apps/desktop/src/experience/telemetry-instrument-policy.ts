import type { HealthStatus } from '@jarvis/contracts';
import type { JarvisOperatingPicture, SystemTelemetrySnapshot, TelemetryReading } from '@jarvis/scene';
import type { ExperiencePhase } from './experience-phase-policy.ts';

export type TelemetryGroup = 'compute' | 'cognition' | 'agency' | 'fabric' | 'storage' | 'cache' | 'network' | 'perception';
export type InstrumentKind = 'ratio' | 'count' | 'latency' | 'binary' | 'bytes' | 'rate' | 'cost';
export type InstrumentStatus = 'nominal' | 'elevated' | 'critical' | 'unavailable' | 'stale';
export type Trend = 'up' | 'down' | 'flat' | 'unknown';

interface InstrumentSpec { key: string; label: string; group: TelemetryGroup; kind: InstrumentKind; scale?: number; warn?: number; crit?: number; on?: string; off?: string }

/** Keys follow the Kernel SystemTelemetry projection; absent keys are unavailable. */
export const INSTRUMENTS: InstrumentSpec[] = [
  { key: 'cpu', label: 'CPU', group: 'compute', kind: 'ratio', scale: 100, warn: 75, crit: 92 },
  { key: 'ram', label: 'RAM', group: 'compute', kind: 'ratio', scale: 100, warn: 80, crit: 93 },
  { key: 'gpu', label: 'GPU', group: 'compute', kind: 'ratio', scale: 100, warn: 85, crit: 97 },
  { key: 'disk', label: 'DISK', group: 'compute', kind: 'ratio', scale: 100, warn: 85, crit: 95 },
  { key: 'network', label: 'NETWORK', group: 'network', kind: 'rate' },
  { key: 'tokens', label: 'TOKENS 24H', group: 'cognition', kind: 'count' },
  { key: 'latency', label: 'COMPLETION', group: 'cognition', kind: 'latency', scale: 15000, warn: 4000, crit: 12000 },
  { key: 'cost', label: 'EST. COST 24H', group: 'cognition', kind: 'cost' },
  { key: 'gateway', label: 'GATEWAY', group: 'cognition', kind: 'binary', on: 'HEALTHY', off: 'NO HEALTHY PROVIDER' },
  { key: 'gatewayLatency', label: 'PROVIDER LAT', group: 'cognition', kind: 'latency', scale: 10000, warn: 3000, crit: 8000 },
  { key: 'gatewayActive', label: 'IN FLIGHT', group: 'cognition', kind: 'count' },
  { key: 'gatewayCircuitOpen', label: 'OPEN CIRCUITS', group: 'cognition', kind: 'count', warn: 1, crit: 3 },
  { key: 'agents', label: 'AGENTS', group: 'agency', kind: 'count' },
  { key: 'queue', label: 'QUEUE', group: 'agency', kind: 'count', scale: 20, warn: 5, crit: 15 },
  { key: 'agentFailures', label: 'FAILURES 24H', group: 'agency', kind: 'count', warn: 1, crit: 5 },
  { key: 'natsStreamHealth', label: 'NATS', group: 'fabric', kind: 'binary', on: 'CONNECTED', off: 'DISABLED' },
  { key: 'natsPending', label: 'NATS PENDING', group: 'fabric', kind: 'count', warn: 1000, crit: 10000 },
  { key: 'postgres', label: 'POSTGRES', group: 'storage', kind: 'binary', on: 'CONNECTED', off: 'DOWN' },
  { key: 'postgresLatency', label: 'PG LATENCY', group: 'storage', kind: 'latency', scale: 300, warn: 50, crit: 250 },
  { key: 'postgresSaturation', label: 'PG CONNS', group: 'storage', kind: 'ratio', scale: 100, warn: 70, crit: 90 },
  { key: 'outbox', label: 'OUTBOX', group: 'storage', kind: 'count', warn: 100, crit: 1000 },
  { key: 'redis', label: 'REDIS', group: 'cache', kind: 'binary', on: 'CONNECTED', off: 'DOWN' },
  { key: 'redisLatency', label: 'REDIS LAT', group: 'cache', kind: 'latency', scale: 150, warn: 20, crit: 100 },
  { key: 'voice', label: 'VOICE', group: 'perception', kind: 'binary', on: 'READY', off: 'NOT READY' },
  { key: 'voiceLatency', label: 'VOICE LAT', group: 'perception', kind: 'latency', scale: 1000, warn: 250, crit: 700 },
  { key: 'vision', label: 'VISION', group: 'perception', kind: 'binary', on: 'READY', off: 'NOT READY' },
  { key: 'visionLatency', label: 'VISION LAT', group: 'perception', kind: 'latency', scale: 200, warn: 60, crit: 150 },
];

export interface Instrument {
  key: string; label: string; group: TelemetryGroup; kind: InstrumentKind; status: InstrumentStatus;
  value?: number; display: string; unit: string;
  /** 0..1 position on the instrument scale; undefined when unresolved. */
  ratio?: number; scale?: number; warn?: number; crit?: number;
  trend: Trend; ageMs?: number; history: Array<number | null>;
}

export const TELEMETRY_FRESH_MS = 30_000;
export function telemetryFresh(snapshot: SystemTelemetrySnapshot | undefined, current: boolean, now: number): boolean {
  if (!current || !snapshot) return false;
  const age = now - Date.parse(snapshot.generatedAt);
  return age < TELEMETRY_FRESH_MS && age >= -5000;
}

export function trendOf(history: Array<number | null>): Trend {
  const values = history.slice(-8).filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length < 3) return 'unknown';
  const half = Math.floor(values.length / 2);
  const before = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const after = values.slice(half).reduce((a, b) => a + b, 0) / (values.length - half);
  const span = Math.max(...values) - Math.min(...values);
  if (span === 0 || Math.abs(after - before) < span * .2) return 'flat';
  return after > before ? 'up' : 'down';
}

export function formatValue(value: number, kind: InstrumentKind, unit: string): string {
  const fmt = (v: number, digits = 1) => v.toLocaleString('en-GB', { maximumFractionDigits: digits });
  if (kind === 'ratio') return `${fmt(value, 0)}%`;
  if (kind === 'latency') return value >= 1000 ? `${fmt(value / 1000, 2)} S` : `${fmt(value, value < 10 ? 1 : 0)} MS`;
  if (kind === 'rate' || kind === 'bytes') {
    const units = kind === 'rate' ? ['B/S', 'KB/S', 'MB/S', 'GB/S'] : ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = value, i = 0; while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${fmt(v, v < 10 ? 1 : 0)} ${units[i]}`;
  }
  if (kind === 'cost') return `${fmt(value, 4)} ${unit.toUpperCase().includes('COST') ? 'UNITS' : unit.toUpperCase()}`;
  return value >= 100000 ? value.toLocaleString('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).toUpperCase() : fmt(value, 0);
}

function grade(spec: InstrumentSpec, value: number): InstrumentStatus {
  if (spec.kind === 'binary') return value >= 1 ? 'nominal' : 'critical';
  if (spec.crit !== undefined && value >= spec.crit) return 'critical';
  if (spec.warn !== undefined && value >= spec.warn) return 'elevated';
  return 'nominal';
}

export function interpretInstrument(spec: InstrumentSpec, snapshot: SystemTelemetrySnapshot | undefined, fresh: boolean, now: number): Instrument {
  const reading: TelemetryReading | undefined = snapshot?.readings[spec.key];
  const base = { key: spec.key, label: spec.label, group: spec.group, kind: spec.kind, unit: reading?.unit ?? '', ...(spec.scale !== undefined ? { scale: spec.scale } : {}), ...(spec.warn !== undefined ? { warn: spec.warn } : {}), ...(spec.crit !== undefined ? { crit: spec.crit } : {}) };
  const history = fresh && snapshot ? snapshot.history.map(sample => sample.values[spec.key] ?? null) : [];
  if (!fresh) return { ...base, status: snapshot ? 'stale' : 'unavailable', display: snapshot ? 'STALE' : 'UNAVAILABLE', trend: 'unknown', history: [] };
  if (!reading || reading.status === 'unavailable' || reading.value === null || !Number.isFinite(reading.value)) return { ...base, status: 'unavailable', display: 'UNAVAILABLE', trend: 'unknown', history };
  const ageMs = reading.observedAt ? Math.max(0, now - Date.parse(reading.observedAt)) : undefined;
  if (reading.status === 'stale') return { ...base, status: 'stale', display: 'STALE', trend: 'unknown', history, ...(ageMs !== undefined ? { ageMs } : {}) };
  const value = reading.value;
  const ratio = spec.kind === 'binary' ? (value >= 1 ? 1 : 0) : spec.scale ? Math.max(0, Math.min(1, value / spec.scale)) : undefined;
  return {
    ...base, status: grade(spec, value), value,
    display: spec.kind === 'binary' ? (value >= 1 ? spec.on! : spec.off!) : formatValue(value, spec.kind, reading.unit),
    ...(ratio !== undefined ? { ratio } : {}), trend: trendOf(history), history, ...(ageMs !== undefined ? { ageMs } : {}),
  };
}

export function interpretTelemetry(snapshot: SystemTelemetrySnapshot | undefined, current: boolean, now: number): Instrument[] {
  const fresh = telemetryFresh(snapshot, current, now);
  return INSTRUMENTS.map(spec => interpretInstrument(spec, snapshot, fresh, now));
}

const RELEVANCE: Partial<Record<ExperiencePhase, string[]>> = {
  LISTENING: ['voice', 'voiceLatency'], RESPONDING: ['voice'], INTERPRETING: ['voice', 'gateway'],
  THINKING: ['gateway', 'gpu', 'tokens', 'latency'], ROUTING: ['gateway', 'gatewayLatency', 'gatewayCircuitOpen', 'gpu'],
  MODEL_ACTIVE: ['gatewayLatency', 'gatewayActive', 'tokens', 'cost', 'gpu'], FALLBACK: ['gateway', 'gatewayCircuitOpen', 'gatewayLatency'],
  APPROVAL: ['agents', 'queue'], EXECUTING: ['agents', 'queue', 'postgresLatency', 'outbox'], VERIFYING: ['postgresLatency', 'outbox', 'agents'],
};

/** Compute instruments disclose themselves only when they are worth attention. */
const COMPUTE_KEYS = new Set(['cpu', 'ram', 'gpu', 'disk']);

/**
 * Auto-disclosed peripheral set. Healthy idle infrastructure shows nothing;
 * an elevated or critical compute reading discloses its own instrument; the
 * subsystem the current phase depends on expands while that phase lasts.
 * Region-bound instruments surface beside their region (see REGION_INSTRUMENTS).
 */
export function peripheralSelection(instruments: Instrument[], phase: ExperiencePhase, limit = 4): Instrument[] {
  const byKey = new Map(instruments.map(item => [item.key, item]));
  const keys = new Set<string>();
  const alarming = (item: Instrument) => item.status === 'critical' || item.status === 'elevated';
  instruments.filter(item => item.status === 'critical' && COMPUTE_KEYS.has(item.key)).forEach(item => keys.add(item.key));
  instruments.filter(item => item.status === 'elevated' && COMPUTE_KEYS.has(item.key)).forEach(item => keys.add(item.key));
  instruments.filter(item => alarming(item) && !COMPUTE_KEYS.has(item.key) && !REGION_BOUND.has(item.key)).forEach(item => keys.add(item.key));
  (RELEVANCE[phase] ?? []).forEach(key => { const item = byKey.get(key); if (item && item.status !== 'unavailable') keys.add(key); });
  return [...keys].map(key => byKey.get(key)).filter((item): item is Instrument => Boolean(item)).slice(0, limit);
}

export type RegionHealth = 'healthy' | 'degraded' | 'offline' | 'unknown';
export type HealthRegion = 'fabric' | 'storage' | 'cache' | 'gateway' | 'voice' | 'perception';
export const REGION_LABEL: Record<HealthRegion, string> = { fabric: 'EVENT FABRIC', storage: 'AUTHORITATIVE STATE', cache: 'CACHE', gateway: 'MODEL GATEWAY', voice: 'VOICE', perception: 'PERCEPTION' };
/** Instruments that belong to a region and surface beside it when that region degrades. */
export const REGION_INSTRUMENTS: Record<HealthRegion, string[]> = {
  fabric: ['natsStreamHealth', 'natsPending'], storage: ['postgres', 'postgresLatency', 'outbox'], cache: ['redis', 'redisLatency'],
  gateway: ['gateway', 'gatewayCircuitOpen', 'gatewayLatency'], voice: ['voice', 'voiceLatency'], perception: ['vision', 'visionLatency'],
};
const REGION_BOUND = new Set(Object.values(REGION_INSTRUMENTS).flat());
/** Spatial anchor for each region: gateway by the model field, fabric on the connective pathways, state under the Core. */
export const REGION_ANCHOR: Record<HealthRegion, 'gateway' | 'fabric' | 'state' | 'voice' | 'perception'> = { gateway: 'gateway', fabric: 'fabric', storage: 'state', cache: 'state', voice: 'voice', perception: 'perception' };

/** Regions that need attention, in a stable order. */
export function attentionRegions(regions: Record<HealthRegion, RegionHealth>): HealthRegion[] {
  return (['gateway', 'fabric', 'storage', 'cache', 'voice', 'perception'] as HealthRegion[]).filter(region => regions[region] === 'degraded' || regions[region] === 'offline');
}

const fromStatus = (status: HealthStatus | undefined, placeholder = false): RegionHealth => placeholder || !status ? 'unknown' : status === 'HEALTHY' ? 'healthy' : status === 'OFFLINE' ? 'offline' : 'degraded';

/** Localised health for spatial degradation. Missing diagnostics stay unknown. */
export function healthRegions(picture: JarvisOperatingPicture | undefined, current: boolean): Record<HealthRegion, RegionHealth> {
  const unknown: Record<HealthRegion, RegionHealth> = { fabric: 'unknown', storage: 'unknown', cache: 'unknown', gateway: 'unknown', voice: 'unknown', perception: 'unknown' };
  if (!picture || !current) return unknown;
  const dependency = (name: string) => picture.diagnostics?.dependencies?.find(item => item.name === name);
  const status = (name: string) => { const item = dependency(name); return fromStatus(item?.status, item?.placeholder); };
  const fabricPhase = picture.diagnostics?.eventFabric?.phase;
  const nats = status('nats');
  const fabric: RegionHealth = fabricPhase === 'SUSTAINED_OUTAGE' ? 'offline' : fabricPhase === 'RECONNECTING' || fabricPhase === 'RECOVERING' ? 'degraded' : nats !== 'unknown' ? nats : status('event-bus');
  const vision = picture.diagnostics?.vision?.status;
  return {
    fabric, storage: status('postgres'), cache: status('redis'), gateway: status('model-gateway'), voice: status('rtc'),
    perception: vision === 'ready' ? 'healthy' : vision === 'offline' ? 'offline' : vision ? 'degraded' : 'unknown',
  };
}
