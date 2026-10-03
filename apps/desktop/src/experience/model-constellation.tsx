'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { OperatingModelRun } from '@jarvis/scene';
import { modelIdentityRows, type ModelNode, type RouteObservation } from './cognition-router-policy.ts';
import type { DataLiveness, ExperiencePhase } from './experience-phase-policy.ts';
import type { SpatialLayout } from './spatial-layout-policy.ts';

const ROUTE_LABEL: Record<ModelNode['route'], string> = { SELECTED: 'SELECTED', CANDIDATE: 'CANDIDATE', REJECTED: 'NOT SELECTED', FAILED: 'FAILED', FALLBACK: 'FALLBACK OPTION', UNAVAILABLE: 'UNAVAILABLE', HISTORICAL: 'RECENT' };
const ACTIVITY_LABEL: Record<ModelNode['activity'], string> = { inferring: 'INFERRING', 'awaiting-first-token': 'AWAITING FIRST TOKEN', evaluating: 'EVALUATING', unconfirmed: 'ACTIVITY UNCONFIRMED', settled: '', historical: '', stale: 'LAST OBSERVED' };
const locality = (node: ModelNode) => node.locality === 'local' ? 'LOCAL' : node.locality === 'cloud-ok' ? 'CLOUD' : 'LOCALITY UNAVAILABLE';

function routeAnnotation(route: RouteObservation | undefined, nodes: ModelNode[], phase: ExperiencePhase): { tone: string; title: string; lines: string[] } | undefined {
  if (!route?.current) return phase === 'THINKING' ? { tone: 'muted', title: 'AWAITING ROUTING OBSERVATION', lines: [] } : undefined;
  const name = (id?: string) => nodes.find(node => node.modelId === id)?.displayName.toUpperCase() ?? id?.toUpperCase() ?? 'UNAVAILABLE';
  if (route.fallback) return {
    tone: 'degraded', title: 'PRIMARY UNAVAILABLE · FALLBACK ROUTE ESTABLISHED',
    lines: [
      `${route.failedIds.map(name).join(', ') || 'PRIMARY'} → ${name(route.selectedModelId)}`,
      route.fallbackReason ? `REASON · ${route.fallbackReason.toUpperCase()}` : 'REASON · NOT REPORTED',
      ...(route.localityShift ? [`ROUTE SHIFT · ${route.localityShift.from === 'local' ? 'LOCAL' : 'CLOUD'} → ${route.localityShift.to === 'local' ? 'LOCAL' : 'CLOUD'}`] : []),
    ],
  };
  if (route.phase === 'CANDIDATE') return { tone: 'cognition', title: `ROUTING · ${route.candidatesConsidered} CANDIDATE${route.candidatesConsidered === 1 ? '' : 'S'}`, lines: [route.taskClass ? `TASK · ${route.taskClass.toUpperCase()}` : 'TASK · UNAVAILABLE', route.privacyClass ? `PRIVACY · ${route.privacyClass.toUpperCase()}` : 'PRIVACY · UNAVAILABLE'] };
  if (route.selectedModelId) return { tone: 'cognition', title: `ROUTED · ${name(route.selectedModelId)}`, lines: [route.selectionReason ? route.selectionReason.toUpperCase() : 'SELECTION REASON NOT REPORTED', `${route.candidatesConsidered} CONSIDERED · ${route.agentId.replace('agents.', '').toUpperCase()}`] };
  return undefined;
}

/** DOM half of the cognition router: labels and inspection pinned to GPU node positions. */
export function ModelConstellation({ nodes, layout, route, runs, liveness, phase, developer }: {
  nodes: ModelNode[]; layout: SpatialLayout; route?: RouteObservation; runs: OperatingModelRun[];
  liveness: DataLiveness; phase: ExperiencePhase; developer: boolean;
}) {
  const [inspect, setInspect] = useState<string>();
  useEffect(() => { if (inspect && !nodes.some(node => node.modelId === inspect)) setInspect(undefined); }, [inspect, nodes]);
  useEffect(() => {
    if (!inspect) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setInspect(undefined); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [inspect]);
  const annotation = routeAnnotation(route, nodes, phase);
  const inspected = nodes.findIndex(node => node.modelId === inspect);
  const hasCloud = nodes.some(node => node.locality === 'cloud-ok'), hasLocal = nodes.some(node => node.locality === 'local');
  return <section className={`model-constellation${liveness.current ? '' : ' not-current'}`} aria-label="Model constellation">
    {nodes.length > 0 && (hasCloud || hasLocal) ? <div className="locality-label" style={{ left: layout.localityBoundary.outer.x + 8, top: layout.localityBoundary.outer.y }} aria-hidden="true">
      <span className={hasCloud ? '' : 'absent'}>CLOUD</span><i/><span className={hasLocal ? '' : 'absent'}>LOCAL</span>
    </div> : null}
    {nodes.map((node, i) => {
      const at = layout.models[i];
      if (!at) return null;
      const activity = ACTIVITY_LABEL[node.activity];
      return <button key={node.modelId} type="button"
        className={`model-node route-${node.route.toLowerCase()} activity-${node.activity}${node.viaFallback ? ' via-fallback' : ''}${inspect === node.modelId ? ' inspecting' : ''}`}
        style={{ left: at.x, top: at.y }} aria-expanded={inspect === node.modelId}
        aria-label={`${node.displayName}, ${locality(node)}, ${ROUTE_LABEL[node.route]}${activity ? `, ${activity}` : ''}. Inspect model identity.`}
        onClick={() => setInspect(current => current === node.modelId ? undefined : node.modelId)}>
        <span className="model-glyph" aria-hidden="true">{node.glyph}</span>
        <span className="model-label">
          <strong>{node.displayName}</strong>
          <small>{[node.provider?.toUpperCase(), locality(node)].filter(Boolean).join(' · ')}</small>
          <em>{ROUTE_LABEL[node.route]}{node.viaFallback ? ' · VIA FALLBACK' : ''}{activity ? ` · ${activity}` : ''}</em>
        </span>
      </button>;
    })}
    {annotation ? <div className={`route-annotation tone-${annotation.tone}`} style={{ left: layout.core.x, top: layout.core.y - layout.coreRadius * 1.12 }} role="status">
      <strong>{annotation.title}</strong>{annotation.lines.map(line => <span key={line}>{line}</span>)}
    </div> : null}
    {inspected >= 0 && layout.models[inspected] ? <ModelIdentity node={nodes[inspected]!} run={runs.find(run => run.requestId === nodes[inspected]!.requestId)} developer={developer} at={layout.models[inspected]!} layout={layout} onClose={() => setInspect(undefined)}/> : null}
  </section>;
}

function ModelIdentity({ node, run, developer, at, layout, onClose }: { node: ModelNode; run?: OperatingModelRun; developer: boolean; at: { x: number; y: number }; layout: SpatialLayout; onClose: () => void }) {
  const rows = modelIdentityRows(node, run, developer);
  const width = 340;
  const left = Math.min(layout.width - width - 16, at.x + 32);
  const top = Math.max(64, Math.min(layout.height - 440, at.y - 40));
  return <aside className="model-identity" style={{ left, top, width }} aria-label={`${node.displayName} identity`}>
    <header><span className="model-glyph" aria-hidden="true">{node.glyph}</span><div><small>MODEL IDENTITY</small><strong>{node.displayName}</strong></div><button onClick={onClose} aria-label="Close model identity"><X size={14}/></button></header>
    {node.contextRatio !== undefined ? <div className="identity-context" role="meter" aria-label="Context window use" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(node.contextRatio * 100)}><i style={{ width: `${node.contextRatio * 100}%` }}/></div> : null}
    <dl>{rows.map(([name, value]) => <div key={name} className={value.startsWith('UNAVAILABLE') ? 'unavailable' : ''}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    {node.activity === 'stale' ? <p className="signal">Last observed values. Live state unavailable.</p> : null}
  </aside>;
}
