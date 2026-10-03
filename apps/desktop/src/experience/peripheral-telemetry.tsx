'use client';
import type { SystemTelemetrySnapshot } from '@jarvis/scene';
import { dataAgeMs, formatAge, isIdlePhase, type DataLiveness, type ExperiencePhase } from './experience-phase-policy.ts';
import { peripheralSelection, REGION_LABEL, type HealthRegion, type Instrument, type RegionHealth } from './telemetry-instrument-policy.ts';
import { TelemetryInstrument } from './telemetry-instrument.tsx';
import { useNow } from './use-viewport.ts';

const REGION_KEYS: Record<HealthRegion, string[]> = {
  fabric: ['natsStreamHealth', 'natsPending'], storage: ['postgres', 'postgresLatency', 'outbox'], cache: ['redis', 'redisLatency'],
  gateway: ['gateway', 'gatewayCircuitOpen', 'gatewayLatency'], voice: ['voice', 'voiceLatency'], perception: ['vision', 'visionLatency'],
};

/**
 * Peripheral instrumentation: idle keeps two quiet gauges; the subsystem the
 * current phase depends on expands; localised degradation surfaces on its own.
 */
export function PeripheralTelemetry({ instruments, snapshot, phase, regions, liveness }: {
  instruments: Instrument[]; snapshot?: SystemTelemetrySnapshot; phase: ExperiencePhase; regions: Record<HealthRegion, RegionHealth>; liveness: DataLiveness;
}) {
  const now = useNow(1000);
  const idle = isIdlePhase(phase);
  const selection = peripheralSelection(instruments, phase, idle ? 2 : 6);
  const fresh = instruments.some(item => item.status !== 'stale' && item.status !== 'unavailable');
  const stale = instruments.some(item => item.status === 'stale');
  const age = dataAgeMs(snapshot?.generatedAt, now);
  const byKey = new Map(instruments.map(item => [item.key, item]));
  const alerts = (Object.keys(regions) as HealthRegion[]).filter(region => regions[region] === 'degraded' || regions[region] === 'offline');
  return <>
    <section className={`peripheral-telemetry${idle ? ' idle' : ''}${fresh ? '' : ' unresolved'}`} aria-label="System telemetry">
      <header>
        <span>SYSTEM</span>
        <small className={stale || !liveness.current ? 'stale' : ''}>{!snapshot ? 'TELEMETRY UNAVAILABLE' : stale || !fresh ? `STALE · ${formatAge(age)}` : liveness.synthetic ? 'SYNTHETIC' : formatAge(age)}</small>
      </header>
      <div className="instrument-stack">{selection.map(item => <TelemetryInstrument key={item.key} instrument={item}/>)}</div>
    </section>
    {alerts.length ? <section className="health-alerts" aria-label="Localised subsystem degradation" role="status">
      {alerts.map(region => <article key={region} className={`alert-${regions[region]}`}>
        <header><i aria-hidden="true"/><strong>{REGION_LABEL[region]}</strong><span>{regions[region] === 'offline' ? 'OFFLINE' : 'DEGRADED'}</span></header>
        <div className="instrument-stack">{REGION_KEYS[region].map(key => byKey.get(key)).filter((item): item is Instrument => Boolean(item)).map(item => <TelemetryInstrument key={item.key} instrument={item}/>)}</div>
      </article>)}
    </section> : null}
  </>;
}
