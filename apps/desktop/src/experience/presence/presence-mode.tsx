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
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, ChevronsDown, ChevronsUp, CornerDownLeft, LayoutDashboard, X } from 'lucide-react';
import type { DataLiveness } from '../experience-phase-policy.ts';
import type { PresenceComposition, PresenceReadout, PresenceSatellite, PresenceZones } from './presence-policy.ts';
import { formatAnswer } from './response-format.ts';

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
  /** Conversation privacy: what the Kernel has authorised, and the two operator actions. */
  /** Local speech output: explicit toggle, real playing state. */
  speech?: { enabled: boolean; speaking: boolean; level?: number; voice?: string; status?: 'ready' | 'speaking' | 'unavailable'; onCycleVoice?: () => void; onStop?: () => void; onToggle: () => void };
  /** Local dictation: start capture, return the recognised text (empty when nothing heard). */
  onDictate?: () => Promise<{ text: string; problem?: string }>;
  privacy?: { regime: 'PRIVATE' | 'CLOUD_PERMITTED'; provider?: string; busy: boolean; note?: string; onGrant: () => void; onRevoke: () => void };
  onAsk: (text: string) => Promise<void> | void;
  onDismissAnswer: () => void;
  onCommandCentre: () => void;
}

/**
 * What a submitted draft should do. Extracted because the live behaviour - a message vanishing when
 * sent while the interface was still thinking - was invisible to every test that rendered markup.
 */
export function submitIntent(input: { text: string; busy: boolean; inputEnabled: boolean }): 'ask' | 'held' | 'ignore' {
  if (!input.text.trim()) return 'ignore';
  if (!input.inputEnabled) return 'ignore';
  return input.busy ? 'held' : 'ask';
}

export function PresenceMode(props: PresenceModeProps) {
  const { readout, liveness, composition, zones, satellites, inputEnabled, reducedMotion, rendererFallback, answer } = props;
  // Parsing is deterministic but not free; answers change rarely, readouts often.
  const formatted = useMemo(() => formatAnswer(answer), [answer]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [dictateProblem, setDictateProblem] = useState('');
  // Dictation fills the input and stops there. Submitting is the operator's decision, so a
  // misheard sentence can never become an instruction.
  const dictate = async () => {
    if (!props.onDictate || dictating) return;
    setDictating(true); setDictateProblem('');
    try {
      const result = await props.onDictate();
      if (result.text) setText(previous => (previous ? previous + ' ' : '') + result.text);
      else if (result.problem) setDictateProblem(result.problem);
    } catch (error) {
      setDictateProblem(error instanceof Error ? error.message.slice(0, 120) : 'Dictation failed.');
    } finally { setDictating(false); }
  };
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
    if (submitIntent({ text: value, busy, inputEnabled }) === 'ignore') return;
    if (submitIntent({ text: value, busy, inputEnabled }) === 'held') {
      // Dropping this silently looked like the application had lost the message. The draft is kept
      // and the reason is shown; nothing is queued, so no second protected request is transmitted
      // behind the owner's back.
      setHeld('Still finishing the last answer — your words are kept. Press Enter once more when it settles.');
      return;
    }
    setHeld(undefined);
    setBusy(true);
    try { await props.onAsk(value); setText(''); } finally { setBusy(false); }
  };

  return <div ref={layer} className={`presence-layer presence-${readout.state.toLowerCase()}${reducedMotion ? ' reduced' : ''}${answer ? ' has-answer' : ''}${expanded ? ' answer-expanded' : ''}`}
    data-presence-state={readout.state} data-voice-level={props.speech?.level ? props.speech.level.toFixed(2) : '0'} style={{ ['--voice-energy' as string]: String(props.speech?.level ?? 0), ['--presence-horizon' as string]: `${zones.horizon}px`, ['--presence-answer-max' as string]: `${zones.answerMaxHeight}px`, ['--presence-stack-max' as string]: `${zones.stackMax}px` }}>

    <div className="presence-word-block" style={{ left: core.x, top: zones.horizon }}>
      <div className="presence-word" role="status" aria-live="polite" aria-label={`JARVIS ${readout.word}. ${readout.detail}`}>
        <strong key={readout.word}>{readout.word}</strong>
      </div>
      <p className="presence-detail">{readout.detail}</p>
      {held ? <p className="presence-held" role="status">{held}</p> : null}
      {props.speech?.speaking && props.speech.onStop
        ? <button className="presence-stop" type="button" onClick={props.speech.onStop} aria-label="Stop Jarvis speaking">STOP SPEAKING</button>
        : null}
      {!liveness.current ? <button className="presence-reconnect" type="button" onClick={props.onCommandCentre}>OPEN COMMAND CENTRE · RECONNECT</button> : null}
      {rendererFallback ? <p className="presence-fallback" role="note">GPU environment unavailable · static rendering · state text is authoritative</p> : null}
    </div>

    {satellites.length ? <ul className="presence-satellites" aria-label={`Active agent jobs: ${satellites.length}`}>
      {satellites.map(satellite => <li key={satellite.key}
        className={`presence-satellite state-${satellite.state.toLowerCase()}${satellite.animated ? ' live' : ''}${satellite.parentAgentId ? ' child' : ''}`}
        style={{ left: satellite.point.x, top: satellite.point.y }}>
        <i className="presence-orb" aria-hidden="true"><b/><b/></i>
        <span className="presence-satellite-name">{satellite.name}</span>
        <small>{satellite.state}{satellite.activeJobCount > 1 ? ` · ${satellite.activeJobCount} JOBS` : ''}{satellite.parentAgentId ? ' · CHILD' : ''}</small>
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
        <div className="presence-answer-body" tabIndex={0}>
          {formatted.segments.map((segment, index) => segment.kind === 'structured'
            ? <details key={index} className="presence-evidence">
                <summary>
                  <span>{segment.summary}</span>
                  {segment.timestamps.length ? <small>as of {segment.timestamps[segment.timestamps.length - 1]}</small> : null}
                </summary>
                <pre>{segment.pretty}</pre>
              </details>
            : <p key={index} className="presence-prose">{segment.text}</p>)}
        </div>
      </section> : null}

      {props.privacy ? <div className={`presence-privacy regime-${props.privacy.regime.toLowerCase()}`} role="group" aria-label="Conversation privacy">
        <span className="presence-privacy-label">
          {props.privacy.regime === 'CLOUD_PERMITTED' ? `CLOUD · ${props.privacy.provider ?? 'AUTHORISED PROVIDER'}` : 'PRIVATE · THIS MACHINE'}
        </span>
        {props.privacy.note ? <small className="presence-privacy-note">{props.privacy.note}</small> : null}
        <button type="button" disabled={!inputEnabled || props.privacy.busy}
          onClick={props.privacy.regime === 'CLOUD_PERMITTED' ? props.privacy.onRevoke : props.privacy.onGrant}
          title={props.privacy.regime === 'CLOUD_PERMITTED' ? 'Revoke cloud permission for this conversation' : 'Allow this conversation to use the authorised provider'}>
          {props.privacy.regime === 'CLOUD_PERMITTED' ? 'MAKE PRIVATE' : 'ALLOW CLOUD'}
        </button>
      </div> : null}

      {props.onDictate ? <div className="presence-dictate">
        <button type="button" disabled={!inputEnabled || dictating || busy} onClick={() => void dictate()}
          aria-label={dictating ? 'Listening' : 'Dictate'} title={dictating ? 'Listening…' : 'Dictate with your microphone'}>
          {dictating ? '●' : 'MIC'}
        </button>
        {dictateProblem ? <small role="status">{dictateProblem}</small> : null}
        {props.speech ? <button type="button" className={props.speech.enabled ? 'on' : ''}
          aria-pressed={props.speech.enabled} onClick={props.speech.onToggle}
          title={props.speech.enabled ? 'Spoken answers on' : 'Spoken answers off'}>
          {props.speech.speaking ? '♪' : props.speech.enabled ? 'VOICE ON' : 'VOICE OFF'}
        </button> : null}
      </div> : null}

      <form className="presence-input" onSubmit={event => void submit(event)} role="search">
        <label className="sr-only" htmlFor={inputId}>Ask JARVIS</label>
        <input id={inputId} value={text} onChange={event => setText(event.target.value)} disabled={!inputEnabled || busy}
          placeholder={inputEnabled
            ? (coreRadius < 200 ? 'Ask JARVIS' : 'Ask JARVIS, or name the outcome you want')
            : liveness.synthetic
              // Demo fixtures can never accept a command; saying "reconnect" would
              // imply the Kernel is merely away.
              ? 'Demo mode · synthetic data · commands disabled'
              : 'Commands unavailable until the Kernel reconnects'} autoComplete="off" spellCheck={false} />
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
