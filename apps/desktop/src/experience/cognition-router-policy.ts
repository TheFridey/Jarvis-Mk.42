import type { ModelRouteCandidate } from '@jarvis/contracts';
import type { OperatingModelRun } from '@jarvis/scene';
import { confirmedInference } from './experience-phase-policy.ts';
import { modelRunState } from './model-observatory-policy.ts';

export type ModelNodeRoute = 'SELECTED' | 'CANDIDATE' | 'REJECTED' | 'FAILED' | 'FALLBACK' | 'UNAVAILABLE' | 'HISTORICAL';
export type ModelNodeActivity = 'inferring' | 'awaiting-first-token' | 'evaluating' | 'unconfirmed' | 'settled' | 'historical' | 'stale';

export interface ModelNode {
  modelId: string;
  displayName: string;
  glyph: string;
  provider?: string;
  locality?: 'local' | 'cloud-ok';
  route: ModelNodeRoute;
  activity: ModelNodeActivity;
  viaFallback: boolean;
  health?: ModelRouteCandidate['healthState'];
  circuit?: ModelRouteCandidate['circuitBreaker'];
  toolSupport?: boolean;
  visionSupport?: boolean;
  reasoningMode?: ModelRouteCandidate['reasoningMode'];
  contextLimitUnits?: number;
  contextUsedUnits?: number;
  /** Only when both used and limit are observed. */
  contextRatio?: number;
  reason?: string;
  requestId?: string;
  agentId?: string;
  lastSeenAt: string;
}

export interface RouteObservation {
  requestId: string;
  correlationId: string;
  agentId: string;
  taskClass?: string;
  privacyClass?: string;
  phase?: NonNullable<OperatingModelRun['routing']>['phase'];
  state: string;
  current: boolean;
  selectedModelId?: string;
  candidatesConsidered: number;
  failedIds: string[];
  fallback: boolean;
  fallbackReason?: string;
  selectionReason?: string;
  localityShift?: { from: 'local' | 'cloud-ok'; to: 'local' | 'cloud-ok' };
}

export interface CognitionRouterView { nodes: ModelNode[]; route?: RouteObservation; activeCount: number }

export function modelGlyph(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '··';
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words.slice(0, 3).map(word => /^\d/.test(word) ? word.slice(0, 2) : word[0]).join('').toUpperCase();
}

function candidateRoute(candidate: ModelRouteCandidate, run: OperatingModelRun): ModelNodeRoute {
  const selected = run.routing?.selectedModelId ?? run.modelId ?? undefined;
  if (candidate.modelId === selected) return 'SELECTED';
  if (candidate.state === 'FAILED') return 'FAILED';
  if (candidate.state === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (candidate.state === 'FALLBACK') return 'FALLBACK';
  return selected ? 'REJECTED' : 'CANDIDATE';
}

function selectedActivity(run: OperatingModelRun, current: boolean): ModelNodeActivity {
  if (!current) return 'stale';
  if (run.status !== 'running') return 'settled';
  if (run.activityConfirmed === false) return 'unconfirmed';
  if (confirmedInference(run)) return run.firstTokenAt || run.routing?.firstTokenAt ? 'inferring' : 'awaiting-first-token';
  return run.routing?.phase === 'CANDIDATE' ? 'evaluating' : 'settled';
}

export function isFallbackRun(run: OperatingModelRun): boolean {
  return run.routing?.phase === 'FALLBACK' || Boolean(run.routing?.fallbackReason && run.routing.candidates.some(candidate => candidate.state === 'FAILED' || candidate.state === 'UNAVAILABLE'));
}

/**
 * The model constellation from observed runs only. Providers and models appear
 * only when a run or routing observation names them; nothing is pre-seeded.
 */
export function cognitionRouterView(active: OperatingModelRun[], recent: OperatingModelRun[], current: boolean, limit = 9): CognitionRouterView {
  const nodes = new Map<string, ModelNode>();
  const add = (run: OperatingModelRun, isActive: boolean) => {
    const candidates = run.routing?.candidates ?? [];
    const used = run.usage?.contextUnits ?? run.contextUnits;
    for (const candidate of candidates) {
      if (nodes.has(candidate.modelId)) continue;
      const route = isActive && current ? candidateRoute(candidate, run) : 'HISTORICAL';
      const selected = candidateRoute(candidate, run) === 'SELECTED';
      const activity: ModelNodeActivity = !current ? 'stale' : !isActive ? 'historical' : selected ? selectedActivity(run, current) : run.routing?.phase === 'CANDIDATE' ? 'evaluating' : 'settled';
      nodes.set(candidate.modelId, {
        modelId: candidate.modelId, displayName: candidate.displayName, glyph: modelGlyph(candidate.displayName),
        provider: candidate.provider, locality: candidate.locality, route, activity,
        viaFallback: selected && isFallbackRun(run),
        health: candidate.healthState, circuit: candidate.circuitBreaker,
        toolSupport: candidate.toolSupport, visionSupport: candidate.visionSupport, reasoningMode: candidate.reasoningMode,
        contextLimitUnits: candidate.contextLimitUnits,
        ...(selected && used !== undefined ? { contextUsedUnits: used } : {}),
        ...(selected && used !== undefined && candidate.contextLimitUnits > 0 ? { contextRatio: Math.min(1, used / candidate.contextLimitUnits) } : {}),
        reason: candidate.reason, requestId: run.requestId, agentId: run.agentId,
        lastSeenAt: run.finishedAt ?? run.startedAt,
      });
    }
    const modelId = run.modelId ?? run.routing?.selectedModelId;
    if (modelId && !nodes.has(modelId)) {
      nodes.set(modelId, {
        modelId, displayName: modelId, glyph: modelGlyph(modelId),
        route: isActive && current ? 'SELECTED' : 'HISTORICAL',
        activity: isActive ? selectedActivity(run, current) : current ? 'historical' : 'stale',
        viaFallback: isFallbackRun(run), requestId: run.requestId, agentId: run.agentId,
        ...(used !== undefined ? { contextUsedUnits: used } : {}),
        lastSeenAt: run.finishedAt ?? run.startedAt,
      });
    }
  };
  active.forEach(run => add(run, true));
  [...recent].sort((a, b) => Date.parse(b.finishedAt ?? b.startedAt) - Date.parse(a.finishedAt ?? a.startedAt)).forEach(run => add(run, false));
  const lead = active[0] ?? recent[0];
  return { nodes: [...nodes.values()].slice(0, limit), activeCount: active.length, ...(lead ? { route: routeObservation(lead, current && active.includes(lead), current) } : {}) };
}

export function routeObservation(run: OperatingModelRun, isActive: boolean, live: boolean): RouteObservation {
  const routing = run.routing;
  const candidates = routing?.candidates ?? [];
  const selectedModelId = routing?.selectedModelId ?? run.modelId ?? undefined;
  const failed = candidates.filter(candidate => candidate.state === 'FAILED' || candidate.state === 'UNAVAILABLE');
  const selected = candidates.find(candidate => candidate.modelId === selectedModelId);
  const primary = failed[0];
  const fallback = isFallbackRun(run);
  return {
    requestId: run.requestId, correlationId: run.correlationId, agentId: run.agentId,
    ...(run.taskClass ?? routing?.taskClass ? { taskClass: run.taskClass ?? routing?.taskClass } : {}),
    ...(run.privacyClass ?? routing?.privacyClass ? { privacyClass: run.privacyClass ?? routing?.privacyClass } : {}),
    ...(routing?.phase ? { phase: routing.phase } : {}),
    state: modelRunState(run, live), current: isActive,
    ...(selectedModelId ? { selectedModelId } : {}),
    candidatesConsidered: candidates.length,
    failedIds: failed.map(candidate => candidate.modelId),
    fallback,
    ...(routing?.fallbackReason ? { fallbackReason: routing.fallbackReason } : {}),
    ...(routing?.selectionReason ? { selectionReason: routing.selectionReason } : {}),
    ...(fallback && primary && selected && primary.locality !== selected.locality ? { localityShift: { from: primary.locality, to: selected.locality } } : {}),
  };
}

const UNAVAILABLE = 'UNAVAILABLE';
const n = (value: number | undefined, suffix = '') => value === undefined || !Number.isFinite(value) ? UNAVAILABLE : `${value.toLocaleString('en-GB', { maximumFractionDigits: value < 10 ? 2 : 0 })}${suffix}`;

/** Compact identity projection. Cost stays in the contract's abstract cost units. */
export function modelIdentityRows(node: ModelNode, run: OperatingModelRun | undefined, developer: boolean): Array<[string, string]> {
  const usage = run?.usage;
  const cost = usage?.costEstimate ?? run?.costEstimate;
  const rows: Array<[string, string]> = [
    ['PROVIDER', node.provider?.toUpperCase() ?? UNAVAILABLE],
    ['LOCALITY', node.locality === 'local' ? 'LOCAL' : node.locality === 'cloud-ok' ? 'CLOUD' : UNAVAILABLE],
    ['ROLE', run?.agentId?.replace('agents.', '').toUpperCase() ?? UNAVAILABLE],
    ['TASK', (run?.taskClass ?? run?.routing?.taskClass)?.toUpperCase() ?? UNAVAILABLE],
    ['ROUTE', node.route + (node.viaFallback ? ' · VIA FALLBACK' : '')],
    ['SELECTED BECAUSE', node.route === 'SELECTED' ? run?.routing?.selectionReason ?? UNAVAILABLE : node.reason ?? UNAVAILABLE],
    ['LATENCY', n(usage?.latencyMs ?? run?.latencyMs, ' MS')],
    ['TOKENS IN / OUT', usage?.inputTokens === undefined && usage?.outputTokens === undefined ? UNAVAILABLE : `${n(usage?.inputTokens)} / ${n(usage?.outputTokens)}`],
    ['CACHED', n(usage?.cachedTokens)],
    ['TOKENS / S', n(usage?.tokensPerSecond)],
    ['CONTEXT', node.contextRatio !== undefined ? `${Math.round(node.contextRatio * 100)}% · ${n(node.contextUsedUnits)} / ${n(node.contextLimitUnits)} UNITS` : node.contextLimitUnits ? `LIMIT ${n(node.contextLimitUnits)} UNITS · USE ${UNAVAILABLE}` : UNAVAILABLE],
    ['EST. COST', cost === undefined ? UNAVAILABLE : `${cost.toFixed(5)} COST UNITS`],
    ['ACTUAL COST', usage?.actualCost === undefined ? UNAVAILABLE : `${usage.actualCost.toFixed(5)} COST UNITS`],
    ['TOOLS', node.toolSupport === undefined ? UNAVAILABLE : node.toolSupport ? 'SUPPORTED' : 'NONE'],
    ['VISION', node.visionSupport === undefined ? UNAVAILABLE : node.visionSupport ? 'SUPPORTED' : 'NONE'],
    ['REASONING', node.reasoningMode?.toUpperCase() ?? UNAVAILABLE],
    ['HEALTH / CIRCUIT', node.health ? `${node.health.toUpperCase()} / ${node.circuit?.toUpperCase() ?? UNAVAILABLE}` : UNAVAILABLE],
    ['PRIVACY', (run?.privacyClass ?? run?.routing?.privacyClass) ?? UNAVAILABLE],
  ];
  if (developer && run) rows.push(['CORRELATION', run.correlationId], ['REQUEST', run.requestId]);
  return rows;
}
