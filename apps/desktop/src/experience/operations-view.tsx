'use client';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { DesktopKernelSnapshot } from '@jarvis/scene';
import type { AgentNode } from './agent-field-policy.ts';
import type { ModelNode, RouteObservation } from './cognition-router-policy.ts';
import { dataAgeMs, formatAge, PHASE_LABEL, type DataLiveness, type ExperiencePhase } from './experience-phase-policy.ts';
import { ModelMatrix } from './model-matrix.tsx';
import type { SessionCognitionStats } from './session-cognition-stats.ts';
import { REGION_LABEL, type HealthRegion, type Instrument, type RegionHealth, type TelemetryGroup } from './telemetry-instrument-policy.ts';
import { TelemetryInstrument } from './telemetry-instrument.tsx';
import { useNow } from './use-viewport.ts';

const GROUPS: Array<{ title: string; groups: TelemetryGroup[] }> = [
  { title: 'COMPUTE', groups: ['compute', 'network'] },
  { title: 'FABRIC · STATE · CACHE', groups: ['fabric', 'storage', 'cache'] },
  { title: 'MODEL GATEWAY', groups: ['cognition'] },
  { title: 'AGENCY', groups: ['agency'] },
  { title: 'PERCEPTION', groups: ['perception'] },
];

function kernelRows(snapshot: DesktopKernelSnapshot | undefined, liveness: DataLiveness): Array<[string, string]> {
  const value = (fn: (s: DesktopKernelSnapshot) => string) => snapshot && liveness.current ? fn(snapshot) : snapshot ? 'STALE' : 'UNAVAILABLE';
  const dependency = (name: string) => value(s => s.diagnostics.dependencies.find(item => item.name === name)?.status ?? 'UNAVAILABLE');
  const vision = snapshot?.diagnostics.vision;
  const v = (fn: (diagnostics: NonNullable<typeof vision>) => string) => vision && liveness.current ? fn(vision) : vision ? 'STALE' : 'UNAVAILABLE';
  return [
    ['CONNECTION', liveness.label],
    ['STATE VERSION', value(s => String(s.stateVersion))],
    ['EVENT RATE', value(s => `${s.diagnostics.events.ratePerMinute}/MIN`)],
    ['EVENT FABRIC', value(s => s.diagnostics.eventFabric?.phase ?? 'UNAVAILABLE')],
    ['EVENT BUS', dependency('event-bus')], ['NATS', dependency('nats')], ['POSTGRES', dependency('postgres')], ['REDIS', dependency('redis')],
    ['MODEL GATEWAY', dependency('model-gateway')], ['RTC', dependency('rtc')],
    ['TRACE EXPORT', value(s => s.telemetrySummary.traceExport.toUpperCase())],
    ['SESSIONS', value(s => String(s.sessions.length))],
    ['CAPABILITY ACTIVITY', value(s => String(s.capabilityActivity.length))],
    ['POLICY DENIALS', value(s => String(s.policyDenials.length))],
    ['CAMERA', v(x => x.cameraLabel ?? x.cameraId ?? 'UNAVAILABLE')], ['CAMERA FPS', v(x => x.fps.toFixed(1))],
    ['HAND INFERENCE', v(x => `${x.inferenceLatencyMs.toFixed(1)} MS`)], ['AIR TOUCH', v(x => `${x.airTouchLatencyMs.toFixed(1)} MS`)],
    ['TRACK CONFIDENCE', v(x => `${Math.round(x.confidence * 100)}%`)], ['CURRENT TARGET', v(x => x.currentTarget ?? 'NONE')],
    ['DROPPED FRAMES', v(x => String(x.droppedFrames))], ['CALIBRATION', v(x => `${Math.round(x.calibrationQuality * 100)}%`)], ['VISION MODEL', v(x => x.model ?? 'UNAVAILABLE')],
  ];
}

/** Dense operations mode: every instrument, the matrix and the Kernel field at once. */
export function OperationsView({ instruments, picture, liveness, phase, regions, nodes, route, stats, agents, onClose }: {
  instruments: Instrument[]; picture?: DesktopKernelSnapshot; liveness: DataLiveness; phase: ExperiencePhase; regions: Record<HealthRegion, RegionHealth>;
  nodes: ModelNode[]; route?: RouteObservation; stats: SessionCognitionStats; agents: AgentNode[]; onClose: () => void;
}) {
  const now = useNow(1000);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  const rows = kernelRows(picture, liveness);
  const telemetryAge = dataAgeMs(picture?.telemetrySummary.system?.generatedAt, now);
  return <section className={`operations-view${liveness.current ? '' : ' not-current'}`} aria-label="Operations view" role="dialog" aria-modal="false">
    <header>
      <div><small>OPERATIONS</small><strong>{PHASE_LABEL[phase]}</strong></div>
      <ul className="ops-regions" aria-label="Subsystem health">{(Object.keys(regions) as HealthRegion[]).map(region => <li key={region} className={`region-${regions[region]}`}><i aria-hidden="true"/>{REGION_LABEL[region]}<b>{regions[region].toUpperCase()}</b></li>)}</ul>
      <span className="ops-age">{liveness.synthetic ? 'SYNTHETIC · ' : ''}TELEMETRY {picture?.telemetrySummary.system ? formatAge(telemetryAge) : 'UNAVAILABLE'}</span>
      <button onClick={onClose} aria-label="Close operations view"><X size={15}/></button>
    </header>
    <div className="ops-grid">
      {GROUPS.map(group => <article key={group.title} className="ops-panel">
        <h3>{group.title}</h3>
        <div className="instrument-stack">{instruments.filter(item => group.groups.includes(item.group)).map(item => <TelemetryInstrument key={item.key} instrument={item} sparkline/>)}</div>
      </article>)}
      <article className="ops-panel ops-cognition"><ModelMatrix nodes={nodes} {...(route ? { route } : {})} stats={stats} liveness={liveness} compact={false}/></article>
      <article className="ops-panel ops-agents">
        <h3>AGENT FIELD</h3>
        {agents.length === 0 ? <p className="signal">NO AGENT JOBS OBSERVED</p> : <ul>{agents.map(agent => <li key={agent.agentId} className={`state-${agent.state.toLowerCase()}`}><strong>{agent.name}</strong><span>{liveness.current ? agent.state : 'LAST OBSERVED'}</span><small>{agent.taskClass}{agent.modelId ? ` · ${agent.modelId}` : ''}</small></li>)}</ul>}
      </article>
      <article className="ops-panel ops-kernel">
        <h3>KERNEL FIELD</h3>
        <dl>{rows.map(([name, value]) => <div key={name} className={value === 'UNAVAILABLE' || value === 'STALE' ? 'unavailable' : value === 'HEALTHY' ? 'healthy' : ''}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      </article>
    </div>
  </section>;
}
