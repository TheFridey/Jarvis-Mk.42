#!/usr/bin/env node
/**
 * Production-composition acceptance, synthetic end to end.
 *
 *   HTTP client (standing in for Presence) → real Kernel bootstrap → /auth/session → real
 *   /desktop/cognition → real memory repository (isolated PostgreSQL) → real retrieval intent and
 *   selection → real ContextCompiler → AgentRuntime → HttpModelGatewayClient → real Gateway process
 *   → real OpenAICompatibleAdapter → loopback mock provider (captured)
 *
 * The browser is the only substituted element: it would send the same HTTP request. Everything
 * behind the socket is the application's own composition, started the way the launcher starts it.
 *
 * Isolated database, isolated ports, synthetic principal, fixture credentials, no external calls.
 */
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPg } from '../packages/persistence/src/client.ts';
import { PersonalMemoryService } from '../apps/core/src/kernel/experience/personal-memory-service.ts';
import { PersonalMemoryStore } from '../apps/core/src/kernel/experience/personal-memory-store.ts';

const say = (line: string) => process.stdout.write(line + String.fromCharCode(10));
const PNPM = 'C:/Users/rhysl/AppData/Local/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs';
const EVIDENCE = 'docs/evidence/humanity-synapse/browser-provider-proof.json';
const DB_NAME = `jarvis_convergence_${Date.now().toString(36)}`;
const PRINCIPAL = 'synthetic-convergence-owner';
const DECOY = 'synthetic-other-owner';
const GATEWAY_TOKEN = 'fixture-gateway-token';
const BOOTSTRAP = 'fixture-bootstrap-credential';
const MODEL = 'fixture-model';

const providerCalls: string[] = [];
const results: { case: string; passed: boolean; detail?: string }[] = [];
const check = (name: string, passed: boolean, detail?: string) => {
  results.push({ case: name, passed, ...(detail ? { detail } : {}) });
  say(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const approval = (correlationId: string) => ({
  proposalId: `p-${Math.random().toString(36).slice(2, 10)}`, correlationId, confidence: 0.9, kind: 'answer', text: 'Noted.', citations: [],
  provenance: { method: 'model', producedBy: 'fixture', producedOn: 'fixture', producedAt: '2026-11-14T10:00:00.000Z', correlationId, derivedFromUntrusted: false },
});

const provider = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    const path = request.url ?? '';
    if (path.includes('/key')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: { limit: 1, usage: 0, limit_remaining: 1 } }));
      return;
    }
    if (!path.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }));
      return;
    }
    const body = Buffer.concat(chunks).toString('utf8');
    providerCalls.push(body);
    const firstCid = /"correlationId":"([^"]+)"/.exec(body)?.[1];
    if (!globalThis.__cidSeen) { globalThis.__cidSeen = true; say(`prompt correlationId: ${firstCid}`); }
    // The runtime rejects a proposal whose correlationId differs from the request's. The Kernel's
    // id is the command id, so prefer that shape over whatever trace id appears first.
    if (!globalThis.__cidPrinted) { globalThis.__cidPrinted = true; }
    if (!globalThis.__cidDumped) {
      globalThis.__cidDumped = true;
      const at = body.indexOf('correlationId');
      say(`cid context: ${body.slice(Math.max(0, at - 120), at + 240)}`);
    }
    // The prompt embeds the correlation id inside a JSON string, so the quotes arrive escaped.
    // Unescape first, then take the first real value (never the placeholder example name).
    const normalized = body.split(String.fromCharCode(92) + '"').join('"');
    const matches = [...normalized.matchAll(/"correlationId"\s*:\s*"([^"]+)"/g)].map(match => match[1]!);
    const correlationId = matches.find(value => value && value !== 'correlationId') ?? 'corr';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'fixture', object: 'chat.completion', model: MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ proposals: [approval(correlationId)], evidence: [] }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  if (!port) throw new Error('no loopback port');
  return port;
}

const children: ChildProcess[] = [];
const killTree = (child?: ChildProcess) => {
  if (child?.pid) { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* best effort */ } }
};

async function run(command: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(process.execPath, [PNPM, ...command], { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  children.push(child);
  let stderr = '';
  child.stderr?.on('data', chunk => { if (stderr.length < 2000) stderr += String(chunk); });
  const code = await new Promise<number>(resolve => child.once('exit', value => resolve(value ?? 1)));
  if (code !== 0) say(`command failed (${command.join(' ')}): ${stderr.slice(0, 600)}`);
  return code;
}

async function waitFor(url: string, attempts = 90): Promise<boolean> {
  for (let index = 0; index < attempts; index++) {
    try { const response = await fetch(url); if (response.ok) return true; } catch { /* not yet */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function main(): Promise<void> {
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = (provider.address() as { port: number }).port;
  const gatewayPort = await freePort();
  const kernelPort = await freePort();

  // ---- isolated database, real migrations ----------------------------------------------------
  const admin = createPg({ url: `postgres://jarvis:jarvis@127.0.0.1:5433/postgres` });
  await admin.sql.unsafe(`create database ${DB_NAME}`);
  await admin.close();
  const dbUrl = `postgres://jarvis:jarvis@127.0.0.1:5433/${DB_NAME}`;
  const migrated = await run(['--filter', '@jarvis/persistence', 'db:migrate'], { JARVIS_DB_URL: dbUrl });
  check('isolated database migrated with the real migrations', migrated === 0);

  // ---- synthetic profile ---------------------------------------------------------------------
  const client = createPg({ url: dbUrl });
  const service = new PersonalMemoryService(new PersonalMemoryStore(client.sql as never));
  const pack = {
    schemaVersion: 1,
    records: [
      { recordId: 'c-restaurant', category: 'history', subject: 'restaurant career', statement: 'SENTINEL-RESTAURANT ran a busy restaurant kitchen for years.', privacyClass: 'INTERNAL' },
      { recordId: 'c-streaming', category: 'history', subject: 'streaming career', statement: 'SENTINEL-STREAMING streamed competitive games for two years.', privacyClass: 'INTERNAL' },
      { recordId: 'c-esports', category: 'history', subject: 'esports organisation', statement: 'SENTINEL-ESPORTS founded and ran an esports organisation.', privacyClass: 'INTERNAL' },
      { recordId: 'c-software', category: 'business', subject: 'software business', statement: 'SENTINEL-SOFTWARE now builds and sells software products.', privacyClass: 'INTERNAL' },
      { recordId: 'p-sales', category: 'project', subject: 'sales pipeline', statement: 'SENTINEL-SALES rebuilding outreach around repeatable steps.', privacyClass: 'INTERNAL' },
      { recordId: 'p-tender', category: 'project', subject: 'procurement bid', statement: 'SENTINEL-TENDER submitted a public-sector tender.', privacyClass: 'INTERNAL' },
      { recordId: 'p-tooling', category: 'project', subject: 'delivery tooling', statement: 'SENTINEL-TOOLING building internal delivery tooling.', privacyClass: 'INTERNAL' },
      { recordId: 'm-client', category: 'milestone', subject: 'first client', statement: 'SENTINEL-MILESTONE delivered the first paid client deployment.', privacyClass: 'INTERNAL' },
      { recordId: 'a-lab', category: 'ambition', subject: 'research lab', statement: 'SENTINEL-AMBITION wants a self-sustaining R&D operation.', privacyClass: 'INTERNAL' },
      { recordId: 'k-style', category: 'communication', subject: 'answer style', statement: 'SENTINEL-STYLE prefers concise answers unless detail is asked for.', privacyClass: 'INTERNAL' },
      { recordId: 'i-music', category: 'interest', subject: 'eighties music', statement: 'SENTINEL-MUSIC enjoys eighties British pop.', privacyClass: 'INTERNAL' },
      { recordId: 'x-sensitive', category: 'constraint', subject: 'private arrangement', statement: 'SENTINEL-SENSITIVE a local-only arrangement.', privacyClass: 'SENSITIVE' },
      { recordId: 'x-restricted', category: 'business', subject: 'restricted terms', statement: 'SENTINEL-RESTRICTED contract terms.', privacyClass: 'RESTRICTED' },
      { recordId: 'x-noconsent', category: 'project', subject: 'unconsented project', statement: 'SENTINEL-NOCONSENT a project never authorised for cloud.', privacyClass: 'INTERNAL' },
      { recordId: 'x-revoked', category: 'history', subject: 'revoked note', statement: 'SENTINEL-REVOKED an old note.', privacyClass: 'INTERNAL' },
    ],
  };
  await service.importPack(PRINCIPAL, pack);
  for (const id of ['c-restaurant', 'c-streaming', 'c-esports', 'c-software', 'p-sales', 'p-tender', 'p-tooling', 'm-client', 'a-lab', 'k-style', 'i-music', 'x-sensitive', 'x-restricted', 'x-noconsent', 'x-revoked']) {
    await service.approve(PRINCIPAL, id);
  }
  for (const id of ['c-restaurant', 'c-streaming', 'c-esports', 'c-software', 'p-sales', 'p-tender', 'p-tooling', 'm-client', 'a-lab', 'k-style', 'i-music', 'x-revoked']) {
    await service.grantCloud(PRINCIPAL, id);
  }
  await service.revokeUse(PRINCIPAL, 'x-revoked');
  await service.importPack(DECOY, { schemaVersion: 1, records: [{ recordId: 'z-decoy', category: 'history', subject: 'other principal', statement: 'SENTINEL-DECOY belongs to someone else.', privacyClass: 'INTERNAL' }] });
  await service.approve(DECOY, 'z-decoy');
  await service.grantCloud(DECOY, 'z-decoy');
  const active = await service.active(PRINCIPAL);
  check('synthetic repository holds the profile', active.length === 14, `${active.length} active`);

  // ---- real gateway and kernel ----------------------------------------------------------------
  const gateway = spawn(process.execPath, [PNPM, '--filter', '@jarvis/gateway', 'exec', 'tsx', 'src/main.ts'], {
    cwd: process.cwd(), env: {
      ...process.env,
      JARVIS_GATEWAY_PORT: String(gatewayPort), JARVIS_GATEWAY_HOST: '127.0.0.1', JARVIS_GATEWAY_TOKEN: GATEWAY_TOKEN,
      OPENROUTER_API_KEY: 'fixture-key', JARVIS_OPENROUTER_MODEL: MODEL,
      JARVIS_OPENROUTER_BASE_URL: `http://127.0.0.1:${providerPort}/v1`, JARVIS_ALLOW_PROVIDER_REDIRECT: '1',
      JARVIS_TELEMETRY_DISABLED: '1',
    }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  children.push(gateway);
  check('real gateway started on an isolated port', await waitFor(`http://127.0.0.1:${gatewayPort}/health`));

  const kernel = spawn(process.execPath, [PNPM, '--filter', '@jarvis/core', 'exec', 'tsx', 'src/main.ts'], {
    cwd: process.cwd(), env: {
      ...process.env,
      JARVIS_DB_URL: dbUrl, JARVIS_DIAGNOSTICS_PORT: String(kernelPort), JARVIS_DIAGNOSTICS_HOST: '127.0.0.1',
      // Explicit loopback: `localhost` resolves to ::1 on this host and hangs against Docker's publish.
      JARVIS_REDIS_URL: 'redis://127.0.0.1:6380', JARVIS_NATS_URL: 'nats://127.0.0.1:4222',
      JARVIS_MODEL_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`, JARVIS_GATEWAY_TOKEN: GATEWAY_TOKEN,
      JARVIS_BOOTSTRAP_PRINCIPAL: PRINCIPAL, JARVIS_BOOTSTRAP_CREDENTIAL: BOOTSTRAP,
      JARVIS_MODEL_CLOUD_ALLOWED: '1', JARVIS_PREFERRED_MODELS: MODEL, JARVIS_MEMORY_TRACE: '1',
      JARVIS_TELEMETRY_DISABLED: '1',
    }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  children.push(kernel);
  let kernelStderr = '';
  kernel.stderr?.on('data', chunk => { if (kernelStderr.length < 60000) kernelStderr += String(chunk); });
  const kernelReady = await waitFor(`http://127.0.0.1:${kernelPort}/healthz`);
  check('real kernel started from production bootstrap', kernelReady, kernelReady ? undefined : kernelStderr.slice(0, 300));
  // A startup timing failure must fail the run, not exit 0 before the summary is written.
  if (!kernelReady) { process.exitCode = 1; return; }

  const registry = await client.sql<{ principal_id: string }[]>`select principal_id from nodes.registry`;
  check('kernel registered under the synthetic principal', registry.some(row => row.principal_id === PRINCIPAL), registry.map(row => row.principal_id).join(','));

  const authResponse = await fetch(`http://127.0.0.1:${kernelPort}/auth/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: BOOTSTRAP, nodeId: 'local-server', scopes: ['desktop.read', 'desktop.write', 'experience.read'] }),
  });
  const auth = await authResponse.json() as { accessToken?: string };
  const token = auth.accessToken;
  check('authenticated desktop session issued', Boolean(token), `status ${authResponse.status}`);

  let stateVersion = 0;
  // The server reports a mismatch as {error:'state_version_conflict', currentStateVersion}. Treat
  // that as a version hint and retry once, exactly as the desktop client does.
  const conflictVersion = (result: Record<string, unknown>): number | null =>
    (result.error === 'state_version_conflict' || result.code === 'state_version_conflict') ? Number(result.currentStateVersion ?? 0) : null;
  const post = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`http://127.0.0.1:${kernelPort}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-jarvis-node-id': 'local-server' }, body: JSON.stringify(body),
    });
    return await response.json() as Record<string, unknown>;
  };

  const conversationId = `conv-${Date.now().toString(36)}`;
  let grant = await post('/desktop/conversations/grant', { commandId: `grant-${Date.now()}`, expectedStateVersion: stateVersion, conversationId, provider: 'openrouter', model: MODEL, ceiling: 'INTERNAL' });
  const grantConflict = conflictVersion(grant);
  if (grantConflict !== null) {
    stateVersion = grantConflict;
    grant = await post('/desktop/conversations/grant', { commandId: `grant2-${Date.now()}`, expectedStateVersion: stateVersion, conversationId, provider: 'openrouter', model: MODEL, ceiling: 'INTERNAL' });
  }
  check('conversation cloud grant issued by the Kernel', grant.ok !== false && !('error' in grant), JSON.stringify(grant).slice(0, 220));

  const ask = async (input: string) => {
    providerCalls.length = 0;
    let result = await post('/desktop/cognition', { commandId: `ask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, expectedStateVersion: stateVersion, input, conversationId, task: 'reason', agentId: 'agents.oracle', locality: 'cloud-ok', preferredModels: [MODEL] });
    const askConflict = conflictVersion(result);
    if (askConflict !== null) {
      stateVersion = askConflict;
      result = await post('/desktop/cognition', { commandId: `ask2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, expectedStateVersion: stateVersion, input, conversationId, task: 'reason', agentId: 'agents.oracle', locality: 'cloud-ok', preferredModels: [MODEL] });
    }
    return { result, body: providerCalls.at(-1) ?? '' };
  };

  const cases: { name: string; input: string; present: string[]; absent: string[] }[] = [
    { name: 'career history reaches the provider', input: 'Mate, tell me everything you know about my previous career.', present: ['SENTINEL-RESTAURANT', 'SENTINEL-ESPORTS'], absent: ['SENTINEL-DECOY', 'SENTINEL-SENSITIVE', 'SENTINEL-RESTRICTED', 'SENTINEL-REVOKED'] },
    { name: 'project inventory reaches the provider', input: 'Right, business mode. What projects are we currently working on?', present: ['SENTINEL-SALES', 'SENTINEL-TENDER', 'SENTINEL-TOOLING'], absent: ['SENTINEL-DECOY', 'SENTINEL-NOCONSENT'] },
    { name: 'profile overview spans categories', input: 'What do you actually know about me?', present: ['SENTINEL-AMBITION', 'SENTINEL-STYLE'], absent: ['SENTINEL-SENSITIVE', 'SENTINEL-RESTRICTED', 'SENTINEL-DECOY'] },
    { name: 'encouragement is grounded in records', input: 'Give me a proper hype session, mate. Go deep.', present: ['SENTINEL-MILESTONE'], absent: ['SENTINEL-SENSITIVE', 'SENTINEL-DECOY'] },
    { name: 'general knowledge carries no personal context', input: "What's the difference between ionic and covalent bonds?", present: [], absent: ['SENTINEL-RESTAURANT', 'SENTINEL-ESPORTS', 'SENTINEL-STYLE', 'SENTINEL-DECOY'] },
    { name: 'greeting carries no autobiography', input: 'Afternoon mate!', present: [], absent: ['SENTINEL-RESTAURANT', 'SENTINEL-MILESTONE', 'SENTINEL-DECOY'] },
  ];

  for (const entry of cases) {
    const { result, body } = await ask(entry.input);
    const ok = result.ok !== false && !('error' in result);
    const missing = entry.present.filter(token => !body.includes(token));
    const leaked = entry.absent.filter(token => body.includes(token));
    check(entry.name, ok && missing.length === 0 && leaked.length === 0,
      `${ok ? '' : `kernel=${JSON.stringify(result).slice(0, 120)} `}missing=[${missing.join(',')}] leaked=[${leaked.join(',')}] bytes=${body.length}`);
  }

  const summary = { cases: results, providerBodies: providerCalls.length, passed: results.filter(entry => entry.passed).length, total: results.length, generatedAt: new Date().toISOString(),
    composition: { real: ['Kernel bootstrap', 'HTTP auth', 'desktop cognition route', 'memory repository (isolated PostgreSQL)', 'retrieval intent', 'ContextCompiler', 'AgentRuntime', 'gateway client', 'Gateway process', 'OpenAICompatibleAdapter'], substituted: ['browser → HTTP client', 'provider → loopback fixture'], database: DB_NAME } };
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, JSON.stringify(summary, null, 2));
  if (results.some(entry => !entry.passed)) {
    const failures = kernelStderr.split(String.fromCharCode(10)).filter(line => line.includes('request.failed'));
    say(`kernel failures: ${failures.slice(0, 3).join(String.fromCharCode(10))}`);
  }
  say(`evidence: ${EVIDENCE} (${summary.passed}/${summary.total})`);
  if (summary.passed < summary.total) process.exitCode = 1;
}

try {
  await main();
} finally {
  for (const child of children) killTree(child);
  try { await new Promise<void>(resolve => provider.close(() => resolve())); } catch { /* closed */ }
  try {
    const admin = createPg({ url: 'postgres://jarvis:jarvis@127.0.0.1:5433/postgres' });
    await admin.sql.unsafe(`drop database if exists ${DB_NAME} with (force)`);
    await admin.close();
  } catch { /* leave it */ }
  try { rmSync(`${process.cwd()}/.logs/convergence`, { recursive: true, force: true }); } catch { /* nothing */ }
}
