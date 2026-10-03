'use client';
import type { DesktopKernelSnapshot } from '@jarvis/scene';

/** Read-only views of the same Kernel projection; never a second state owner. */
export function OperatingPicture({ picture, live }: { picture?: DesktopKernelSnapshot; live: boolean }) {
  const business = picture?.scalesmiths;
  return <details className="operating-picture"><summary>OPERATING PICTURE · {live ? 'LIVE' : 'STALE / UNAVAILABLE'}</summary>
    <p className="signal">{picture ? `Kernel observation ${picture.generatedAt}` : 'Awaiting the authoritative Kernel projection.'}</p>
    <section aria-label="Objectives and notifications"><h2>Situation</h2><p>{picture?.activeObjective?.statement ?? 'No active objective observed'}</p><p className="signal">{live ? `${picture?.notifications.length ?? 0} active alert references` : 'Live alerts unavailable'}</p></section>
    <section aria-label="ScaleSmiths business picture"><h2>ScaleSmiths</h2>{!business ? <p className="signal">Verified business sources unavailable</p> : Object.entries(business.readings).map(([key, reading]) => <div className="picture-reading" key={key}><strong>{key}</strong><span>{live && reading.status === 'available' ? formatValue(reading.value) : live ? reading.status.toUpperCase() : 'STALE'}</span><small>{reading.observedAt ?? 'Observation time unavailable'} · {reading.sourceRefs.length ? reading.sourceRefs.join(' · ') : 'Source unavailable'}</small></div>)}</section>
    <section aria-label="Conversation stream"><h2>Conversation</h2>{!picture?.cognitionResponses.length ? <p className="signal">No recorded answers in this projection</p> : [...picture.cognitionResponses].reverse().slice(-8).map(response => <article className="conversation-turn" key={response.requestId}><header><strong>JARVIS</strong><small>{response.modelId} · {response.createdAt}</small></header><p>{response.answer ?? 'Cognitive result recorded; no answer text'}</p><small>{response.correlationId} · {live ? 'RECORDED' : 'LAST OBSERVED'}</small></article>)}{picture?.cognitionResponseBodiesTruncated && <p className="signal">Response bodies are bounded in this projection.</p>}</section>
    <section aria-label="Permissioned execution"><h2>Execution</h2>{!picture?.capabilityActivity.length ? <p className="signal">No capability execution observed</p> : picture.capabilityActivity.slice(0, 8).map(effect => <article className="execution-record" key={effect.invocationId}><strong>{effect.action}</strong><span>{effect.state}</span><small>{effect.invocationId} · {effect.updatedAt}</small>{effect.finalOutcome && <p>{effect.finalOutcome}</p>}</article>)}<p className="signal">Only Kernel lifecycle states appear here. Cognitive completion does not certify effects.</p></section>
  </details>;
}
function formatValue(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : 'Unavailable';
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return value == null ? 'Unavailable' : 'Verified records available';
}
