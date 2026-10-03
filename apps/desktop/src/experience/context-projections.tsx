'use client';
import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { DesktopKernelSnapshot } from '@jarvis/scene';
import { dataAgeMs, formatAge, type DataLiveness, type ExperiencePhase } from './experience-phase-policy.ts';
import type { SpatialLayout } from './spatial-layout-policy.ts';
import { useNow } from './use-viewport.ts';

const RECENT_ANSWER_MS = 120_000;
const truncate = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Conversation beside the Core: live caption while listening, else the latest recorded answer. */
export function ConversationProjection({ picture, liveness, layout, phase }: { picture?: DesktopKernelSnapshot; liveness: DataLiveness; layout: SpatialLayout; phase: ExperiencePhase }) {
  const now = useNow(5000);
  if (!picture || phase === 'APPROVAL') return null;
  const audio = picture.voiceAudio;
  const captionAge = dataAgeMs(audio?.observedAt, now);
  const caption = liveness.current && captionAge !== undefined && captionAge < 10_000 ? audio?.partialTranscript ?? audio?.finalTranscript : undefined;
  const latest = picture.cognitionResponses.at(-1);
  const answerAge = dataAgeMs(latest?.createdAt, now);
  const recent = latest?.answer && answerAge !== undefined && answerAge < RECENT_ANSWER_MS;
  if (!caption && !recent) return null;
  const style = { left: layout.conversation.x, top: layout.conversation.y, width: layout.conversationWidth };
  if (caption) return <output className={`conversation-projection caption${audio?.partialTranscript ? ' partial' : ''}`} style={style} aria-live="polite">
    <small>{audio?.partialTranscript ? 'HEARING' : 'HEARD'} · {liveness.synthetic ? 'SYNTHETIC' : 'OPERATOR'}</small>
    <p>{truncate(caption, 220)}</p>
  </output>;
  return <article className={`conversation-projection answer${liveness.current ? '' : ' not-current'}`} style={style} aria-label="Latest JARVIS answer">
    <small>JARVIS · {latest!.modelId} · {liveness.current ? formatAge(answerAge) : 'LAST OBSERVED'}</small>
    <p>{truncate(latest!.answer!, 280)}</p>
  </article>;
}

/** The active objective, anchored quietly under the status edge. */
export function ObjectiveAnchor({ picture, liveness }: { picture?: DesktopKernelSnapshot; liveness: DataLiveness }) {
  const objective = picture?.activeObjective;
  if (!objective) return null;
  return <div className={`objective-anchor${liveness.current ? '' : ' not-current'}`} aria-label="Active objective"><small>OBJECTIVE · {liveness.current ? objective.status.toUpperCase() : 'LAST OBSERVED'}</small><p>{truncate(objective.statement, 120)}</p></div>;
}

interface RibbonEvent { id: string; at: string; tone: 'cognition' | 'execution' | 'verified' | 'degraded' | 'infra'; text: string }
const FAILED_STATES = new Set(['FAILED', 'ABORTED', 'VERIFICATION_FAILED', 'INTERRUPTED', 'DENIED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'UNVERIFIED']);
const DONE_STATES = new Set(['VERIFIED', 'SUCCEEDED', 'COMPLETED', 'PARTIALLY_COMPLETED']);

export function ribbonEvents(picture: DesktopKernelSnapshot | undefined, limit = 6): RibbonEvent[] {
  if (!picture) return [];
  const events: RibbonEvent[] = [
    ...picture.capabilityActivity.map(effect => ({ id: `cap:${effect.invocationId}:${effect.state}`, at: effect.updatedAt, tone: FAILED_STATES.has(effect.state) ? 'degraded' as const : DONE_STATES.has(effect.state) ? 'verified' as const : 'execution' as const, text: `${effect.action.toUpperCase()} · ${effect.state}` })),
    ...picture.recentModelRuns.filter(run => run.finishedAt).map(run => ({ id: `run:${run.requestId}`, at: run.finishedAt!, tone: run.status === 'failed' ? 'degraded' as const : 'cognition' as const, text: `${(run.modelId ?? 'MODEL').toUpperCase()} · ${run.status === 'failed' ? 'FAILED' : 'COMPLETE'}` })),
    ...picture.policyDenials.map(denial => ({ id: `deny:${denial.invocationId}`, at: denial.at, tone: 'degraded' as const, text: `POLICY DENIED · ${denial.action.toUpperCase()}` })),
  ];
  return events.filter(event => Number.isFinite(Date.parse(event.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

/** Recent authoritative lifecycle events; older entries recede. */
export function ActivityRibbon({ picture, liveness }: { picture?: DesktopKernelSnapshot; liveness: DataLiveness }) {
  const now = useNow(5000);
  const events = ribbonEvents(picture);
  if (!events.length) return null;
  return <ol className={`activity-ribbon${liveness.current ? '' : ' not-current'}`} aria-label="Recent activity">
    {events.map((event, i) => <li key={event.id} className={`tone-${event.tone}`} style={{ opacity: 1 - i * .13 }}><i aria-hidden="true"/><span>{event.text}</span><small>{liveness.current ? formatAge(dataAgeMs(event.at, now)) : 'LAST OBSERVED'}</small></li>)}
  </ol>;
}

type InspectorTab = 'situation' | 'conversation' | 'execution' | 'agents' | 'business';
const TABS: Array<[InspectorTab, string]> = [['situation', 'SITUATION'], ['conversation', 'CONVERSATION'], ['execution', 'EXECUTION'], ['agents', 'AGENTS'], ['business', 'SCALESMITHS']];

/** Expandable inspector over the same Kernel projection; never a second state owner. */
export function SpatialInspector({ picture, liveness, agents, onClose, initialTab = 'situation' }: { picture?: DesktopKernelSnapshot; liveness: DataLiveness; agents: ReactNode; onClose: () => void; initialTab?: InspectorTab }) {
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  const live = liveness.current;
  const business = picture?.scalesmiths;
  return <aside className="spatial-inspector" aria-label="Operating picture inspector">
    <header>
      <div><small>OPERATING PICTURE</small><strong>{live ? (liveness.synthetic ? 'SYNTHETIC' : 'LIVE') : 'STALE / UNAVAILABLE'}</strong></div>
      <button onClick={onClose} aria-label="Close inspector"><X size={14}/></button>
    </header>
    <nav role="tablist" aria-label="Inspector sections">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <p className="signal">{picture ? `Kernel observation ${picture.generatedAt}` : 'Awaiting the authoritative Kernel projection.'}</p>
    <div className="inspector-body" role="tabpanel">
      {tab === 'situation' && <section aria-label="Objectives and notifications">
        <h3>Objective</h3><p>{picture?.activeObjective?.statement ?? 'No active objective observed'}</p>
        <h3>Alerts</h3><p className="signal">{live ? `${picture?.notifications.length ?? 0} active alert references` : 'Live alerts unavailable'}</p>
        {picture?.policyDenials.length ? <><h3>Policy denials</h3>{picture.policyDenials.slice(0, 6).map(denial => <article className="execution-record" key={denial.invocationId}><strong>{denial.action}</strong><span>DENIED</span><small>{denial.reason} · {denial.at}</small></article>)}</> : null}
      </section>}
      {tab === 'conversation' && <section aria-label="Conversation stream">{!picture?.cognitionResponses.length ? <p className="signal">No recorded answers in this projection</p> : [...picture.cognitionResponses].reverse().slice(0, 8).map(response => <article className="conversation-turn" key={response.requestId}><header><strong>JARVIS</strong><small>{response.modelId} · {response.createdAt}</small></header><p>{response.answer ?? 'Cognitive result recorded; no answer text'}</p><small>{response.correlationId} · {live ? 'RECORDED' : 'LAST OBSERVED'}</small></article>)}{picture?.cognitionResponseBodiesTruncated && <p className="signal">Response bodies are bounded in this projection.</p>}</section>}
      {tab === 'execution' && <section aria-label="Permissioned execution">{!picture?.capabilityActivity.length ? <p className="signal">No capability execution observed</p> : picture.capabilityActivity.slice(0, 10).map(effect => <article className="execution-record" key={effect.invocationId}><strong>{effect.action}</strong><span>{effect.state}</span><small>{effect.invocationId} · {effect.updatedAt}</small>{effect.finalOutcome && <p>{effect.finalOutcome}</p>}</article>)}<p className="signal">Only Kernel lifecycle states appear here. Cognitive completion does not certify effects.</p></section>}
      {tab === 'agents' && agents}
      {tab === 'business' && <section aria-label="ScaleSmiths business picture">{!business ? <p className="signal">Verified business sources unavailable</p> : Object.entries(business.readings).map(([key, reading]) => <div className="picture-reading" key={key}><strong>{key}</strong><span>{live && reading.status === 'available' ? formatReading(reading.value) : live ? reading.status.toUpperCase() : 'STALE'}</span><small>{reading.observedAt ?? 'Observation time unavailable'} · {reading.sourceRefs.length ? reading.sourceRefs.join(' · ') : 'Source unavailable'}</small></div>)}</section>}
    </div>
  </aside>;
}

function formatReading(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : 'Unavailable';
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return value == null ? 'Unavailable' : 'Verified records available';
}
