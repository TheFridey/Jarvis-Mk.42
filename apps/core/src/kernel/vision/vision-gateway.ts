import type { DomainService } from '../domains/domain-service.ts';
import { EventNames, type VisionDiagnostics, type VisionEventCommand, type VisionEventResponse, type VisionSignal } from '@jarvis/contracts';
import type { AirTouchFrame } from '@jarvis/scene';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { PresenceManager } from '../presence/presence-manager.ts';
import {visionCommandSchema} from './signal-schema.ts';

export class VisionGateway {
  private readonly listeners = new Set<(frame: AirTouchFrame) => void>();
  private latestDiagnostics?: VisionDiagnostics;
  private latestSignal?: VisionSignal;
  constructor(private readonly deps: { domains?:DomainService; events: EventManager; presence: PresenceManager; principalId: string;observe?:(command:VisionEventCommand)=>void }) {}
  // RC-audit: the static-token `authenticate`/`authorises` pair was removed.
  // All ingress authentication and principal/node binding is enforced by
  // DiagnosticsHttp via SessionCredentialManager; keeping a second, weaker
  // static-token check here was dead code that only invited reuse.
  subscribe(listener: (frame: AirTouchFrame) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  diagnostics() { return this.latestDiagnostics; }
  signal() { return this.latestSignal; }
  async handle(command: VisionEventCommand): Promise<VisionEventResponse> {
    this.validate(command);
    return this.deps.domains?this.deps.domains.run(command.principalId,{nodeId:command.nodeId},command.commandId,()=>this.handleInner(command)):this.handleInner(command);
  }
  private async handleInner(command:VisionEventCommand):Promise<VisionEventResponse>{
    this.deps.observe?.(command);
    this.latestSignal = structuredClone(command.signal);
    if (command.signal.type === 'air-touch') { const signal = command.signal; this.latestDiagnostics = signal.diagnostics; this.listeners.forEach((listener) => listener(signal.frame)); await this.emit(EventNames.VisionAirTouch, command, 'TRANSIENT', signal.frame, signal.frame.confidence); }
    else if (command.signal.type === 'presence') { await this.emit(EventNames.VisionPresence, command, 'TRANSIENT', command.signal, command.signal.confidence); await this.deps.presence.submitEvidence({ kind: command.signal.state === 'absent' ? 'camera_absence' : 'camera_presence', confidence: command.signal.confidence, observedAt: command.signal.observedAt, sourceEventId: command.commandId, nodeId: command.nodeId }); }
    else if (command.signal.type === 'screen-context') await this.emit(EventNames.VisionScreenContext, command, 'TRANSIENT', command.signal.context, 1);
    else if(command.signal.type==='diagnostics')this.latestDiagnostics=command.signal.diagnostics;
    else {if(command.signal.type==='camera.lost'){this.latestDiagnostics=this.latestDiagnostics?{...this.latestDiagnostics,status:'offline',updatedAt:command.signal.observedAt}:undefined;const observedAt=command.signal.observedAt;this.listeners.forEach(listener=>listener({phase:'lost',monitorId:'primary',confidence:0,observedAt}));}await this.emit(command.signal.type === 'camera.lost' ? EventNames.VisionCameraLost : EventNames.VisionCameraRestored, command, 'OPERATIONAL', command.signal, 1);}
    return { accepted: true, observedAt: new Date().toISOString() };
  }
  private async emit(type: string, command: VisionEventCommand, retentionClass: 'TRANSIENT' | 'OPERATIONAL', payload: unknown, confidence: number) { await this.deps.events.emit({ type: type as never, retentionClass, privacyClass: 'SENSITIVE', subject: { kind: 'node', id: command.nodeId }, actor: { kind: 'node', id: command.nodeId }, correlationId: command.commandId, causationId: command.commandId, principalId: command.principalId, confidence, payload }); }
  private validate(command:VisionEventCommand){if(!visionCommandSchema.safeParse(command).success)throw new Error('invalid derived vision command');}
}
