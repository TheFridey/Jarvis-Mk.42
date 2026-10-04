'use client';
import type { SystemTelemetrySnapshot } from '@jarvis/scene';
import { dataAgeMs, formatAge, type DataLiveness, type ExperiencePhase } from './experience-phase-policy.ts';
import type { SpatialLayout } from './spatial-layout-policy.ts';
import { attentionRegions, peripheralSelection, REGION_ANCHOR, REGION_INSTRUMENTS, REGION_LABEL, type HealthRegion, type Instrument, type RegionHealth } from './telemetry-instrument-policy.ts';
import { TelemetryInstrument } from './telemetry-instrument.tsx';
import { useNow } from './use-viewport.ts';

/**
 * Peripheral instrumentation that discloses itself: healthy idle infrastructure
 * shows nothing, a pressured compute reading brings up its own instrument, and
 * the subsystem the current phase depends on expands only while it matters.
 */
export function PeripheralTelemetry({ instruments, snapshot, phase, liveness }: {
  instruments: Instrument[]; snapshot?: SystemTelemetrySnapshot; phase: ExperiencePhase; liveness: DataLiveness;
}) {
  const now = useNow(1000);
  const selection = peripheralSelection(instruments, phase, 3);
  if (!selection.length) return null;
  const fresh = instruments.some(item => item.status !== 'stale' && item.status !== 'unavailable');
  const stale = instruments.some(item => item.status === 'stale');
  const age = dataAgeMs(snapshot?.generatedAt, now);
  return <section className={`peripheral-telemetry${fresh ? '' : ' unresolved'}`} aria-label="System telemetry">
    <header>
      <span>SYSTEM</span>
      <small className={stale || !liveness.current ? 'stale' : ''}>{!snapshot ? 'TELEMETRY UNAVAILABLE' : stale || !fresh ? `STALE · ${formatAge(age)}` : liveness.synthetic ? 'SYNTHETIC' : formatAge(age)}</small>
    </header>
    <div className="instrument-stack">{selection.map(item => <TelemetryInstrument key={item.key} instrument={item}/>)}</div>
  </section>;
}

/** Localised degradation, surfaced beside the geometry it affects; never a global tint. */
export function RegionHealthProjections({ instruments, regions, layout }: { instruments: Instrument[]; regions: Record<HealthRegion, RegionHealth>; layout: SpatialLayout }) {
  const alerts = attentionRegions(regions);
  if (!alerts.length) return null;
  const byKey = new Map(instruments.map(item => [item.key, item]));
  const anchors = new Map<string, HealthRegion[]>();
  alerts.forEach(region => anchors.set(REGION_ANCHOR[region], [...(anchors.get(REGION_ANCHOR[region]) ?? []), region]));
  return <div className="region-health" role="status" aria-label="Localised subsystem degradation">
    {[...anchors.entries()].map(([anchor, list]) => {
      const at = layout.regions[anchor as keyof SpatialLayout['regions']];
      return <div key={anchor} className={`region-anchor anchor-${anchor} align-${at.align}`} style={{ left: at.x, top: at.y }}>
        {list.map(region => <article key={region} className={`alert-${regions[region]}`}>
          <header><i aria-hidden="true"/><strong>{REGION_LABEL[region]}</strong><span>{regions[region] === 'offline' ? 'OFFLINE' : 'DEGRADED'}</span></header>
          <div className="instrument-stack">{REGION_INSTRUMENTS[region].map(key => byKey.get(key)).filter((item): item is Instrument => Boolean(item)).map(item => <TelemetryInstrument key={item.key} instrument={item}/>)}</div>
        </article>)}
      </div>;
    })}
  </div>;
}
