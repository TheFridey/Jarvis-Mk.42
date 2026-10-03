import { structuredLog, telemetryNodeId } from '@jarvis/telemetry';
import type { HealthStatus } from '@jarvis/contracts';

export type NatsFabricPhase = 'HEALTHY' | 'RECONNECTING' | 'SUSTAINED_OUTAGE' | 'RECOVERING';

export interface NatsFabricDiagnostics {
  phase: NatsFabricPhase;
  degradeAfterMs: number;
  outageStartedAt: string | null;
  graceDeadlineAt: string | null;
  lastConnectedAt: string | null;
  lastVerifiedAt: string | null;
  lastRelaySuccessAt: string | null;
  lastError: string | null;
  waitingForRelayEvidence: boolean;
}

/**
 * Owns the subsystem-level NATS/event-fabric state machine. PostgreSQL remains
 * authoritative while this coordinator delays global degradation for a short
 * reconnect window and requires real recovery evidence after a sustained loss.
 */
export class NatsFabricHealthCoordinator {
  private phase: NatsFabricPhase = 'RECOVERING';
  private outageStartedAt: string | null = null;
  private graceDeadlineAt: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastVerifiedAt: string | null = null;
  private lastRelaySuccessAt: string | null = null;
  private lastError: string | null = null;
  private waitingForRelayEvidence = false;
  private sustained = false;
  private stopped = false;
  private generation = 0;
  private graceTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private operation: Promise<void> = Promise.resolve();

  constructor(private readonly deps: {
    degradeAfterMs: number;
    nowMs: () => number;
    heartbeat: (subsystem: 'nats' | 'event-fabric', status: HealthStatus, message: string) => Promise<void>;
    verifyTransport: () => Promise<void>;
    releaseOutboxForRecovery: () => Promise<void>;
    pendingOutbox: () => Promise<number>;
    retryConnect: () => Promise<void>;
    reportError?: (message: string, error: unknown) => void;
  }) {
    if (!Number.isFinite(deps.degradeAfterMs) || deps.degradeAfterMs < 0) {
      throw new Error('NATS degradation grace must be a non-negative finite duration');
    }
  }

  transportUnavailable(detail: string, retryInitialConnection = false): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return;
      this.lastError = detail;
      if (!this.outageStartedAt) {
        const started = this.deps.nowMs();
        this.outageStartedAt = new Date(started).toISOString();
        this.graceDeadlineAt = new Date(started + this.deps.degradeAfterMs).toISOString();
        this.generation++;
      }
      if (!this.sustained) {
        this.phase = 'RECONNECTING';
        await this.safeHeartbeat('nats', 'RECOVERING', `reconnecting: ${detail}`);
        await this.safeHeartbeat('event-fabric', 'RECOVERING', 'transport reconnecting; PostgreSQL outbox remains authoritative');
        this.armGrace(this.generation);
      }
      if (retryInitialConnection) this.armRetry(this.generation);
    });
  }

  transportAvailable(detail: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return;
      this.clearRetry();
      this.phase = 'RECOVERING';
      this.lastConnectedAt = new Date(this.deps.nowMs()).toISOString();
      await this.safeHeartbeat('nats', 'RECOVERING', `connected; validating JetStream: ${detail}`);
      try {
        await this.deps.verifyTransport();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = `JetStream validation failed: ${message}`;
        this.reportError('NATS recovery validation failed', error);
        this.phase = this.sustained ? 'SUSTAINED_OUTAGE' : 'RECONNECTING';
        await this.safeHeartbeat('nats', this.sustained ? 'OFFLINE' : 'RECOVERING', this.lastError);
        if (this.sustained) await this.safeHeartbeat('event-fabric', 'DEGRADED', this.lastError);
        else this.armGrace(this.generation);
        this.armRetry(this.generation);
        return;
      }

      this.lastVerifiedAt = new Date(this.deps.nowMs()).toISOString();
      this.lastError = null;
      await this.safeHeartbeat('nats', 'HEALTHY', 'JetStream connection and stream topology verified');
      await this.deps.releaseOutboxForRecovery();
      const pending = await this.deps.pendingOutbox();
      if (this.sustained && pending > 0) {
        this.waitingForRelayEvidence = true;
        await this.safeHeartbeat('event-fabric', 'DEGRADED', `transport recovered; awaiting successful relay evidence (${pending} pending)`);
        return;
      }
      await this.markHealthy('transport verified; no relay backlog');
    });
  }

  relayHealthy(detail: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return;
      this.lastRelaySuccessAt = new Date(this.deps.nowMs()).toISOString();
      if (this.phase === 'RECOVERING' && this.lastVerifiedAt) await this.markHealthy(detail);
    });
  }

  relayDegraded(detail: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return;
      this.lastError = detail;
      if (this.sustained) await this.safeHeartbeat('event-fabric', 'DEGRADED', detail);
    });
  }

  diagnostics(): NatsFabricDiagnostics {
    return {
      phase: this.phase,
      degradeAfterMs: this.deps.degradeAfterMs,
      outageStartedAt: this.outageStartedAt,
      graceDeadlineAt: this.graceDeadlineAt,
      lastConnectedAt: this.lastConnectedAt,
      lastVerifiedAt: this.lastVerifiedAt,
      lastRelaySuccessAt: this.lastRelaySuccessAt,
      lastError: this.lastError,
      waitingForRelayEvidence: this.waitingForRelayEvidence,
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.generation++;
    this.clearGrace();
    this.clearRetry();
    await this.operation;
  }

  private armGrace(generation: number): void {
    if (this.graceTimer || this.sustained || this.stopped) return;
    const elapsed = this.outageStartedAt ? this.deps.nowMs() - Date.parse(this.outageStartedAt) : 0;
    const remaining = Math.max(0, this.deps.degradeAfterMs - elapsed);
    this.graceTimer = setTimeout(() => {
      this.graceTimer = undefined;
      void this.enqueue(async () => {
        if (this.stopped || generation !== this.generation || this.phase === 'HEALTHY') return;
        this.sustained = true;
        this.phase = 'SUSTAINED_OUTAGE';
        const duration = this.outageStartedAt ? Math.max(0, this.deps.nowMs() - Date.parse(this.outageStartedAt)) : this.deps.degradeAfterMs;
        await this.safeHeartbeat('nats', 'OFFLINE', `sustained outage (${duration}ms)`);
        await this.safeHeartbeat('event-fabric', 'DEGRADED', 'NATS outage exceeded grace period; durable outbox accumulating');
      });
    }, remaining);
  }

  private armRetry(generation: number): void {
    if (this.retryTimer || this.stopped) return;
    const retryAfterMs = Math.max(50, Math.min(1_000, Math.max(1, this.deps.degradeAfterMs / 2)));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.runGuarded('initial NATS reconnect attempt', async () => {
        if (this.stopped || generation !== this.generation || this.phase === 'HEALTHY') return;
        try {
          await this.deps.retryConnect();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.lastError = message;
          this.reportError('initial NATS reconnect attempt failed', error);
          this.armRetry(generation);
        }
      });
    }, retryAfterMs);
  }

  private async markHealthy(detail: string): Promise<void> {
    this.clearGrace();
    this.clearRetry();
    this.phase = 'HEALTHY';
    this.sustained = false;
    this.waitingForRelayEvidence = false;
    this.outageStartedAt = null;
    this.graceDeadlineAt = null;
    this.generation++;
    await this.safeHeartbeat('event-fabric', 'HEALTHY', detail);
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.operation.then(work, work);
    this.operation = next.catch((error) => this.reportError('NATS fabric health operation failed', error));
    return next;
  }

  private async runGuarded(label: string, work: () => Promise<void>): Promise<void> {
    try { await work(); } catch (error) { this.reportError(label, error); }
  }

  private async safeHeartbeat(subsystem: 'nats' | 'event-fabric', status: HealthStatus, message: string): Promise<void> {
    try {
      await this.deps.heartbeat(subsystem, status, message);
    } catch (error) {
      this.lastError = `${subsystem} health reconciliation failed: ${error instanceof Error ? error.message : String(error)}`;
      this.reportError(this.lastError, error);
    }
  }

  private reportError(message: string, error: unknown): void {
    this.deps.reportError?.(message, error);
    if (!this.deps.reportError) void structuredLog({component:'nats-fabric-health',node:telemetryNodeId(),event:'recovery.failed',severity:'ERROR'});
  }

  private clearGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }
}
