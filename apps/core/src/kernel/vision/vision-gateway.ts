import { timingSafeEqual } from 'node:crypto';
import { EventNames, type VisionDiagnostics, type VisionEventCommand, type VisionEventResponse, type VisionSignal } from '@jarvis/contracts';
import type { AirTouchFrame } from '@jarvis/scene';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { PresenceManager } from '../presence/presence-manager.ts';

export class VisionGateway {
  private readonly listeners = new Set<(frame: AirTouchFrame) => void>();
  private latestDiagnostics?: VisionDiagnostics;
  private latestSignal?: VisionSignal;
  constructor(private readonly deps: { events: EventManager; presence: PresenceManager; token: string; principalId: string }) {}
  authenticate(bearer: string | undefined) { if (!this.deps.token || !bearer?.startsWith('Bearer ')) return false; const supplied = Buffer.from(bearer.slice(7)); const expected = Buffer.from(this.deps.token); return supplied.length === expected.length && timingSafeEqual(supplied, expected); }
  authorises(principalId: string) { return principalId === this.deps.principalId; }
  subscribe(listener: (frame: AirTouchFrame) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  diagnostics() { return this.latestDiagnostics; }
  signal() { return this.latestSignal; }
  async handle(command: VisionEventCommand): Promise<VisionEventResponse> {
    this.validate(command);
    this.latestSignal = command.signal;
    if (command.signal.type === 'air-touch') { const signal = command.signal; this.latestDiagnostics = signal.diagnostics; this.listeners.forEach((listener) => listener(signal.frame)); await this.emit(EventNames.VisionAirTouch, command, 'TRANSIENT', signal.frame, signal.frame.confidence); }
    else if (command.signal.type === 'presence') { await this.emit(EventNames.VisionPresence, command, 'TRANSIENT', command.signal, command.signal.confidence); await this.deps.presence.submitEvidence({ kind: command.signal.state === 'absent' ? 'camera_absence' : 'camera_presence', confidence: command.signal.confidence, observedAt: command.signal.observedAt, sourceEventId: command.commandId, nodeId: command.nodeId }); }
    else if (command.signal.type === 'screen-context') await this.emit(EventNames.VisionScreenContext, command, 'TRANSIENT', command.signal.context, 1);
    else await this.emit(command.signal.type === 'camera.lost' ? EventNames.VisionCameraLost : EventNames.VisionCameraRestored, command, 'OPERATIONAL', command.signal, 1);
    return { accepted: true, observedAt: new Date().toISOString() };
  }
  private async emit(type: string, command: VisionEventCommand, retentionClass: 'TRANSIENT' | 'OPERATIONAL', payload: unknown, confidence: number) { await this.deps.events.emit({ type: type as never, retentionClass, privacyClass: 'SENSITIVE', subject: { kind: 'node', id: command.nodeId }, actor: { kind: 'node', id: command.nodeId }, correlationId: command.commandId, causationId: command.commandId, principalId: command.principalId, confidence, payload }); }
  private validate(command: VisionEventCommand) { if (!command || typeof command.commandId !== 'string' || typeof command.nodeId !== 'string' || typeof command.principalId !== 'string' || !command.signal || typeof command.signal.type !== 'string') throw new Error('invalid vision command'); const wire = JSON.stringify(command.signal); if (/"(?:pixels|rawFrame|imageData|base64|rgba)"\s*:/i.test(wire) || wire.length > 100_000) throw new Error('raw frame material is forbidden on the vision signal boundary'); if (command.signal.type === 'air-touch') { const frame = command.signal.frame; if (!Number.isFinite(frame.confidence) || frame.confidence < 0 || frame.confidence > 1 || (frame.point && (!Number.isFinite(frame.point.x) || !Number.isFinite(frame.point.y)))) throw new Error('invalid air-touch frame'); } }
}
