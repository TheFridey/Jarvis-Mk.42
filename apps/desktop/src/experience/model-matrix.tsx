'use client';
import type { ModelNode, RouteObservation } from './cognition-router-policy.ts';
import type { DataLiveness } from './experience-phase-policy.ts';
import { sessionTotals, type SessionCognitionStats } from './session-cognition-stats.ts';

const UNAVAILABLE = 'UNAVAILABLE';
const num = (value: number | undefined, digits = 0) => value === undefined || !Number.isFinite(value) ? UNAVAILABLE : value.toLocaleString('en-GB', { maximumFractionDigits: digits });
const ms = (value: number | undefined) => value === undefined ? UNAVAILABLE : value >= 1000 ? `${(value / 1000).toFixed(2)} S` : `${Math.round(value)} MS`;

/** Persistent cognition summary plus the session-scoped ledger of observed runs. */
export function ModelMatrix({ nodes, route, stats, liveness, compact }: { nodes: ModelNode[]; route?: RouteObservation; stats: SessionCognitionStats; liveness: DataLiveness; compact: boolean }) {
  const totals = sessionTotals(stats);
  const name = (id?: string) => id ? nodes.find(node => node.modelId === id)?.displayName ?? id : undefined;
  const active = route?.current && liveness.current ? route : undefined;
  const since = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(stats.since));
  const models = Object.values(stats.models).sort((a, b) => b.requests - a.requests).slice(0, compact ? 3 : 6);
  const maxLatency = Math.max(1, ...models.map(model => model.latencySamples ? model.latencyTotalMs / model.latencySamples : 0));
  return <section className={`model-matrix${liveness.current ? '' : ' not-current'}`} aria-label="Model matrix">
    <header><span>COGNITION</span><small>{liveness.current ? (liveness.synthetic ? 'SYNTHETIC' : 'LIVE') : 'LAST OBSERVED'}</small></header>
    <dl className="matrix-now">
      <div><dt>ACTIVE MODEL</dt><dd className={active?.selectedModelId ? 'value' : 'none'}>{active ? name(active.selectedModelId)?.toUpperCase() ?? 'NOT YET SELECTED' : 'NONE'}</dd></div>
      <div><dt>INVOKED BY</dt><dd>{active ? active.agentId.replace('agents.', '').toUpperCase() : '—'}</dd></div>
      <div><dt>CONSIDERED</dt><dd>{active ? `${active.candidatesConsidered} CANDIDATE${active.candidatesConsidered === 1 ? '' : 'S'}` : '—'}</dd></div>
      <div><dt>FALLBACK</dt><dd className={active?.fallback ? 'degraded' : ''}>{active ? (active.fallback ? 'ENGAGED' : 'NO') : '—'}</dd></div>
    </dl>
    <div className="matrix-session" aria-label="Session model usage">
      <h3 suppressHydrationWarning>SESSION · SINCE {since} · RESETS ON RESTART</h3>
      {models.length === 0 ? <p className="signal">NO MODEL RUNS OBSERVED THIS SESSION</p> : <ol>
        {models.map(model => {
          const average = model.latencySamples ? model.latencyTotalMs / model.latencySamples : undefined;
          return <li key={model.modelId}>
            <span className="matrix-model">{(name(model.modelId) ?? model.modelId).toUpperCase()}</span>
            <span className="matrix-req">{model.requests}<small> REQ</small></span>
            <span className="matrix-lat" title="Average observed latency"><i style={{ width: average === undefined ? 0 : `${(average / maxLatency) * 100}%` }}/><small>{ms(average)}</small></span>
            {model.fallbacks || model.failed ? <span className="matrix-flags">{model.fallbacks ? `${model.fallbacks} FB` : ''}{model.fallbacks && model.failed ? ' · ' : ''}{model.failed ? `${model.failed} ERR` : ''}</span> : null}
          </li>;
        })}
      </ol>}
      <dl className="matrix-totals">
        <div><dt>REQUESTS</dt><dd>{totals.requests}</dd></div>
        <div><dt>TOKENS</dt><dd>{totals.requests === 0 ? '—' : num(totals.tokens)}{totals.tokensUnreported ? <small> +{totals.tokensUnreported} UNREPORTED</small> : null}</dd></div>
        <div><dt>AVG LATENCY</dt><dd>{totals.requests === 0 ? '—' : ms(totals.averageLatencyMs)}</dd></div>
        <div><dt>EST. COST</dt><dd>{totals.requests === 0 ? '—' : totals.costEstimate === undefined ? UNAVAILABLE : `${num(totals.costEstimate, 4)} UNITS`}</dd></div>
        <div><dt>FALLBACKS</dt><dd className={totals.fallbacks ? 'degraded' : ''}>{totals.fallbacks}</dd></div>
        <div><dt>ERRORS</dt><dd className={totals.failed ? 'degraded' : ''}>{totals.failed}</dd></div>
      </dl>
    </div>
  </section>;
}
