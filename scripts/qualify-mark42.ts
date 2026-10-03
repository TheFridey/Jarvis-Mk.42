/** Isolated qualification rig. Real Kernel/storage/transport; labelled HTTP model fixture. */
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { startEphemeralPg } from '../packages/testkit/src/index.ts';
import { createPg, runMigrations } from '../packages/persistence/src/index.ts';
import { buildKernel } from '../apps/core/src/kernel/lifecycle/kernel.ts';
import { loadConfig } from '../apps/core/src/runtime/config.ts';
import { ModelRegistry } from '../apps/gateway/src/registry.ts';
import { ModelGateway } from '../apps/gateway/src/gateway.ts';
import { OpenAICompatibleAdapter } from '../apps/gateway/src/adapters/openai-compatible.ts';
import type { ModelRegistration } from '../packages/contracts/src/index.ts';

if (process.env.JARVIS_TEST_DB_URL) throw new Error('Qualification requires disposable infrastructure, not an external database');
await mkdir('artifacts/mark42', { recursive: true });
let primaryDown = false;
const attempts: Array<{ model: string; at: number }> = [];
const provider = createServer(async (req, res) => {
  if (req.url === '/models') { res.setHeader('content-type', 'application/json'); res.end('{"data":[]}'); return; }
  if (req.method !== 'POST' || req.url !== '/chat/completions') { res.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) { res.writeHead(413).end(); return; } }
  const body = JSON.parse(raw); attempts.push({ model: body.model, at: performance.now() });
  if (primaryDown && body.model === 'qualification-primary') { res.writeHead(503).end('Controlled primary outage'); return; }
  const prompt = JSON.parse(body.messages[1].content);
  const correlationId = prompt.context.request.correlationId;
  // A visibly held, labelled fixture response lets the browser measure active
  // rendering. It is never reported as a model first-token measurement.
  await new Promise(resolve => setTimeout(resolve, JSON.stringify(prompt).includes('qualify renderer') ? 4000 : 350));
  const output = { proposals: [{ proposalId: randomUUID(), kind: 'answer', correlationId, confidence: 1, provenance: { method: 'model', producedBy: body.model, producedOn: 'qualification-fixture', producedAt: new Date().toISOString(), correlationId, derivedFromUntrusted: true }, text: `QUALIFICATION FIXTURE: ${body.model}. This is controlled output, not a live intelligence claim.`, citations: [] }] };
  if (body.model === 'qualification-engineering') Object.assign(output.proposals[0]!, { kind: 'plan', goal: 'QUALIFICATION FIXTURE: repository review plan; no change executed', steps: [] });
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
const address = provider.address(); if (!address || typeof address === 'string') throw new Error('Provider bind failed');
const registry = new ModelRegistry();
const adapter = new OpenAICompatibleAdapter('qualification-http', `http://127.0.0.1:${address.port}`);
const model = (id: string, tasks: ModelRegistration['tasks'], deep = false): ModelRegistration => ({ id, provider: adapter.provider, displayName: `FIXTURE / ${id}`, tasks, capabilities: ['json'], contextLimitUnits: 50000, costPerContextUnit: 0, costPerOutputUnit: 0, locality: 'local', enabled: true, registeredAt: new Date().toISOString(), ...(deep ? { reasoningDepth: 'deep' } : {}) });
registry.register(model('qualification-small', ['extract']), adapter);
registry.register(model('qualification-primary', ['reason'], true), adapter);
registry.register(model('qualification-fallback', ['reason']), adapter);
registry.register(model('qualification-engineering', ['code']), adapter);
const gateway = new ModelGateway(registry);
const container = await startEphemeralPg();
const pg = createPg({ url: container.url, statementTimeoutMs: 60000 });
await runMigrations(pg.sql);
const kernel = buildKernel(loadConfig({ dbUrl: container.url, natsEnabled: false, redisUrl: '', telemetryDisabled: true, diagnosticsPort: 7420, modeMinDwellMs: 1, modelCloudAllowed: false, modelLocalRouteAvailable: true }), { pg, forceInProcessBus: true, noScheduler: true, modelGateway: gateway });
const report: Record<string, unknown> = { observedAt: new Date().toISOString(), scope: 'Real Kernel + PostgreSQL + HTTP provider adapter + WebSocket. In-process event bus; all model output is a labelled fixture. No cloud access.', metrics: {}, scenarios: [] };
let ws: WebSocket | undefined;
async function save() { await writeFile('artifacts/mark42/runtime-qualification.json', JSON.stringify(report, null, 2)); }
async function close() { ws?.close(); await kernel.stop().catch(() => undefined); await pg.close().catch(() => undefined); await container.stop(); provider.close(); }
process.once('SIGINT', () => { void close().finally(() => process.exit()); });
process.once('SIGTERM', () => { void close().finally(() => process.exit()); });
try {
  await kernel.start();
  const auth = await fetch('http://127.0.0.1:7420/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: kernel.config.bootstrapCredential, nodeId: kernel.config.nodeId, scopes: ['desktop.read', 'desktop.write', 'experience.read'], surface: 'desktop' }) }).then(r => r.json()) as { accessToken: string; credential: { sessionId: string } };
  const headers = { authorization: `Bearer ${auth.accessToken}`, 'x-jarvis-node-id': kernel.config.nodeId, 'x-jarvis-session-id': auth.credential.sessionId, 'content-type': 'application/json' };
  const messages: Array<{ type: string; patch?: { stateVersion?: number }; at: number }> = [];
  ws = new WebSocket('ws://127.0.0.1:7420/experience/stream'); ws.on('message', raw => messages.push({ ...JSON.parse(String(raw)), at: performance.now() }));
  await new Promise<void>(resolve => ws!.once('open', resolve));
  ws.send(JSON.stringify({ type: 'experience.subscribe', schemaVersion: 1, accessToken: auth.accessToken, nodeId: kernel.config.nodeId, sessionId: auth.credential.sessionId, channels: ['system', 'cognition', 'agency', 'scene', 'telemetry', 'objectives', 'notifications'] }));
  async function until(predicate: () => boolean) { const end = Date.now() + 30000; while (!predicate()) { if (Date.now() > end) throw new Error('Qualification timeout'); await new Promise(resolve => setTimeout(resolve, 10)); } }
  await until(() => messages.some(m => m.type === 'experience.update'));
  const websocketMs: number[] = []; const snapshotMs: number[] = []; const dispatchMs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const mutation=await kernel.state.mutate({ key: 'active_context', value: { contextId: `qualification-${i}`, version: null }, expectedVersion: -1, actor: { kind: 'principal', id: kernel.config.bootstrapPrincipalId }, correlationId: randomUUID(), reason: 'Isolated qualification observation' });
    if(!mutation.ok)throw new Error(`Qualification mutation rejected: ${mutation.code}`);
    const version = (await kernel.state.view()).stateVersion;
    await until(() => messages.some(m => m.at >= started && m.patch?.stateVersion === version));
    websocketMs.push(messages.find(m => m.at >= started && m.patch?.stateVersion === version)!.at - started);
    const before = performance.now(); await fetch('http://127.0.0.1:7420/desktop/snapshot', { headers }).then(r => { if (!r.ok) throw new Error('Snapshot rejected'); return r.json(); }); snapshotMs.push(performance.now() - before);
  }
  for (const input of ['What is 2 + 2?', 'Reason deeply about recovery invariants', 'Review the repository architecture', 'Reason deeply about fallback']) {
    if (input.includes('fallback')) primaryDown = true;
    const picture = await fetch('http://127.0.0.1:7420/desktop/snapshot', { headers }).then(r => r.json());
    const started = performance.now(), count = attempts.length;
    const response = await fetch('http://127.0.0.1:7420/desktop/cognition', { method: 'POST', headers, body: JSON.stringify({ commandId: randomUUID(), expectedStateVersion: picture.stateVersion, input }) });
    const result = await response.json(); if (!response.ok) throw new Error(`Cognition rejected: ${response.status}`);
    dispatchMs.push(attempts[count]!.at - started);
    (report.scenarios as unknown[]).push({ input, modelId: result.modelId, agentId: result.result.agentId, totalMs: performance.now() - started, providerAttempts: attempts.slice(count).map(a => a.model) });
  }
  report.metrics = { websocketEventToProjectionMs: websocketMs, operatingPictureHttpMs: snapshotMs, httpCommandToProviderDispatchMs: dispatchMs, firstTokenMs: null, speechMs: null, airTouchMs: null, gpuLoad: null, memory: process.memoryUsage(), unavailableReason: 'Fixture adapter is non-streaming; physical speech, gestures and GPU utilisation were not exercised.' };
  await save();
  console.log('QUALIFICATION FIXTURE READY: real isolated Kernel http://127.0.0.1:7420; cloud disabled; artifacts/mark42/runtime-qualification.json');
  if (!process.argv.includes('--serve')) await close();
} catch (error) { report.failure = error instanceof Error ? error.message : String(error); await save(); await close(); throw error; }
