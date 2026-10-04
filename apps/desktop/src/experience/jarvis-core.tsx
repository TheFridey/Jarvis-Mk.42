'use client';
import type { JarvisOperatingPicture } from '@jarvis/scene';
import type { ModelNode, RouteObservation } from './cognition-router-policy.ts';
import { coreWord, formatAge, PHASE_LABEL, requestFlow, type DataLiveness, type ExperiencePhase } from './experience-phase-policy.ts';
import { RequestFlow } from './request-flow.tsx';
import type { SpatialLayout } from './spatial-layout-policy.ts';
import { REGION_LABEL, type HealthRegion, type RegionHealth } from './telemetry-instrument-policy.ts';
import { useNow } from './use-viewport.ts';

export function coreDetail(phase: ExperiencePhase, picture: JarvisOperatingPicture | undefined, liveness: DataLiveness, nodes: ModelNode[], route: RouteObservation | undefined, regions: Record<HealthRegion, RegionHealth>, now: number): string {
  const selected = nodes.find(node => node.modelId === route?.selectedModelId);
  const locality = selected?.locality === 'local' ? 'LOCAL' : selected?.locality === 'cloud-ok' ? 'CLOUD' : undefined;
  const capability = picture?.activeCapabilities?.[0];
  switch (phase) {
    case 'UNAVAILABLE': return 'NO AUTHORITATIVE STATE IS BEING SHOWN';
    case 'COMM_LOSS': return `${liveness.label} · LAST OBSERVED ${liveness.staleSince ? formatAge(now - liveness.staleSince) : 'TIME UNKNOWN'}`;
    case 'CRITICAL': return 'KERNEL HEALTH OFFLINE';
    case 'APPROVAL': return `AWAITING OPERATOR AUTHORISATION${picture?.pendingApprovals[0] ? ` · ${(picture.pendingApprovals[0].action ?? picture.pendingApprovals[0].summary).toUpperCase()}` : ''}`;
    case 'EXECUTING': case 'VERIFYING': return capability ? `${capability.action.toUpperCase()} · ${capability.state}` : 'NO CAPABILITY ACTIVITY OBSERVED';
    case 'ROUTING': return route?.candidatesConsidered ? `EVALUATING ${route.candidatesConsidered} CANDIDATE${route.candidatesConsidered === 1 ? '' : 'S'}` : 'ROUTE NOT YET OBSERVED';
    case 'MODEL_ACTIVE': return [selected?.displayName.toUpperCase() ?? route?.selectedModelId?.toUpperCase() ?? 'MODEL', locality, selected?.activity === 'awaiting-first-token' ? 'AWAITING FIRST TOKEN' : undefined].filter(Boolean).join(' · ');
    case 'FALLBACK': return `${selected?.displayName.toUpperCase() ?? 'FALLBACK MODEL'} · PRIMARY UNAVAILABLE`;
    case 'THINKING': return 'COGNITION IN PROGRESS · NO MODEL RUN OBSERVED YET';
    case 'DEGRADED': {
      const affected = (Object.keys(regions) as HealthRegion[]).filter(region => regions[region] === 'degraded' || regions[region] === 'offline');
      return affected.length ? affected.map(region => REGION_LABEL[region]).join(' · ') : 'SYSTEM HEALTH DEGRADED';
    }
    case 'ERROR': {
      const failed = picture?.capabilityActivity.find(effect => ['FAILED', 'ABORTED', 'VERIFICATION_FAILED', 'INTERRUPTED'].includes(effect.state));
      return failed ? `${failed.action.toUpperCase()} · ${failed.state}` : 'WORK FAULT REPORTED · CAUSE NOT IN PROJECTION';
    }
    case 'DORMANT': return `${picture?.systemMode ?? 'AMBIENT'} · STANDING BY`;
    default: return picture?.systemMode ?? '';
  }
}

/** States where the one line of truth must stay visible beside the state word. */
const VISIBLE_DETAIL = new Set<ExperiencePhase>(['UNAVAILABLE', 'COMM_LOSS', 'CRITICAL', 'ERROR', 'BLOCKED']);

/**
 * The Core speaks one word. The full truth line and the request lifecycle stay
 * in the accessible DOM; routing explanations live on the selected route.
 */
export function CoreReadout({ phase, picture, liveness, nodes, route, regions, layout, phrase }: {
  phase: ExperiencePhase; picture?: JarvisOperatingPicture; liveness: DataLiveness; nodes: ModelNode[]; route?: RouteObservation;
  regions: Record<HealthRegion, RegionHealth>; layout: SpatialLayout; phrase?: string;
}) {
  const now = useNow(phase === 'COMM_LOSS' ? 1000 : 10_000);
  const line = coreDetail(phase, picture, liveness, nodes, route, regions, now);
  const flow = requestFlow(liveness.current ? picture : undefined, phase);
  return <div className={`core-readout phase-${phase.toLowerCase()}`} style={{ left: layout.core.x, top: layout.core.y + layout.coreRadius * 1.02 }} role="status" aria-live="polite" aria-label={`JARVIS ${PHASE_LABEL[phase]}. ${line}`}>
    <strong key={phase}>{coreWord(phase, liveness)}</strong>
    {VISIBLE_DETAIL.has(phase) ? <span className="core-detail">{line}</span> : <span className="sr-only">{line}</span>}
    {liveness.current ? <RequestFlow flow={flow} hidden/> : null}
    {phrase && liveness.current ? <p className="sr-only">{phrase}</p> : null}
  </div>;
}
