'use client';
import { useRef } from 'react';
import type { ForgeQuality, ForgeVisualPolicy } from './forge-visual-policy.ts';
import type { ForgeRendererMetrics } from './forge-cosmos.tsx';

/** Development-only renderer measurements. Not Kernel telemetry; absent in production. */
export function RendererOverlay({ metrics, policy, setting, hidden }: { metrics: ForgeRendererMetrics; policy: ForgeVisualPolicy; setting: ForgeQuality; hidden: boolean }) {
  const history = useRef<number[]>([]);
  history.current = [...history.current.slice(-31), metrics.frameTimeMs];
  const budget = 1000 / policy.maxFps;
  const max = Math.max(budget * 1.6, ...history.current);
  const points = history.current.map((value, i) => `${i * 4},${24 - (value / max) * 22}`).join(' ');
  return <aside className="renderer-overlay" aria-label="Renderer diagnostics (development)">
    <header><span>RENDERER</span><em>DEV · NOT TELEMETRY</em></header>
    <svg viewBox="0 0 124 26" aria-hidden="true"><line x1="0" x2="124" y1={24 - (budget / max) * 22} y2={24 - (budget / max) * 22} className="budget" /><polyline points={points} /></svg>
    <dl>
      <div><dt>FPS</dt><dd>{metrics.fps.toFixed(0)}<small>/{policy.maxFps}</small></dd></div>
      <div><dt>FRAME</dt><dd>{metrics.frameTimeMs.toFixed(1)}<small>MS</small></dd></div>
      <div><dt>CALLS</dt><dd>{metrics.drawCalls}</dd></div>
      <div><dt>TRIS</dt><dd>{metrics.triangles.toLocaleString('en-GB')}</dd></div>
      <div><dt>PARTICLES</dt><dd>{metrics.particleCount.toLocaleString('en-GB')}</dd></div>
      <div><dt>TIER</dt><dd>{metrics.quality}<small>{setting === 'AUTO' ? ' AUTO' : ''}</small></dd></div>
      <div><dt>BLOOM</dt><dd>{policy.bloom ? 'ON' : 'OFF'}</dd></div>
      <div><dt>STATE</dt><dd>{hidden ? 'HIDDEN' : policy.state}</dd></div>
    </dl>
  </aside>;
}
