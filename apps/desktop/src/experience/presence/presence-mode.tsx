'use client';
/**
 * SENTIENCE Presence Mode: the room, not the dashboard.
 *
 * Everything the operator can act on stays reachable — the instruction field,
 * the approvals surface (rendered by the parent so it is identical to the
 * command centre's barrier), the response, and the way back to the full
 * command centre. Everything else is removed: no model rail, no telemetry
 * strip, no panel grid, no lifecycle path. State is carried by the orb's motion
 * and one word; the sentence below it is the accessible truth line.
 */
import { useId, useState, type FormEvent } from 'react';
import { ArrowUpRight, CornerDownLeft, LayoutDashboard } from 'lucide-react';
import type { DataLiveness } from '../experience-phase-policy.ts';
import type { PresenceComposition, PresenceSatellite, PresenceState } from './presence-policy.ts';
import { presenceWord } from './presence-policy.ts';

export interface PresenceModeProps {
  phaseWord: string;
  detail: string;
  state: PresenceState;
  liveness: DataLiveness;
  composition: PresenceComposition;
  satellites: PresenceSatellite[];
  inputEnabled: boolean;
  reducedMotion: boolean;
  rendererFallback: boolean;
  answer?: string | undefined;
  onAsk: (text: string) => Promise<void> | void;
  onDismissAnswer: () => void;
  onCommandCentre: () => void;
}

export function PresenceMode(props: PresenceModeProps) {
  const { phaseWord, detail, state, liveness, composition, satellites, inputEnabled, reducedMotion, rendererFallback, answer } = props;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const { core, coreRadius } = composition.layout;
  const horizon = composition.horizon;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy || !inputEnabled) return;
    setBusy(true);
    try { await props.onAsk(value); setText(''); } finally { setBusy(false); }
  };

  return <div className={`presence-layer presence-${state.toLowerCase()}${reducedMotion ? ' reduced' : ''}`} data-presence-state={state}>
    <div className="presence-word-block" style={{ left: core.x, top: horizon }}>
      <div className="presence-word" role="status" aria-live="polite" aria-label={`JARVIS ${presenceWord(state, liveness)}. ${detail}`}>
        <strong key={phaseWord}>{phaseWord}</strong>
      </div>
      <p className="presence-detail">{detail}</p>
      {!liveness.current ? <button className="presence-reconnect" type="button" onClick={props.onCommandCentre}>OPEN COMMAND CENTRE · RECONNECT</button> : null}
      {rendererFallback ? <p className="presence-fallback" role="note">GPU environment unavailable · static rendering · state text is authoritative</p> : null}
    </div>

    {satellites.length ? <ul className="presence-satellites" aria-label="Active agent jobs" style={{ left: 0, top: 0 }}>
      {satellites.map(satellite => <li key={satellite.key}
        className={`presence-satellite state-${satellite.state.toLowerCase()}${satellite.animated ? ' live' : ''}${satellite.parentAgentId ? ' child' : ''}`}
        style={{ left: satellite.point.x, top: satellite.point.y, ['--satellite-angle' as string]: `${satellite.angle}deg` }}>
        <i aria-hidden="true" />
        <span>{satellite.name}</span>
        <small>{satellite.state}{satellite.jobCount > 1 ? ` · ${satellite.jobCount} JOBS` : ''}</small>
      </li>)}
    </ul> : null}

    <form className="presence-input" onSubmit={event => void submit(event)} role="search">
      <label className="sr-only" htmlFor={inputId}>Ask JARVIS</label>
      <input id={inputId} value={text} onChange={event => setText(event.target.value)} disabled={!inputEnabled || busy}
        placeholder={inputEnabled ? (coreRadius < 200 ? 'Ask JARVIS' : 'Speak plainly. Ask, or name the outcome you want.') : 'Commands unavailable until the Kernel reconnects'} autoComplete="off" spellCheck={false} />
      <button type="submit" disabled={!inputEnabled || busy || !text.trim()} aria-label="Send to JARVIS"><CornerDownLeft size={15} aria-hidden="true"/></button>
    </form>

    {answer ? <div className="presence-answer" role="status">
      <div><small>JARVIS</small><p>{answer}</p></div>
      <button type="button" onClick={props.onDismissAnswer} aria-label="Dismiss response">DISMISS</button>
    </div> : null}

    <div className="presence-return">
      <button type="button" onClick={props.onCommandCentre} title="Return to the command centre (C)">
        <LayoutDashboard size={14} aria-hidden="true"/><span>COMMAND CENTRE</span><kbd>C</kbd>
      </button>
      <span className={`presence-link link-${liveness.status}`} aria-label={`Connection ${liveness.status}`}><i aria-hidden="true"/>{liveness.label}</span>
    </div>

    <span className="presence-mark" aria-hidden="true"><ArrowUpRight size={12}/>SENTIENCE · PRESENCE</span>
  </div>;
}

export function presenceAriaSummary(phaseWord: string, detail: string): string {
  return `${phaseWord}. ${detail}`;
}
