'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import { Activity, Command } from 'lucide-react';
import type { SceneIntent, SemanticScene } from '@jarvis/scene';
import { agentField } from './agent-field-policy.ts';
import { AgentField, AgentInspector } from './agent-field.tsx';
import { AirTouchLayer } from './air-touch-layer.tsx';
import { ApprovalBarrier } from './approval-barrier.tsx';
import { cognitionRouterView } from './cognition-router-policy.ts';
import { ActivityRibbon, ConversationProjection, ObjectiveAnchor, SpatialInspector } from './context-projections.tsx';
import { CoreSound } from './core-sound.tsx';
import { demoScene } from './demo-scene.ts';
import { expressedStage, requestFlow, resolveExperiencePhase, resolveLiveness } from './experience-phase-policy.ts';
import { GpuEnvironment } from './gpu-environment.tsx';
import { CoreReadout } from './jarvis-core.tsx';
import { ModelConstellation } from './model-constellation.tsx';
import { CognitionStatus } from './model-matrix.tsx';
import { OperationsView } from './operations-view.tsx';
import { PeripheralTelemetry, RegionHealthProjections } from './peripheral-telemetry.tsx';
import { presentationBus } from './presentation-bus.ts';
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

const offlineScene = (): SemanticScene => ({ id: 'kernel-offline', principalId: 'unavailable', version: 0, presentation: 'DEGRADED', monitors: [{ id: 'primary', label: 'Primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, primary: true, connected: true }], objects: [{ id: 'core', kind: 'jarvis-core', title: 'JARVIS', semanticRole: 'connection-status', monitorId: 'primary', position: { x: 760, y: 300 }, size: { width: 400, height: 400 }, zIndex: 1, state: 'focused', pinned: true, dismissible: false, resourceRefs: [], updatedAt: new Date().toISOString(), data: { activity: [], phrase: 'Kernel unavailable. No authoritative state is being shown.' } }], updatedAt: new Date().toISOString() });

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function JarvisExperience() {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const reducedSensory = Boolean(useReducedMotion());
  const demoMode = process.env.NEXT_PUBLIC_JARVIS_DEMO_MODE === '1';
  const baseTransport = useMemo<SceneTransport>(() => demoMode ? new LocalSceneTransport(demoScene, new BrowserLayoutCache()) : createDesktopTransport(), [demoMode]);
  const [fixtureTransport, setFixtureTransport] = useState<SceneTransport>();
  const [forceFallback, setForceFallback] = useState(false);
  const [operations, setOperations] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'situation' | 'agents'>('situation');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setForceFallback(params.get('renderer') === 'fallback');
    setOperations(params.get('ops') === '1');
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
  const stage = expressedStage(requestFlow(current ? kernel : undefined, phase));
  const idle = phase === 'DORMANT' || phase === 'AWARE';
  const projections = useCallback((element: HTMLDivElement | null) => element ? presentationBus.registerLayer(element) : undefined, []);
  const [stats, setStats] = useState(() => emptySessionStats());
  useEffect(() => { if (current && kernel) setStats(previous => observeRuns(previous, [...kernel.activeModels, ...kernel.recentModelRuns])); }, [current, kernel]);

  const [selected, setSelected] = useState<string[]>([]);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalText, setProposalText] = useState('');
  const [commandResult, setCommandResult] = useState('');
  const panels = scene.objects.filter(object => object.kind !== 'jarvis-core');
  const coreObject = scene.objects.find(object => object.kind === 'jarvis-core');
  const send = (intent: SceneIntent) => void submit(intent).catch(() => setCommandResult('Presentation update conflicted; live state retained.'));
  const kernelLive = connection.status === 'live';
  useEffect(() => transport.subscribeNotifications?.(record => setCommandResult(`${record.title}: ${record.body}`)), [transport]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (!typing(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'o') setOperations(open => !open); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const closeOperations = useCallback(() => setOperations(false), []);
  const runProposal = async () => { try { if (!kernel) throw new Error('Kernel offline'); if (/^put that on the wall[.!]?$/i.test(proposalText.trim())) { const target = selected[0] ?? kernel.referentFocus?.objectId; if (!target) throw new Error('Select a Scene resource first'); if (!('presentOnWall' in transport) || typeof transport.presentOnWall !== 'function') throw new Error('Kernel transport unavailable'); await transport.presentOnWall(target, kernel.sceneVersion); setCommandResult('Scene resource presented on wall'); } else { const result = await submitCognition({ commandId: crypto.randomUUID(), expectedStateVersion: kernel.stateVersion, input: proposalText, ...(conversationId ? { conversationId } : {}) }); setConversationId(result.conversationId); setCommandResult(result.answer ?? `${result.result.proposals.length} proposal(s) returned by ${result.result.agentId}`); } setProposalOpen(false); } catch (error) { setCommandResult(error instanceof Error ? error.message : String(error)); } };
  const cancelJob = async (jobId: string) => { if (!kernel || !kernelLive) throw new Error('Kernel disconnected'); const response = await transport.cancelAgentJob({ commandId: crypto.randomUUID(), expectedStateVersion: kernel.stateVersion, jobId }); if (!response.cancelled) throw new Error('Job already terminal; capability effects require their own Kernel controls'); };
  const developer = process.env.NODE_ENV === 'development';
  const approvals = kernel?.pendingApprovals ?? [];
  const runs = useMemo(() => [...(kernel?.activeModels ?? []), ...(kernel?.recentModelRuns ?? [])], [kernel?.activeModels, kernel?.recentModelRuns]);

  return <main className={`environment presentation-${presentation.toLowerCase()} phase-${phase.toLowerCase()}${current ? '' : ' not-current'}${operations ? ' operations-open' : ''}${approvals.length ? ' approval-hold' : ''}${layout.narrow ? ' narrow' : ''}${idle ? ' idle' : ''}${viewport.measured ? '' : ' unmeasured'}`}
    onKeyDown={event => { if (event.key === 'Escape' && selected[0]) { send({ type: 'dismiss', targetId: selected[0], input: 'keyboard' }); setSelected([]); } }} tabIndex={-1}>
    {demoMode && <div className="demo-banner" role="status">DEMO MODE · SYNTHETIC DATA · NO LIVE EXECUTION</div>}
    <GpuEnvironment scene={scene} {...(kernel ? { picture: kernel } : {})} liveness={liveness} phase={phase} layout={layout} models={displayed} {...(router.route ? { route: router.route } : {})} agents={agents.nodes} regions={regions}
      systemDegraded={current && kernel?.systemHealth.overall === 'DEGRADED'} criticalRisk={approvals[0]?.riskClass === 'CRITICAL'} forceFallback={forceFallback} {...(stage ? { stage } : {})} choreography={choreography}/>
    <SystemStatusEdge {...(kernel ? { picture: kernel } : {})} liveness={liveness} regions={regions} operations={operations} inspector={inspector}
      onOperations={() => setOperations(open => !open)} onInspector={() => { setInspectorTab('situation'); setInspector(open => !open); }} onReconnect={() => void reconnect()}
      sound={<CoreSound {...(current && kernel ? { picture: kernel } : {})} reducedSensory={reducedSensory}/>}/>
    {!idle ? <ObjectiveAnchor {...(kernel ? { picture: kernel } : {})} liveness={liveness}/> : null}
    <section className="workspace" aria-label="Semantic workspace">
      <AnimatePresence>{panels.map(object => <SpatialPanel key={object.id} object={object} live={current} compact={!selected.includes(object.id)} selected={selected.includes(object.id)} onSelect={id => setSelected([id])} submit={send}/>)}</AnimatePresence>
    </section>
    <div className="spatial-projections" ref={projections}>
      <AgentField nodes={agents.nodes} layout={layout} liveness={liveness} onInspect={() => { setInspectorTab('agents'); setInspector(true); }}/>
      <ModelConstellation nodes={displayed} layout={layout} {...(router.route ? { route: router.route } : {})} runs={runs} liveness={liveness} phase={phase} developer={developer}/>
      <RegionHealthProjections instruments={instruments} regions={regions} layout={layout}/>
      <CoreReadout phase={phase} {...(kernel ? { picture: kernel } : {})} liveness={liveness} nodes={router.nodes} {...(router.route ? { route: router.route } : {})} regions={regions} layout={layout} {...(coreObject?.data.phrase ? { phrase: String(coreObject.data.phrase) } : {})}/>
      <ConversationProjection {...(kernel ? { picture: kernel } : {})} liveness={liveness} layout={layout} phase={phase}/>
    </div>
    <CognitionStatus phase={phase} nodes={router.nodes} {...(router.route ? { route: router.route } : {})} liveness={liveness}/>
    <PeripheralTelemetry instruments={instruments} {...(kernel?.telemetrySummary.system ? { snapshot: kernel.telemetrySummary.system } : {})} phase={phase} liveness={liveness}/>
    {!idle ? <ActivityRibbon {...(kernel ? { picture: kernel } : {})} liveness={liveness}/> : null}
    <ReferentFocus focus={kernelLive ? kernel?.referentFocus : undefined} objects={scene.objects} developer={inspector && developer}/>
    {kernel && approvals.length ? <ApprovalBarrier approvals={approvals} stateVersion={kernel.stateVersion} decide={decideApproval} liveness={liveness} layout={layout}/> : null}
    <footer className="command-deck">
      <RtcControl transport={transport} live={kernelLive} available={['HEALTHY', 'DEGRADED'].includes(kernel?.diagnostics.dependencies.find(item => item.name === 'rtc')?.status ?? 'OFFLINE')}/>
      <button className="command-line" onClick={() => setProposalOpen(!proposalOpen)} disabled={!kernelLive}><Command size={15}/><span>{kernelLive ? 'Ask JARVIS or request an action' : liveness.synthetic ? 'Demo mode · commands are not sent' : 'Commands unavailable until Kernel reconnects'}</span><kbd>ENTER</kbd></button>
      <SelectedCapture {...(kernel ? { kernel } : {})} live={kernelLive} submit={submitProposal}/>
      <button aria-label="Open operations view" className={`deck-icon${operations ? ' active' : ''}`} onClick={() => setOperations(open => !open)}><Activity size={16}/></button>
      <span className="air-touch-state"><i/>AIR TOUCH · {kernelLive ? 'PRESENTATION READY' : 'LOCAL ONLY'}</span>
    </footer>
    {proposalOpen && <section className="proposal-entry"><label htmlFor="proposal-json">JARVIS REQUEST</label><textarea id="proposal-json" value={proposalText} onChange={event => setProposalText(event.target.value)} placeholder="Ask a question or describe the outcome you want."/><div><button onClick={() => setProposalOpen(false)}>CANCEL</button><button onClick={() => void runProposal()}>SUBMIT TO JARVIS</button></div></section>}
    {commandResult && <div className="command-result" role="status">{commandResult}</div>}
    <AirTouchLayer objects={panels} submit={send} transport={transport}/>
    {inspector && <SpatialInspector key={inspectorTab} initialTab={inspectorTab} {...(kernel ? { picture: kernel } : {})} liveness={liveness} onClose={() => setInspector(false)} agents={<AgentInspector jobs={kernel?.agentJobs ?? []} live={kernelLive} {...(kernel?.generatedAt ? { generatedAt: kernel.generatedAt } : {})} onCancel={cancelJob}/>}/>}
    {operations && <OperationsView instruments={instruments} {...(kernel ? { picture: kernel } : {})} liveness={liveness} phase={phase} regions={regions} nodes={router.nodes} {...(router.route ? { route: router.route } : {})} stats={stats} agents={agents.nodes} onClose={closeOperations}/>}
  </main>;
}
