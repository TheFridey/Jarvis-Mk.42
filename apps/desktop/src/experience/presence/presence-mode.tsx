'use client';
/**
 * SENTIENCE Presence Mode: the room, not the dashboard.
 *
 * Everything the operator can act on stays reachable — the instruction field,
 * the microphone control, the approvals surface (rendered by the parent so it is
 * identical to the command centre's barrier), the response, and the way back to
 * the full command centre. Everything else is removed: no model rail, no
 * telemetry strip, no panel grid, no lifecycle path.
 *
 * Layout is a single vertical stack whose boundaries come from
 * `presenceZones()`: orb → word → detail → response → input → footer. The
 * response grows upward into the space that is left and scrolls beyond it, so it
 * can never cover the word, the input or the orb.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, ChevronsDown, ChevronsUp, CornerDownLeft, LayoutDashboard, X } from 'lucide-react';
import type { DataLiveness } from '../experience-phase-policy.ts';
import type { PresenceComposition, PresenceReadout, PresenceSatellite, PresenceZones } from './presence-policy.ts';

export interface PresenceModeProps {
  readout: PresenceReadout;
  liveness: DataLiveness;
  composition: PresenceComposition;
  zones: PresenceZones;
  satellites: PresenceSatellite[];
  inputEnabled: boolean;
  reducedMotion: boolean;
  rendererFallback: boolean;
  answer?: string | undefined;
  /** Composed by the parent so the trusted RTC session lives in one place. */
  voiceControl?: ReactNode;
  onAsk: (text: string) => Promise<void> | void;
  onDismissAnswer: () => void;
  onCommandCentre: () => void;
}

export function PresenceMode(props: PresenceModeProps) {
  const { readout, liveness, composition, zones, satellites, inputEnabled, reducedMotion, rendererFallback, answer } = props;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const inputId = useId();
  const layer = useRef<HTMLDivElement>(null);
  const { core, coreRadius } = composition.layout;

  useEffect(() => { if (!answer) setExpanded(false); }, [answer]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (expanded) { setExpanded(false); return; }
      if (answer) props.onDismissAnswer();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [answer, expanded, props]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy || !inputEnabled) return;
    setBusy(true);
    try { await props.onAsk(value); setText(''); } finally { setBusy(false); }
  };

  return <div ref={layer} className={`presence-layer presence-${readout.state.toLowerCase()}${reducedMotion ? ' reduced' : ''}${answer ? ' has-answer' : ''}${expanded ? ' answer-expanded' : ''}`}
    data-presence-state={readout.state} style={{ ['--presence-horizon' as string]: `${zones.horizon}px`, ['--presence-answer-max' as string]: `${zones.answerMaxHeight}px` }}>

    <div className="presence-word-block" style={{ left: core.x, top: zones.horizon }}>
      <div className="presence-word" role="status" aria-live="polite" aria-label={`JARVIS ${readout.word}. ${readout.detail}`}>
        <strong key={readout.word}>{readout.word}</strong>
      </div>
      <p className="presence-detail">{readout.detail}</p>
      {!liveness.current ? <button className="presence-reconnect" type="button" onClick={props.onCommandCentre}>OPEN COMMAND CENTRE · RECONNECT</button> : null}
      {rendererFallback ? <p className="presence-fallback" role="note">GPU environment unavailable · static rendering · state text is authoritative</p> : null}
    </div>

    {satellites.length ? <ul className="presence-satellites" aria-label={`Active agent jobs: ${satellites.length}`}>
      {satellites.map(satellite => <li key={satellite.key}
        className={`presence-satellite state-${satellite.state.toLowerCase()}${satellite.animated ? ' live' : ''}${satellite.parentAgentId ? ' child' : ''}`}
        style={{ left: satellite.point.x, top: satellite.point.y }}>
        <i className="presence-orb" aria-hidden="true"><b/><b/></i>
        <span className="presence-satellite-name">{satellite.name}</span>
        <small>{satellite.state}{satellite.jobCount > 1 ? ` · ${satellite.jobCount} JOBS` : ''}{satellite.parentAgentId ? ' · CHILD' : ''}</small>
      </li>)}
    </ul> : null}

    <div className="presence-stack">
      {answer ? <section className="presence-answer" role="region" aria-label="JARVIS response" aria-live="polite">
        <header>
          <small>JARVIS</small>
          <div className="presence-answer-actions">
            <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} title={expanded ? 'Collapse response' : 'Expand response'}>
              {expanded ? <ChevronsDown size={13} aria-hidden="true"/> : <ChevronsUp size={13} aria-hidden="true"/>}
              <span>{expanded ? 'COLLAPSE' : 'EXPAND'}</span>
            </button>
            <button type="button" onClick={props.onDismissAnswer} aria-label="Dismiss response" title="Dismiss response"><X size={13} aria-hidden="true"/></button>
          </div>
        </header>
        <div className="presence-answer-body" tabIndex={0}>{answer}</div>
      </section> : null}

      <form className="presence-input" onSubmit={event => void submit(event)} role="search">
        <label className="sr-only" htmlFor={inputId}>Ask JARVIS</label>
        <input id={inputId} value={text} onChange={event => setText(event.target.value)} disabled={!inputEnabled || busy}
          placeholder={inputEnabled ? (coreRadius < 200 ? 'Ask JARVIS' : 'Ask JARVIS, or name the outcome you want') : 'Commands unavailable until the Kernel reconnects'} autoComplete="off" spellCheck={false} />
        {props.voiceControl}
        <button type="submit" className="presence-send" disabled={!inputEnabled || busy || !text.trim()} aria-label="Send to JARVIS"><CornerDownLeft size={15} aria-hidden="true"/></button>
      </form>

      <div className="presence-footer">
        <button className="presence-return" type="button" onClick={props.onCommandCentre} title="Return to the command centre (C)">
          <LayoutDashboard size={14} aria-hidden="true"/><span>COMMAND CENTRE</span><kbd>C</kbd>
        </button>
        <span className={`presence-link link-${liveness.status}`} aria-label={`Connection ${liveness.status}`}><i aria-hidden="true"/>{liveness.label}</span>
        <span className="presence-mark" aria-hidden="true"><ArrowUpRight size={11}/>SENTIENCE</span>
      </div>
    </div>
  </div>;
}

export function presenceAriaSummary(phaseWord: string, detail: string): string {
  return `${phaseWord}. ${detail}`;
}
