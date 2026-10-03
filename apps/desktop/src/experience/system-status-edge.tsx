'use client';
import type { ReactNode } from 'react';
import { LayoutGrid, PanelLeft, RotateCw } from 'lucide-react';
import type { JarvisOperatingPicture } from '@jarvis/scene';
import { dataAgeMs, formatAge, type DataLiveness } from './experience-phase-policy.ts';
import { REGION_LABEL, type HealthRegion, type RegionHealth } from './telemetry-instrument-policy.ts';
import { useNow } from './use-viewport.ts';

const REGION_ORDER: HealthRegion[] = ['fabric', 'storage', 'cache', 'gateway', 'voice', 'perception'];

/** Top edge: identity, operating axes, localised health, link quality, time. */
export function SystemStatusEdge({ picture, liveness, regions, operations, inspector, onOperations, onInspector, onReconnect, sound }: {
  picture?: JarvisOperatingPicture; liveness: DataLiveness; regions: Record<HealthRegion, RegionHealth>;
  operations: boolean; inspector: boolean; onOperations: () => void; onInspector: () => void; onReconnect: () => void; sound: ReactNode;
}) {
  const now = useNow(1000);
  const age = dataAgeMs(picture?.generatedAt, now);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(now);
  const axes = liveness.current && picture
    ? [['MODE', picture.systemMode], ['INTERACTION', picture.interactionState], ['WORK', picture.workState]]
    : [['MODE', 'UNAVAILABLE'], ['INTERACTION', 'UNAVAILABLE'], ['WORK', 'UNAVAILABLE']];
  return <header className="status-edge">
    <div className="identity" aria-label="JARVIS Mark 42">
      <span className="sigil" aria-hidden="true"><i/><i/></span>
      <strong>JARVIS</strong><em>MK.42</em>
    </div>
    <dl className="axes" aria-label="Kernel operating axes">
      {axes.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
    </dl>
    <ul className="region-strip" aria-label="Subsystem health">
      {REGION_ORDER.map(region => <li key={region} className={`region-${regions[region]}`} title={`${REGION_LABEL[region]} · ${regions[region].toUpperCase()}`}>
        <i aria-hidden="true"/><span>{REGION_LABEL[region]}</span><b className="sr-only">{regions[region]}</b>
      </li>)}
    </ul>
    <div className="edge-actions">
      {sound}
      <button className={`link-state link-${liveness.status}`} onClick={onReconnect} title="Reconnect to Kernel">
        <i aria-hidden="true"/>
        <span>{liveness.label}</span>
        {liveness.current && liveness.synthetic ? null : <small>{liveness.current ? formatAge(age) : liveness.staleSince ? `LOST ${formatAge(now - liveness.staleSince)}` : 'NO DATA'}</small>}
        {!liveness.current ? <RotateCw size={12} aria-hidden="true"/> : null}
      </button>
      <button className={`edge-toggle${inspector ? ' active' : ''}`} aria-pressed={inspector} onClick={onInspector} title="Inspector"><PanelLeft size={14}/><span>INSPECT</span></button>
      <button className={`edge-toggle${operations ? ' active' : ''}`} aria-pressed={operations} onClick={onOperations} title="Operations view (O)"><LayoutGrid size={14}/><span>OPERATIONS</span></button>
      <time suppressHydrationWarning>{time}</time>
    </div>
  </header>;
}
