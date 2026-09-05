/**
 * Kernel configuration, resolved from the environment with safe local defaults.
 * No secrets are logged. The Kernel holds DB + NATS credentials; nothing else.
 */

export interface KernelConfig {
  instanceId: string;
  nodeId: string;
  version: string;

  dbUrl: string;
  redisUrl: string;
  natsUrl: string;

  /** Empty => NATS disabled, in-process bus only (dev/tests). */
  natsEnabled: boolean;

  otlpEndpoint: string;
  telemetryDisabled: boolean;

  diagnosticsPort: number;
  diagnosticsHost: string;
  /** Local desktop ingress bearer. Bind the ingress to loopback in development. */
  desktopToken: string;
  modelGatewayUrl: string;
  modelGatewayToken: string;

  /** Bootstrap operator credential (dev). Never logged. */
  bootstrapPrincipalId: string;
  bootstrapCredential: string;

  outboxPollMs: number;
  outboxMaxAttempts: number;
  snapshotEveryMs: number;
  modeMinDwellMs: number;
  retentionSweepMs: number;
}

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

export function loadConfig(overrides: Partial<KernelConfig> = {}): KernelConfig {
  const base: KernelConfig = {
    instanceId: env('JARVIS_INSTANCE_ID', `core-${process.pid}`),
    nodeId: env('JARVIS_NODE_ID', 'local-server'),
    version: env('JARVIS_VERSION', '0.43.0'),

    dbUrl: env('JARVIS_DB_URL', 'postgres://jarvis:jarvis@localhost:5433/jarvis'),
    redisUrl: env('JARVIS_REDIS_URL', 'redis://localhost:6380'),
    natsUrl: env('JARVIS_NATS_URL', 'nats://localhost:4222'),
    natsEnabled: envBool('JARVIS_NATS_ENABLED', true),

    otlpEndpoint: env('JARVIS_OTLP_ENDPOINT', 'http://localhost:4318/v1/traces'),
    telemetryDisabled: envBool('JARVIS_TELEMETRY_DISABLED', false),

    diagnosticsPort: envInt('JARVIS_DIAGNOSTICS_PORT', 7420),
    diagnosticsHost: env('JARVIS_DIAGNOSTICS_HOST', '127.0.0.1'),
    desktopToken: env('JARVIS_DESKTOP_TOKEN', 'dev-desktop-token'),
    modelGatewayUrl: env('JARVIS_MODEL_GATEWAY_URL', 'http://127.0.0.1:7430'),
    modelGatewayToken: env('JARVIS_GATEWAY_TOKEN', 'dev-gateway-token'),

    bootstrapPrincipalId: env('JARVIS_BOOTSTRAP_PRINCIPAL', 'principal-operator'),
    bootstrapCredential: env('JARVIS_BOOTSTRAP_CREDENTIAL', 'dev-bootstrap-secret'),

    outboxPollMs: envInt('JARVIS_OUTBOX_POLL_MS', 200),
    outboxMaxAttempts: envInt('JARVIS_OUTBOX_MAX_ATTEMPTS', 8),
    snapshotEveryMs: envInt('JARVIS_SNAPSHOT_MS', 60_000),
    modeMinDwellMs: envInt('JARVIS_MODE_MIN_DWELL_MS', 5_000),
    retentionSweepMs: envInt('JARVIS_RETENTION_SWEEP_MS', 3_600_000),
  };
  return { ...base, ...overrides };
}
