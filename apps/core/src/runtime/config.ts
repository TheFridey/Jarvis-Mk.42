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
  voiceToken: string;
  visionToken: string;
  modelGatewayUrl: string;
  modelGatewayToken: string;
  modelCloudAllowed: boolean;
  /** True when a policy-permitted local model route exists. When false, a
   *  cognition request whose context contains RESTRICTED knowledge fails closed
   *  rather than routing (never downgraded to cloud). MK.46. */
  modelLocalRouteAvailable: boolean;

  /** MK.46 knowledge subsystems (ATLAS + MNEMOSYNE). */
  knowledge: {
    /** MNEMOSYNE recall weights (ADR-0023). `sim` is additionally hard-capped in
     *  `applyWeightBounds` so similarity alone cannot dominate. */
    recallWeights: {
      sim: number; entity: number; recency: number; importance: number;
      objective: number; confidence: number; sourceAuthority: number;
    };
    /** DREAMING (ADR-0022). */
    consolidation: {
      maxProposalsPerRun: number;
      episodeMergeSimilarity: number;
      semanticRepetitionThreshold: number;
      staleDays: number;
      insightSignificanceFloor: number;
      lookbackDays: number;
    };
    /** Observation -> fact promotion (ATLAS_MODEL.md §6). */
    promotion: { minCorroboration: number; minMeanConfidence: number };
  };

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
    voiceToken: env('JARVIS_VOICE_TOKEN', 'dev-voice-token'),
    visionToken: env('JARVIS_VISION_TOKEN', 'dev-vision-token'),
    modelGatewayUrl: env('JARVIS_MODEL_GATEWAY_URL', 'http://127.0.0.1:7430'),
    modelGatewayToken: env('JARVIS_GATEWAY_TOKEN', 'dev-gateway-token'),
    modelCloudAllowed: envBool('JARVIS_MODEL_CLOUD_ALLOWED', false),
    modelLocalRouteAvailable: envBool('JARVIS_MODEL_LOCAL_ROUTE', true),

    knowledge: {
      recallWeights: {
        sim: 0.20, entity: 0.20, recency: 0.15, importance: 0.15,
        objective: 0.10, confidence: 0.10, sourceAuthority: 0.10,
      },
      consolidation: {
        maxProposalsPerRun: envInt('JARVIS_CONSOLIDATION_MAX_PROPOSALS', 50),
        episodeMergeSimilarity: 0.92,
        semanticRepetitionThreshold: 3,
        staleDays: 30,
        insightSignificanceFloor: 0.6,
        lookbackDays: 14,
      },
      promotion: {
        minCorroboration: envInt('JARVIS_PROMOTION_MIN_CORROBORATION', 2),
        minMeanConfidence: 0.6,
      },
    },

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
