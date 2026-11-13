'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import { Activity, Command, Layers, Sparkles } from 'lucide-react';
import { CinematicHud } from './cinematic-hud.tsx';
import { ModelControls } from './model-controls.tsx';
import { VISUAL_PRESETS, type VisualPreset, modelTint } from './cinematic-palette.ts';
import type { CSSProperties } from 'react';
import type { SceneIntent, SemanticScene } from '@jarvis/scene';
import { agentField } from './agent-field-policy.ts';
import { AgentInspector } from './agent-field.tsx';
import { AirTouchControl } from './air-touch-control.tsx';
import { AirTouchLayer } from './air-touch-layer.tsx';
import { ApprovalBarrier } from './approval-barrier.tsx';
import { cognitionRouterView } from './cognition-router-policy.ts';
import { ObjectiveAnchor, SpatialInspector } from './context-projections.tsx';
import { CoreSound } from './core-sound.tsx';
import { demoScene } from './demo-scene.ts';
import { expressedStage, requestFlow, resolveExperiencePhase, resolveLiveness } from './experience-phase-policy.ts';
import { GpuEnvironment } from './gpu-environment.tsx';
import { OperationsView } from './operations-view.tsx';
import { useChoreography, useDepartingNodes, useStableSlots } from './use-constellation.ts';
import { ReferentFocus } from './referent-focus.tsx';
import { RtcControl } from './rtc-control.tsx';
import { BrowserLayoutCache, createDesktopTransport, LocalSceneTransport, type SceneTransport } from './scene-client.ts';
import { SelectedCapture } from './selected-capture.tsx';
import { emptySessionStats, observeRuns } from './session-cognition-stats.ts';
import { spatialLayout } from './spatial-layout-policy.ts';
import { SpatialPanel } from './spatial-panel.tsx';
import { healthRegions, interpretTelemetry } from './telemetry-instrument-policy.ts';
import { SystemStatusEdge } from './system-status-edge.tsx';
import { useNow, useViewport } from './use-viewport.ts';
import { useScene } from './use-scene.ts';
import { latestConversationAnswer } from './conversation-answer.ts';
import { ResponsePanel } from './response-panel.tsx';
import { PresenceMode } from './presence/presence-mode.tsx';
import { UtteranceRecorder } from './voice-capture.ts';
import { COMMAND_MODE_KEY, PRESENCE_MODE_KEY, PRESENCE_MODE_STORAGE, presenceComposition, presenceInputEnabled, presenceMotion, presenceReadout, presenceSatellites, presenceZones } from './presence/presence-policy.ts';
import { PresenceMic } from './presence/presence-mic.tsx';

const offlineScene = (): SemanticScene => ({ id: 'kernel-offline', principalId: 'unavailable', version: 0, presentation: 'DEGRADED', monitors: [{ id: 'primary', label: 'Primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, primary: true, connected: true }], objects: [{ id: 'core', kind: 'jarvis-core', title: 'JARVIS', semanticRole: 'connection-status', monitorId: 'primary', position: { x: 760, y: 300 }, size: { width: 400, height: 400 }, zIndex: 1, state: 'focused', pinned: true, dismissible: false, resourceRefs: [], updatedAt: new Date().toISOString(), data: { activity: [], phrase: 'Kernel unavailable. No authoritative state is being shown.' } }], updatedAt: new Date().toISOString() });

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Presence Mode is the room; the command centre is the workshop. Both stay mounted. */
type ExperienceMode = 'presence' | 'command';

export function JarvisExperience() {
  const [visualPreferences,setVisualPreferences]=useState<Record<string,VisualPreset>>({});
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('jarvis:model-visuals:v1')??'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))setVisualPreferences(Object.fromEntries(Object.entries(saved).filter(([,value])=>typeof value==='string'&&Object.hasOwn(VISUAL_PRESETS,value))) as Record<string,VisualPreset>);}catch{}},[]);
  const [focusedModel, setFocusedModel] = useState<string>();
  const [preferredModel,setPreferredModel]=useState(process.env.NEXT_PUBLIC_JARVIS_PREFERRED_MODEL??'gpt-6.1-sol');
  // Conversation privacy. The Kernel is the source of truth; this is only what it told us.
  const [privacy,setPrivacy]=useState<{regime:'PRIVATE'|'CLOUD_PERMITTED';provider?:string;note?:string}>({regime:'PRIVATE'});
  const [privacyBusy,setPrivacyBusy]=useState(false);
  // Audio output is an explicit operator decision; it is never enabled automatically.
  const [speechEnabled,setSpeechEnabled]=useState(false);
  const [speaking,setSpeaking]=useState(false);
  useEffect(()=>{try{const saved=localStorage.getItem('jarvis:preferred-model:v1');if(saved!==null)setPreferredModel(saved);}catch{}},[]);
  const updatePreferredModel=(value:string)=>{setPreferredModel(value);try{localStorage.setItem('jarvis:preferred-model:v1',value);}catch{}};
  const [conversationId, setConversationId] = useState<string | undefined>();
  const prefersReduced = Boolean(useReducedMotion());
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reducedSensory = mounted && prefersReduced;
  const demoMode = process.env.NEXT_PUBLIC_JARVIS_DEMO_MODE === '1';
  const baseTransport = useMemo<SceneTransport>(() => demoMode ? new LocalSceneTransport(demoScene, new BrowserLayoutCache()) : createDesktopTransport(), [demoMode]);
  const [fixtureTransport, setFixtureTransport] = useState<SceneTransport>();
  const [forceFallback, setForceFallback] = useState(false);
  const [operations, setOperations] = useState(false);
  const [mode, setMode] = useState<ExperienceMode>('presence');
  const switchMode = useCallback((next: ExperienceMode) => { setMode(next); try { localStorage.setItem(PRESENCE_MODE_STORAGE, next); } catch { /* presentation preference is optional */ } }, []);
  useEffect(() => { try { setMode(localStorage.getItem(PRESENCE_MODE_STORAGE) === 'command' ? 'command' : 'presence'); } catch { /* default presence */ } }, []);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'situation' | 'agents'>('situation');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setForceFallback(params.get('renderer') === 'fallback');
    setOperations(params.get('ops') === '1');
    if (params.get('mode') === 'command') setMode('command');
    if (!demoMode) return;
    const scenario = params.get('scenario');
    const sequence = params.get('sequence');
    if (!scenario && !sequence) return;
    let cancelled = false;
    if (sequence) {
      const lead = Number(params.get('lead') ?? 3000);
      void import('./demo-sequences.ts').then(sequences => { if (!cancelled && sequences.isDemoSequence(sequence)) setFixtureTransport(new sequences.SequenceSceneTransport(sequence, Number.isFinite(lead) ? lead : 3000)); });
    } else void import('./visual-fixtures.ts').then(fixtures => { if (!cancelled && fixtures.isVisualScenario(scenario)) setFixtureTransport(new fixtures.FixtureSceneTransport(scenario)); });
    return () => { cancelled = true; };
  }, [demoMode]);
  const transport = fixtureTransport ?? baseTransport;
  const { scene: receivedScene, kernel, connection, submit, submitProposal, submitCognition, decideApproval, reconnect } = useScene(transport);
  const liveness = useMemo(() => resolveLiveness(connection, demoMode), [connection, demoMode]);
  const current = liveness.current;
  const phase = resolveExperiencePhase(kernel, liveness);
  const scene = receivedScene ?? offlineScene();
  const presentation = current ? scene.presentation : 'DEGRADED';
  const now = useNow(5000);

  const router = useMemo(() => cognitionRouterView(kernel?.activeModels ?? [], kernel?.recentModelRuns ?? [], current), [kernel?.activeModels, kernel?.recentModelRuns, current]);
  const agents = useMemo(() => agentField(kernel?.agentJobs ?? [], current), [kernel?.agentJobs, current]);
  const regions = useMemo(() => healthRegions(kernel, current), [kernel, current]);
  const instruments = useMemo(() => interpretTelemetry(kernel?.telemetrySummary.system, current, now), [kernel?.telemetrySummary.system, current, now]);
  const viewport = useViewport();
  const displayed = useDepartingNodes(router.nodes, reducedSensory);
  const slots = useStableSlots(displayed);
  const choreography = useChoreography(router.route, router.nodes);
  const slotSignature = displayed.map(node => { const slot = slots.get(node.modelId); return `${node.locality ?? '-'}:${slot ? `${slot.arc}.${slot.index}` : '-'}`; }).join(',');
  const layout = useMemo(() => spatialLayout({ width: viewport.width, height: viewport.height, models: displayed.map(node => ({ ...(node.locality ? { locality: node.locality } : {}), ...(slots.has(node.modelId) ? { slot: slots.get(node.modelId)! } : {}) })), agentCount: agents.nodes.length }),
    [viewport.width, viewport.height, slotSignature, agents.nodes.length]);
  const cinematicLayout = useMemo(() => ({ ...layout, core: { x: viewport.width * .5, y: viewport.height * (layout.narrow ? .40 : .50) }, coreRadius: Math.min(viewport.height * .24, viewport.width * (layout.narrow ? .34 : .205)) }), [layout, viewport.width, viewport.height]);
  const presenceOn = mode === 'presence';
  const composition = useMemo(() => presenceComposition(viewport), [viewport.width, viewport.height]);
  const presenceClock = useNow(1000);
  const readout = useMemo(() => presenceReadout({ phase, liveness, ...(kernel ? { picture: kernel } : {}), now: presenceClock }), [phase, liveness, kernel, presenceClock]);
  const zones = useMemo(() => presenceZones(viewport, composition), [viewport, composition]);
  const presenceMotionState = useMemo(() => presenceMotion(reducedSensory, readout.state), [reducedSensory, readout.state]);
  const satellites = useMemo(() => presenceSatellites(kernel?.agentJobs ?? [], { core: composition.layout.core, radius: composition.satelliteRadius, current, reducedMotion: reducedSensory }), [kernel?.agentJobs, current, reducedSensory, composition]);
  const activeLayout = presenceOn ? composition.layout : cinematicLayout;
  const barrierLayout = presenceOn ? { ...composition.layout, narrow: true } : layout;
  const visualModel = displayed.find(node => node.modelId === focusedModel)?.modelId ?? displayed.find(node => node.route === 'SELECTED')?.modelId;
  const preset=visualPreferences[visualModel??'preview']??'auto';
  const updatePreset=(value:VisualPreset)=>{const next={...visualPreferences,[visualModel??'preview']:value};setVisualPreferences(next);try{localStorage.setItem('jarvis:model-visuals:v1',JSON.stringify(next));}catch{}};
  const visualId = preset==='auto'?visualModel:VISUAL_PRESETS[preset].model;
  const stage = expressedStage(requestFlow(current ? kernel : undefined, phase));
  const idle = phase === 'DORMANT' || phase === 'AWARE';
  const [stats, setStats] = useState(() => emptySessionStats());
  useEffect(() => { if (current && kernel) setStats(previous => observeRuns(previous, [...kernel.activeModels, ...kernel.recentModelRuns])); }, [current, kernel]);

  const [selected, setSelected] = useState<string[]>([]);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalText, setProposalText] = useState('');
  const [commandResult, setCommandResult] = useState('');
  const deliveredAnswer=latestConversationAnswer(kernel?.cognitionResponses??[]);
  // Delivered answers are only adopted when this session asked for them. Adopting whichever
  // answer the projection last saw meant a historical business brief greeted the owner on
  // open, which is neither conversational nor private.
  const askedThisSession = useRef(false);
  useEffect(()=>{
    if(!askedThisSession.current)return;
    if(deliveredAnswer?.answer){setCommandResult(deliveredAnswer.answer);if(deliveredAnswer.conversationId)setConversationId(deliveredAnswer.conversationId)}
  },[deliveredAnswer?.requestId]);
  const panels = scene.objects.filter(object => object.kind !== 'jarvis-core');
  const send = (intent: SceneIntent) => void submit(intent).catch(() => setCommandResult('Presentation update conflicted; live state retained.'));
  const kernelLive = connection.status === 'live';
  // A notification is not an answer. Piping notifications into the response surface put
  // historical business briefs (invoice payloads included) in front of the owner the moment
  // presence opened. Answers come only from a turn the operator initiated; alerts stay in
  // the command centre, where they are labelled as notifications.
  useEffect(() => transport.subscribeNotifications?.(() => undefined), [transport]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const pressed = event.key.toLowerCase();
      if (pressed === 'o') setOperations(open => !open);
      else if (pressed === PRESENCE_MODE_KEY) switchMode('presence');
      else if (pressed === COMMAND_MODE_KEY) switchMode('command');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [switchMode]);
  const closeOperations = useCallback(() => setOperations(false), []);
  const cloudProvider = process.env.NEXT_PUBLIC_JARVIS_CLOUD_PROVIDER ?? 'openrouter';
  const applyPrivacy = (state:{regime:'PRIVATE'|'CLOUD_PERMITTED';provider?:string;note?:string}) => setPrivacy(state);
  // The demo transport has no privacy endpoint, so the capability is probed structurally
  // rather than assumed from the class name.
  type PrivacyTransport = {
    grantConversation: (c: { commandId: string; expectedStateVersion: number; conversationId: string; provider: string; model: string; ceiling: 'INTERNAL' }) => Promise<{ regime: 'PRIVATE' | 'CLOUD_PERMITTED'; grant: { provider: string } | null }>;
    revokeConversation: (c: { commandId: string; expectedStateVersion: number; conversationId: string }) => Promise<{ regime: 'PRIVATE' | 'CLOUD_PERMITTED'; grant: { provider: string } | null }>;
  };
  const privacyTransport = (value: unknown): value is PrivacyTransport =>
    typeof (value as PrivacyTransport | undefined)?.grantConversation === 'function' &&
    typeof (value as PrivacyTransport | undefined)?.revokeConversation === 'function';
  // Local dictation: capture here, transcribe in the Kernel, put the text in the input.
  const dictate = async (): Promise<{ text: string; problem?: string }> => {
    type SpeechTransport = { transcribeUtterance: (wav: Blob) => Promise<{ ok: boolean; transcript?: string; problem?: string; detail?: string }> };
    const speech = transport as unknown as Partial<SpeechTransport>;
    if (typeof speech.transcribeUtterance !== 'function') return { text: '', problem: 'Kernel transport unavailable.' };
    const recorder = new UtteranceRecorder({ maxMs: 20_000 });
    try { await recorder.start(); } catch { return { text: '', problem: 'Microphone permission denied.' }; }
    // Capture ends on silence or at the 20 s ceiling; the operator speaks one sentence.
    const capture = await recorder.wait();
    if (!capture) return { text: '', problem: 'Nothing was captured.' };
    const result = await speech.transcribeUtterance(capture.wav);
    if (result.problem === 'silence' || !result.transcript) return { text: '', problem: 'No speech detected. Try again, a little louder.' };
    if (!result.ok) return { text: '', problem: result.detail ?? result.problem ?? 'Recognition failed.' };
    return { text: result.transcript };
  };

  /** Play an answer with the local synthesiser. Real audio, real end, no autoplay. */
  const speak = async (text: string) => {
    type SpeechTransport = { synthesiseSpeech: (value: string) => Promise<Blob> };
    const speech = transport as unknown as Partial<SpeechTransport>;
    if (typeof speech.synthesiseSpeech !== 'function' || !text.trim()) return;
    setSpeaking(true);
    let url: string | undefined;
    try {
      const wav = await speech.synthesiseSpeech(text);
      url = URL.createObjectURL(wav);
      const audio = new Audio(url);
      audio.onended = () => { if (url) URL.revokeObjectURL(url); setSpeaking(false); };
      audio.onerror = () => { if (url) URL.revokeObjectURL(url); setSpeaking(false); };
      await audio.play();
    } catch {
      if (url) URL.revokeObjectURL(url);
      setSpeaking(false);
    }
  };

  const toggleCloud = async () => {
    if (!kernel || privacyBusy) return;
    if (!privacyTransport(transport)) { setPrivacy({regime:'PRIVATE',note:'Kernel transport unavailable'}); return; }
    setPrivacyBusy(true);
    try {
      if (privacy.regime === 'CLOUD_PERMITTED') {
        if (conversationId) {
          const state = await transport.revokeConversation({ commandId: crypto.randomUUID(), expectedStateVersion: kernel.stateVersion, conversationId });
          applyPrivacy({ regime: state.regime, ...(state.grant ? { provider: state.grant.provider } : {}) });
        } else applyPrivacy({ regime: 'PRIVATE' });
      } else {
        const next = conversationId ?? crypto.randomUUID();
        const state = await transport.grantConversation({ commandId: crypto.randomUUID(), expectedStateVersion: kernel.stateVersion, conversationId: next, provider: cloudProvider, model: preferredModel, ceiling: 'INTERNAL' });
        setConversationId(next);
        applyPrivacy({ regime: state.regime, ...(state.grant ? { provider: state.grant.provider } : {}) });
      }
    } catch (error) {
      applyPrivacy({ regime: privacy.regime, note: error instanceof Error ? error.message : 'permission change failed' });
    } finally { setPrivacyBusy(false); }
  };

  const ask = async (text: string) => { askedThisSession.current = true; try { if (!kernel) throw new Error('Kernel offline'); if (/^put that on the wall[.!]?$/i.test(text.trim())) { const target = selected[0] ?? kernel.referentFocus?.objectId; if (!target) throw new Error('Select a Scene resource first'); if (!('presentOnWall' in transport) || typeof transport.presentOnWall !== 'function') throw new Error('Kernel transport unavailable'); await transport.presentOnWall(target, kernel.sceneVersion); setCommandResult('Scene resource presented on wall'); } else { const result = await submitCognition({ commandId: crypto.randomUUID(), expectedStateVersion: kernel.stateVersion, input: text, ...(preferredModel.trim()?{preferredModels:[preferredModel.trim()]}:{}), ...(conversationId ? { conversationId } : {}) }); setConversationId(result.conversationId); const answerText = result.answer ?? `${result.result.proposals.length} proposal(s) returned by ${result.result.agentId}`;
          setCommandResult(answerText);
          if (speechEnabled && answerText.trim()) void speak(answerText); } } catch (error) { setCommandResult(error instanceof Error ? error.message : String(error)); } };
  const runProposal = async () => { await ask(proposalText); setProposalOpen(false); };
  const cancelJob = async (jobId: string) => { if (!kernel || !kernelLive) throw new Error('Kernel disconnected'); const response = await transport.cancelAgentJob({ commandId: crypto.randomUUID(), expectedStateVersion: kernel.stateVersion, jobId }); if (!response.cancelled) throw new Error('Job already terminal; capability effects require their own Kernel controls'); };
  const developer = process.env.NODE_ENV === 'development';
  const approvals = kernel?.pendingApprovals ?? [];
  const rtcAvailable = ['HEALTHY', 'DEGRADED'].includes(kernel?.diagnostics.dependencies.find(item => item.name === 'rtc')?.status ?? 'OFFLINE');

  return <main style={{ '--cinematic-accent': modelTint(visualId) } as CSSProperties} className={`environment cinematic visual-${preset} presentation-${presentation.toLowerCase()} phase-${phase.toLowerCase()}${current ? '' : ' not-current'}${operations ? ' operations-open' : ''}${workspaceOpen ? ' workspace-open' : ''}${commandResult ? ' has-response' : ''}${approvals.length ? ' approval-hold' : ''}${layout.narrow ? ' narrow' : ''}${idle ? ' idle' : ''}${presenceOn ? ' presence-open' : ' command-open'}${viewport.measured ? '' : ' unmeasured'}`}
    onKeyDown={event => { if (event.key === 'Escape' && selected[0]) { send({ type: 'dismiss', targetId: selected[0], input: 'keyboard' }); setSelected([]); } }} tabIndex={-1}>
    {demoMode && <div className="demo-banner" role="status">DEMO MODE · SYNTHETIC DATA · NO LIVE EXECUTION</div>}
    <GpuEnvironment scene={scene} {...(kernel ? { picture: kernel } : {})} liveness={liveness} phase={phase} layout={activeLayout} {...(visualId ? { focusModel: visualId } : {})} models={presenceOn ? [] : displayed} {...(router.route ? { route: router.route } : {})} agents={presenceOn ? [] : agents.nodes} regions={regions}
      systemDegraded={current && kernel?.systemHealth.overall === 'DEGRADED'} criticalRisk={approvals[0]?.riskClass === 'CRITICAL'} forceFallback={forceFallback} {...(stage ? { stage } : {})} choreography={choreography}
      {...(presenceOn ? { presence: { state: readout.state, ambient: presenceMotionState.ambient, reduced: reducedSensory } } : {})}/>
    {presenceOn ? <PresenceMode readout={readout} liveness={liveness} composition={composition} zones={zones} satellites={satellites}
      inputEnabled={presenceInputEnabled({ liveness })} reducedMotion={reducedSensory} rendererFallback={forceFallback}
      voiceControl={<PresenceMic transport={transport} live={kernelLive} available={rtcAvailable} liveness={liveness} picture={kernel}/>}
      onDictate={dictate}
      speech={{ enabled: speechEnabled, speaking, onToggle: () => setSpeechEnabled(value => !value) }}
      privacy={{ regime: privacy.regime, ...(privacy.provider ? { provider: privacy.provider } : {}), ...(privacy.note ? { note: privacy.note } : {}), busy: privacyBusy, onGrant: () => void toggleCloud(), onRevoke: () => void toggleCloud() }}
      answer={commandResult || undefined} onAsk={ask} onDismissAnswer={() => setCommandResult('')} onCommandCentre={() => switchMode('command')}/> : null}
    {!presenceOn ? <>
    <SystemStatusEdge {...(kernel ? { picture: kernel } : {})} liveness={liveness} regions={regions} operations={operations} inspector={inspector}
      onOperations={() => setOperations(open => !open)} onInspector={() => { setInspectorTab('situation'); setInspector(open => !open); }} onReconnect={() => void reconnect()}
      sound={<CoreSound {...(current && kernel ? { picture: kernel } : {})} reducedSensory={reducedSensory}/>}/>
    {!idle ? <ObjectiveAnchor {...(kernel ? { picture: kernel } : {})} liveness={liveness}/> : null}
    <section className="workspace" aria-label="Semantic workspace">
      <AnimatePresence>{panels.map(object => <SpatialPanel key={object.id} object={object} live={current} compact={!selected.includes(object.id)} selected={selected.includes(object.id)} onSelect={id => setSelected([id])} submit={send}/>)}</AnimatePresence>
    </section>
    <CinematicHud models={displayed} {...(focusedModel ? { focused: focusedModel } : {})} onFocus={setFocusedModel} instruments={instruments} agents={agents.nodes} phase={phase} liveness={liveness} layout={cinematicLayout} onAgents={() => { setInspectorTab('agents'); setInspector(true); }}/>
    <ModelControls {...(kernel?{picture:kernel}:{})} {...(visualModel?{modelId:visualModel}:{})} preset={preset} onPreset={updatePreset} preferredModel={preferredModel} onPreferredModel={updatePreferredModel} current={current}/>
    <ReferentFocus focus={kernelLive ? kernel?.referentFocus : undefined} objects={scene.objects} developer={inspector && developer}/>
    <footer className="command-deck">
      <RtcControl transport={transport} live={kernelLive} available={rtcAvailable}/>
      <button className="command-line" onClick={() => setProposalOpen(!proposalOpen)} disabled={!kernelLive}><Command size={15}/><span>{kernelLive ? (layout.narrow ? 'Ask JARVIS' : 'Ask JARVIS or request an action') : liveness.synthetic ? (layout.narrow ? 'Demo · read only' : 'Demo mode · commands are not sent') : (layout.narrow ? 'Reconnect to begin' : 'Commands unavailable until Kernel reconnects')}</span><kbd>ENTER</kbd></button>
      <button aria-label="Scene workspace" aria-expanded={workspaceOpen} className="deck-icon" onClick={() => setWorkspaceOpen(open => !open)} title="Scene workspace"><Layers size={16}/></button>
      <SelectedCapture {...(kernel ? { kernel } : {})} live={kernelLive} submit={submitProposal}/>
      <button aria-label="Open operations view" className={`deck-icon${operations ? ' active' : ''}`} onClick={() => setOperations(open => !open)}><Activity size={16}/></button>
      <AirTouchControl onReady={()=>setWorkspaceOpen(true)}/>
    </footer>
    {proposalOpen && <section className="proposal-entry"><label htmlFor="proposal-json">JARVIS REQUEST</label><textarea id="proposal-json" value={proposalText} onChange={event => setProposalText(event.target.value)} placeholder="Ask a question or describe the outcome you want."/><div><button onClick={() => setProposalOpen(false)}>CANCEL</button><button onClick={() => void runProposal()}>SUBMIT TO JARVIS</button></div></section>}
    <ResponsePanel text={commandResult} answerId={commandResult===deliveredAnswer?.answer?deliveredAnswer?.requestId:undefined} live={kernelLive}/>
    <AirTouchLayer objects={panels} submit={send} transport={transport}/>
    <button className="presence-entry" type="button" onClick={() => switchMode('presence')} title="Presence Mode (P)"><Sparkles size={14} aria-hidden="true"/><span>PRESENCE</span></button>
    {inspector && <SpatialInspector key={inspectorTab} initialTab={inspectorTab} {...(kernel ? { picture: kernel } : {})} liveness={liveness} onClose={() => setInspector(false)} agents={<AgentInspector jobs={kernel?.agentJobs ?? []} live={kernelLive} {...(kernel?.generatedAt ? { generatedAt: kernel.generatedAt } : {})} onCancel={cancelJob}/>}/>}
    {operations && <OperationsView instruments={instruments} {...(kernel ? { picture: kernel } : {})} liveness={liveness} phase={phase} regions={regions} nodes={router.nodes} {...(router.route ? { route: router.route } : {})} stats={stats} agents={agents.nodes} onClose={closeOperations}/>}
    </> : null}
    {kernel && approvals.length ? <ApprovalBarrier approvals={approvals} stateVersion={kernel.stateVersion} decide={decideApproval} liveness={liveness} layout={barrierLayout}/> : null}
  </main>;
}
