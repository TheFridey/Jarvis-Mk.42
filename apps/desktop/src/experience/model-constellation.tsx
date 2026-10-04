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

const EMPHASISED = new Set<ModelNode['route']>(['SELECTED', 'CANDIDATE', 'FAILED', 'FALLBACK', 'UNAVAILABLE']);
const side = (value: 'local' | 'cloud-ok') => value === 'local' ? 'LOCAL' : 'CLOUD';

/** The routing explanation travels with the route it explains, never with the Core. */
export function routeReason(node: ModelNode, route: RouteObservation | undefined): string | undefined {
  if (!route?.current) return undefined;
  if (node.modelId === route.selectedModelId) {
    if (route.fallback) return [route.fallbackReason ? `FALLBACK · ${route.fallbackReason.toUpperCase()}` : 'FALLBACK · REASON NOT REPORTED', route.localityShift ? `${side(route.localityShift.from)} → ${side(route.localityShift.to)}` : undefined].filter(Boolean).join(' · ');
    return route.selectionReason?.toUpperCase();
  }
  if (route.fallback && node.route === 'FAILED' && route.failedIds.includes(node.modelId)) return 'PRIMARY UNAVAILABLE';
  return undefined;
}

/** DOM half of the cognition router: labels and inspection pinned to GPU node positions. */
export function ModelConstellation({ nodes, layout, route, runs, liveness, phase, developer }: {
  nodes: ModelNode[]; layout: SpatialLayout; route?: RouteObservation; runs: OperatingModelRun[];
  liveness: DataLiveness; phase: ExperiencePhase; developer: boolean;
}) {
  const [inspect, setInspect] = useState<string>();
  useEffect(() => { if (inspect && !nodes.some(node => node.modelId === inspect && !node.departing)) setInspect(undefined); }, [inspect, nodes]);
  useEffect(() => {
    if (!inspect) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setInspect(undefined); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [inspect]);
  const inspected = nodes.findIndex(node => node.modelId === inspect);
  const present = nodes.filter(node => !node.departing);
  const hasCloud = present.some(node => node.locality === 'cloud-ok'), hasLocal = present.some(node => node.locality === 'local');
  return <section className={`model-constellation phase-${phase.toLowerCase()}${liveness.current ? '' : ' not-current'}`} aria-label="Model constellation">
    {nodes.length > 0 && (hasCloud || hasLocal) ? <div className="locality-label" style={{ left: layout.localityBoundary.outer.x + 8, top: layout.localityBoundary.outer.y }} aria-hidden="true">
      <span className={hasCloud ? '' : 'absent'}>CLOUD</span><i/><span className={hasLocal ? '' : 'absent'}>LOCAL</span>
    </div> : null}
    {nodes.map((node, i) => {
      const at = layout.models[i];
      if (!at) return null;
      const activity = ACTIVITY_LABEL[node.activity];
      const reason = routeReason(node, route);
      const emphasised = EMPHASISED.has(node.route) || node.viaFallback || Boolean(activity);
      if (node.departing) return <div key={node.modelId} className="model-node departing" style={{ left: at.x, top: at.y }} aria-hidden="true">
        <span className="model-glyph">{node.glyph}</span><span className="model-label"><strong>{node.displayName}</strong></span>
      </div>;
      return <button key={node.modelId} type="button"
        className={`model-node route-${node.route.toLowerCase()} activity-${node.activity}${node.viaFallback ? ' via-fallback' : ''}${inspect === node.modelId ? ' inspecting' : ''}${emphasised ? ' emphasised' : ''}`}
        style={{ left: at.x, top: at.y }} aria-expanded={inspect === node.modelId}
        aria-label={`${node.displayName}, ${locality(node)}, ${ROUTE_LABEL[node.route]}${activity ? `, ${activity}` : ''}${reason ? `, ${reason}` : ''}. Inspect model identity.`}
        onClick={() => setInspect(current => current === node.modelId ? undefined : node.modelId)}>
        <span className="model-glyph" aria-hidden="true">{node.glyph}</span>
        <span className="model-label">
          <strong>{node.displayName}</strong>
          <small>{[node.provider?.toUpperCase(), locality(node)].filter(Boolean).join(' · ')}</small>
          {emphasised ? <em>{ROUTE_LABEL[node.route]}{node.viaFallback ? ' · VIA FALLBACK' : ''}{activity ? ` · ${activity}` : ''}</em> : null}
          {reason ? <span className="model-reason">{reason}</span> : null}
        </span>
      </button>;
    })}
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
