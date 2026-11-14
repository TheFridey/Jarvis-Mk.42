#!/usr/bin/env node
/**
 * Browser acceptance: a real Chrome, the real Presence interface, the real Kernel.
 *
 * Everything behind the socket is production composition: isolated PostgreSQL with real
 * migrations, real Kernel bootstrap, real auth, real conversation grant, real retrieval and
 * ContextCompiler, real Gateway and adapter. The only fixture is the provider, on loopback.
 *
 * The browser is driven through Chrome DevTools Protocol — typing into the actual input and
 * submitting the actual form, not posting to the endpoint by hand.
 */
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createPg } from '../packages/persistence/src/client.ts';
import { PersonalMemoryService } from '../apps/core/src/kernel/experience/personal-memory-service.ts';
import { PersonalMemoryStore } from '../apps/core/src/kernel/experience/personal-memory-store.ts';

const say = (line: string) => process.stdout.write(line + String.fromCharCode(10));
const PNPM = 'C:/Users/rhysl/AppData/Local/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EVIDENCE = 'docs/evidence/humanity-synapse/browser-journey.json';
const DB_NAME = `jarvis_browser_${Date.now().toString(36)}`;
const PRINCIPAL = 'synthetic-browser-owner';
const DECOY = 'synthetic-browser-decoy';
const GATEWAY_TOKEN = 'fixture-gateway-token';
const BOOTSTRAP = 'fixture-bootstrap-credential';
const MODEL = 'fixture-model';

const results: { name: string; passed: boolean; detail?: string }[] = [];
const check = (name: string, passed: boolean, detail?: string) => {
  results.push({ name, passed, ...(detail ? { detail } : {}) });
  say(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const providerBodies: string[] = [];
const provider = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    const path = request.url ?? '';
    if (path.includes('/key')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: { limit: 1, usage: 0, limit_remaining: 1 } })); return; }
    if (!path.includes('/chat/completions')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL }] })); return; }
    const body = Buffer.concat(chunks).toString('utf8');
    providerBodies.push(body);
    const normalized = body.split(String.fromCharCode(92) + '"').join('"');
    const id = [...normalized.matchAll(/"correlationId"\s*:\s*"([^"]+)"/g)].map(match => match[1]!).find(value => value !== 'correlationId') ?? 'corr';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'fixture', object: 'chat.completion', model: MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ proposals: [{ proposalId: `p-${Math.random().toString(36).slice(2, 9)}`, correlationId: id, confidence: 0.9, kind: 'answer', text: 'BROWSER-FIXTURE-ANSWER', citations: [], provenance: { method: 'model', producedBy: 'fixture', producedOn: 'fixture', producedAt: new Date().toISOString(), correlationId: id, derivedFromUntrusted: false } }], evidence: [] }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });
});

const children: ChildProcess[] = [];
const kill = (child?: ChildProcess) => { if (child?.pid) { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* best effort */ } } };

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

async function waitFor(url: string, attempts = 120): Promise<boolean> {
  for (let index = 0; index < attempts; index++) {
    try { const response = await fetch(url); if (response.ok) return true; } catch { /* not yet */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function run(command: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(process.execPath, [PNPM, ...command], { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  children.push(child);
  let stderr = '';
  child.stderr?.on('data', chunk => { if (stderr.length < 1500) stderr += String(chunk); });
  const code = await new Promise<number>(resolve => child.once('exit', value => resolve(value ?? 1)));
  if (code !== 0) say(`command failed (${command.join(' ')}): ${stderr.slice(0, 500)}`);
  return code;
}

// ---- minimal CDP client --------------------------------------------------------------------
class Cdp {
  private socket!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, (value: unknown) => void>();
  private events: ((method: string, params: unknown) => void)[] = [];
  async connect(url: string): Promise<void> {
    this.socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      this.socket.onopen = () => resolve();
      this.socket.onerror = event => reject(new Error(`cdp socket: ${String(event)}`));
    });
    this.socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; method?: string; params?: unknown };
      if (message.id && this.pending.has(message.id)) { this.pending.get(message.id)!(message.result); this.pending.delete(message.id); }
      if (message.method) for (const listener of this.events) listener(message.method, message.params);
    };
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise<T>(resolve => this.pending.set(id, value => resolve(value as T)));
  }
  on(listener: (method: string, params: unknown) => void): void { this.events.push(listener); }
  close(): void { try { this.socket.close(); } catch { /* closed */ } }
}

async function main(): Promise<void> {
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = (provider.address() as { port: number }).port;
  const gatewayPort = await freePort();
  const kernelPort = await freePort();
  const presencePort = await freePort();
  const debugPort = await freePort();

  const admin = createPg({ url: 'postgres://jarvis:jarvis@127.0.0.1:5433/postgres' });
  await admin.sql.unsafe(`create database ${DB_NAME}`);
  await admin.close();
  const dbUrl = `postgres://jarvis:jarvis@127.0.0.1:5433/${DB_NAME}`;
  const migrated = await run(['--filter', '@jarvis/persistence', 'db:migrate'], { JARVIS_DB_URL: dbUrl });
  if (migrated !== 0) throw new Error('migration failed');

  const client = createPg({ url: dbUrl });
  const service = new PersonalMemoryService(new PersonalMemoryStore(client.sql as never));
  const records = [
    { recordId: 'b-esports', category: 'history', subject: 'esports organisation', statement: 'SENTINEL-BROWSER-ESPORTS founded and ran an esports organisation.', privacyClass: 'INTERNAL' },
    { recordId: 'b-restaurant', category: 'history', subject: 'restaurant career', statement: 'SENTINEL-BROWSER-RESTAURANT ran a busy kitchen.', privacyClass: 'INTERNAL' },
    { recordId: 'b-streaming', category: 'history', subject: 'streaming career', statement: 'SENTINEL-BROWSER-STREAMING streamed competitively.', privacyClass: 'INTERNAL' },
    { recordId: 'b-sales', category: 'project', subject: 'sales pipeline', statement: 'SENTINEL-BROWSER-SALES rebuilding outreach.', privacyClass: 'INTERNAL' },
    { recordId: 'b-style', category: 'communication', subject: 'answer style', statement: 'SENTINEL-BROWSER-STYLE prefers concise answers.', privacyClass: 'INTERNAL' },
    { recordId: 'b-sensitive', category: 'constraint', subject: 'private arrangement', statement: 'SENTINEL-BROWSER-SENSITIVE local only.', privacyClass: 'SENSITIVE' },
    { recordId: 'b-noconsent', category: 'project', subject: 'unconsented project', statement: 'SENTINEL-BROWSER-NOCONSENT never authorised.', privacyClass: 'INTERNAL' },
  ];
  await service.importPack(PRINCIPAL, { schemaVersion: 1, records });
  for (const record of records) await service.approve(PRINCIPAL, record.recordId);
  for (const id of ['b-esports', 'b-restaurant', 'b-streaming', 'b-sales', 'b-style']) await service.grantCloud(PRINCIPAL, id);
  await service.importPack(DECOY, { schemaVersion: 1, records: [{ recordId: 'd', category: 'history', subject: 'other owner', statement: 'SENTINEL-BROWSER-DECOY belongs elsewhere.', privacyClass: 'INTERNAL' }] });
  await service.approve(DECOY, 'd');
  await service.grantCloud(DECOY, 'd');

  const gateway = spawn(process.execPath, [PNPM, '--filter', '@jarvis/gateway', 'exec', 'tsx', 'src/main.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, JARVIS_GATEWAY_PORT: String(gatewayPort), JARVIS_GATEWAY_HOST: '127.0.0.1', JARVIS_GATEWAY_TOKEN: GATEWAY_TOKEN, OPENROUTER_API_KEY: 'fixture-key', JARVIS_OPENROUTER_MODEL: MODEL, JARVIS_OPENROUTER_BASE_URL: `http://127.0.0.1:${providerPort}/v1`, JARVIS_ALLOW_PROVIDER_REDIRECT: '1', JARVIS_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  children.push(gateway);
  let gatewayErr = '';
  gateway.stderr?.on('data', chunk => { if (gatewayErr.length < 3000) gatewayErr += String(chunk); });
  const gatewayReady = await waitFor(`http://127.0.0.1:${gatewayPort}/health`);
  check('real gateway ready', gatewayReady, gatewayReady ? undefined : gatewayErr.slice(-600) || 'no stderr');

  const kernel = spawn(process.execPath, [PNPM, '--filter', '@jarvis/core', 'exec', 'tsx', 'src/main.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, JARVIS_DB_URL: dbUrl, JARVIS_DIAGNOSTICS_PORT: String(kernelPort), JARVIS_DIAGNOSTICS_HOST: '127.0.0.1', JARVIS_REDIS_URL: 'redis://127.0.0.1:6380', JARVIS_NATS_URL: 'nats://127.0.0.1:4222', JARVIS_MODEL_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`, JARVIS_GATEWAY_TOKEN: GATEWAY_TOKEN, JARVIS_BOOTSTRAP_PRINCIPAL: PRINCIPAL, JARVIS_BOOTSTRAP_CREDENTIAL: BOOTSTRAP, JARVIS_MODEL_CLOUD_ALLOWED: '1', JARVIS_PREFERRED_MODELS: MODEL, JARVIS_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  children.push(kernel);
  let kernelErr = '';
  kernel.stderr?.on('data', chunk => { if (kernelErr.length < 4000) kernelErr += String(chunk); });
  const kernelReady = await waitFor(`http://127.0.0.1:${kernelPort}/healthz`);
  check('real kernel ready', kernelReady, kernelReady ? undefined : (kernelErr.slice(-600) || gatewayErr.slice(-300) || 'no stderr'));
  if (!kernelReady) { process.exitCode = 1; return; }

  // The export is built against this run's kernel, exactly as a deployed build is.
  const built = await run(['build:desktop'], {
    NEXT_PUBLIC_JARVIS_CORE_URL: `http://127.0.0.1:${kernelPort}`,
    NEXT_PUBLIC_JARVIS_BOOTSTRAP_CREDENTIAL: BOOTSTRAP,
    NEXT_PUBLIC_JARVIS_NODE_ID: 'local-server',
  });
  check('static export built against the isolated kernel', built === 0);

  const serving = spawn(process.execPath, ['scripts/serve-export.mjs'], { cwd: process.cwd(), env: { ...process.env, JARVIS_DESKTOP_PORT: String(presencePort) }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  children.push(serving);
  check('presence served', await waitFor(`http://127.0.0.1:${presencePort}/?mode=presence`));

  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${process.cwd()}/.logs/chrome-browser-acceptance`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  children.push(chrome);
  const cdpReady = await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 60);
  check('browser started', cdpReady);
  if (!cdpReady) { process.exitCode = 1; return; }

  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json() as { webSocketDebuggerUrl: string };
  const cdp = new Cdp();
  await cdp.connect(version.webSocketDebuggerUrl);
  const target = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  const attached = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const session = attached.sessionId;
  await cdp.send('Page.enable', {}, session);
  await cdp.send('Runtime.enable', {}, session);

  const loaded = new Promise<void>(resolve => cdp.on(method => { if (method === 'Page.loadEventFired') resolve(); }));
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${presencePort}/?mode=presence` }, session);
  await Promise.race([loaded, new Promise(resolve => setTimeout(resolve, 20000))]);

  const evaluate = async <T>(expression: string): Promise<T> => {
    const result = await cdp.send<{ result: { value: T } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
    return result.result.value;
  };

  // Wait for the interface to be interactive before touching it.
  for (let index = 0; index < 60; index++) {
    if (await evaluate<boolean>("Boolean(document.querySelector('input[type=text], input:not([type])'))")) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  check('presence input rendered', await evaluate<boolean>("Boolean(document.querySelector('input'))"));

  const ask = async (text: string): Promise<{ answer: string; state: string }> => {
    const before = await evaluate<string>("(document.querySelector('.presence-answer') || {}).innerText || ''");
    await evaluate(`(() => {
      const input = document.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const form = input.closest('form');
      if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()`);
    let answer = '';
    let state = '';
    for (let index = 0; index < 90; index++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const snapshot = await evaluate<{ text: string; state: string }>(`(() => {
        const answerNode = document.querySelector('.presence-answer');
        const body = document.body.innerText || '';
        const stateWord = (body.match(/\\b(STANDBY|LISTENING|THINKING|SPEAKING|VERIFIED|DEGRADED|DISCONNECTED)\\b/) || [])[0] || '';
        return { text: answerNode ? answerNode.innerText : '', state: stateWord };
      })()`);
      answer = snapshot.text;
      state = snapshot.state;
      // Wait for a *new* answer: the previous turn's text must not be mistaken for this one's.
      if (answer.includes('BROWSER-FIXTURE-ANSWER') && answer !== before) break;
    }
    return { answer, state };
  };

  // A conversation has to exist before consent can attach to it: warm up first, then consent.
  await ask('Afternoon mate!');
  // Consent: the operator's own action, performed through the UI control.
  const consented = await evaluate<boolean>(`(async () => {
    const chip = [...document.querySelectorAll('button')].find(node => /allow cloud|cloud/i.test(node.textContent || ''));
    if (!chip) return false;
    chip.click();
    await new Promise(resolve => setTimeout(resolve, 800));
    return true;
  })()`);
  check('cloud consent control used', consented);

  providerBodies.length = 0;
  const career = await ask('Mate, tell me everything you know about my previous career.');
  const careerBody = providerBodies.at(-1) ?? '';
  check('browser request reached the provider', careerBody.length > 0, `${careerBody.length} bytes`);
  check('multiple career sentinels in the payload', ['SENTINEL-BROWSER-ESPORTS', 'SENTINEL-BROWSER-RESTAURANT', 'SENTINEL-BROWSER-STREAMING'].every(token => careerBody.includes(token)));
  check('protected sentinels absent', ['SENTINEL-BROWSER-SENSITIVE', 'SENTINEL-BROWSER-DECOY', 'SENTINEL-BROWSER-NOCONSENT'].every(token => !careerBody.includes(token)));
  check('answer rendered in the browser', career.answer.includes('BROWSER-FIXTURE-ANSWER'), career.answer.slice(0, 80));
  check('interface left THINKING', career.state !== 'THINKING', `state=${career.state || 'unknown'}`);

  const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, session);
  mkdirSync('docs/evidence/humanity-synapse', { recursive: true });
  writeFileSync('docs/evidence/humanity-synapse/browser-journey.png', Buffer.from(shot.data, 'base64'));

  providerBodies.length = 0;
  const general = await ask("What's the difference between ionic and covalent bonds?");
  const generalBody = providerBodies.at(-1) ?? '';
  check('general question sent', generalBody.length > 0);
  check('no personal memory on a general question', !generalBody.includes('Approved context about the owner'));
  check('second answer rendered', general.answer.includes('BROWSER-FIXTURE-ANSWER'));

  mkdirSync('docs/evidence/humanity-synapse', { recursive: true });
  writeFileSync(EVIDENCE, JSON.stringify({
    browser: 'Chrome headless via CDP; input typed into the real Presence form and submitted through it',
    components: { real: ['Chrome', 'Presence static export', 'frontend API client', 'kernel auth + grant + cognition', 'PostgreSQL', 'retrieval', 'ContextCompiler', 'AgentRuntime', 'Gateway', 'OpenAICompatibleAdapter'], substituted: ['provider (loopback fixture)'] },
    careerPayloadBytes: careerBody.length,
    generalPayloadBytes: generalBody.length,
    checks: results, passed: results.filter(entry => entry.passed).length, total: results.length,
    generatedAt: new Date().toISOString(),
  }, null, 2));
  say(`evidence: ${EVIDENCE} (${results.filter(entry => entry.passed).length}/${results.length})`);
  if (results.some(entry => !entry.passed)) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  say(`harness error: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  for (const child of children) kill(child);
  try { await new Promise<void>(resolve => provider.close(() => resolve())); } catch { /* closed */ }
  try { const admin = createPg({ url: 'postgres://jarvis:jarvis@127.0.0.1:5433/postgres' }); await admin.sql.unsafe(`drop database if exists ${DB_NAME} with (force)`); await admin.close(); } catch { /* leave */ }
}
