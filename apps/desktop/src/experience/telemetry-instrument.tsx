'use client';
import { formatAge } from './experience-phase-policy.ts';
import type { Instrument } from './telemetry-instrument-policy.ts';

const TREND: Record<Instrument['trend'], string> = { up: '▲', down: '▼', flat: '—', unknown: '' };

/** Polished instrument bar: scale ticks, threshold zones, value marker, trend and age. */
export function TelemetryInstrument({ instrument, sparkline = false }: { instrument: Instrument; sparkline?: boolean }) {
  const { status, ratio, display, label } = instrument;
  const scale = instrument.scale;
  const warn = instrument.warn !== undefined && scale ? Math.min(1, instrument.warn / scale) : undefined;
  const crit = instrument.crit !== undefined && scale ? Math.min(1, instrument.crit / scale) : undefined;
  const resolved = status !== 'unavailable' && status !== 'stale';
  const scaled = scale !== undefined && instrument.kind !== 'binary';
  return <div className={`instrument status-${status} kind-${instrument.kind}`} role="group" aria-label={`${label} ${display}`}>
    <div className="instrument-head">
      <span className="instrument-label">{label}</span>
      <span className="instrument-value">{display}{resolved && TREND[instrument.trend] ? <i className={`trend trend-${instrument.trend}`} aria-label={`trend ${instrument.trend}`}>{TREND[instrument.trend]}</i> : null}</span>
    </div>
    {scaled ? <div className="instrument-bar" aria-hidden="true">
      {warn !== undefined ? <b className="zone-warn" style={{ left: `${warn * 100}%`, width: `${((crit ?? 1) - warn) * 100}%` }}/> : null}
      {crit !== undefined ? <b className="zone-crit" style={{ left: `${crit * 100}%`, width: `${(1 - crit) * 100}%` }}/> : null}
      {resolved && ratio !== undefined ? <><i className="fill" style={{ width: `${ratio * 100}%` }}/><em className="marker" style={{ left: `${ratio * 100}%` }}/></> : <i className="unresolved"/>}
    </div> : null}
    {sparkline ? <Sparkline values={instrument.history}/> : null}
    {status === 'stale' && instrument.ageMs !== undefined ? <small className="instrument-age">{formatAge(instrument.ageMs)}</small> : null}
  </div>;
}

/** Breaks at null samples so missing telemetry is never interpolated. */
export function Sparkline({ values }: { values: Array<number | null> }) {
  const points = values.slice(-40);
  const finite = points.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length < 2) return <svg className="sparkline empty" viewBox="0 0 100 16" aria-hidden="true"><line x1="0" x2="100" y1="15" y2="15"/></svg>;
  const min = Math.min(...finite), max = Math.max(...finite), span = max - min || 1;
  const step = 100 / Math.max(1, points.length - 1);
  let d = '', open = false;
  points.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) { open = false; return; }
    const x = (i * step).toFixed(1), y = (15 - ((value - min) / span) * 13).toFixed(1);
    d += `${open ? 'L' : 'M'}${x} ${y} `; open = true;
  });
  return <svg className="sparkline" viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><path d={d}/></svg>;
}
