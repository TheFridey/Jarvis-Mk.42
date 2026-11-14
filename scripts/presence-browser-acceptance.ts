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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
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
const providerDisclosure: string[] = [];
const providerMaxTokens: number[] = [];
const provider = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    const path = request.url ?? '';
    if (path.includes('/key')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: { limit: 1, usage: 0, limit_remaining: 1 } })); return; }
    if (!path.includes('/chat/completions')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL }] })); return; }
    const body = Buffer.concat(chunks).toString('utf8');
    providerBodies.push(body);
    // The header the Kernel emitted, captured where it actually arrives: the provider's socket.
    providerDisclosure.push(String(request.headers['x-jarvis-memory-disclosure'] ?? 'ABSENT'));
    const tokenIndex = body.indexOf('"max_tokens"');
    providerMaxTokens.push(tokenIndex < 0 ? 0 : Number((body.slice(tokenIndex).match(/[0-9]+/) ?? ['0'])[0]));
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


// ---- isolation of the owner's export --------------------------------------------------------
const LIVE_EXPORT = 'apps/desktop/out';
const BACKUP = 'apps/desktop/out.owner-backup';
const ISOLATED = '.logs/browser-acceptance/export';
const hashOf = (path: string): string | null => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);

/** Take the owner's build out of the way, so nothing this run produces can be mistaken for it. */
function isolateOwnerExport(): string | null {
  if (existsSync(BACKUP)) throw new Error(`refusing to run: ${BACKUP} exists from an interrupted run; restore it first`);
  const before = hashOf(`${LIVE_EXPORT}/index.html`);
  if (existsSync(LIVE_EXPORT)) renameSync(LIVE_EXPORT, BACKUP);
  return before;
}

/** Move the test build somewhere the launcher will never look, then put the owner's back. */
function restoreOwnerExport(): { restored: boolean; unchanged: boolean; before: string | null; after: string | null } {
  if (existsSync(LIVE_EXPORT)) {
    mkdirSync('.logs/browser-acceptance', { recursive: true });
    rmSync(ISOLATED, { recursive: true, force: true });
    renameSync(LIVE_EXPORT, ISOLATED);
    writeFileSync(`${ISOLATED}/.acceptance-build`, JSON.stringify({ purpose: 'browser acceptance fixture build; never serve this as the owner build', generatedAt: new Date().toISOString() }));
  }
  let before: string | null = null;
  if (existsSync(BACKUP)) {
    renameSync(BACKUP, LIVE_EXPORT);
  }
  before = hashOf(`${LIVE_EXPORT}/index.html`);
  return { restored: existsSync(LIVE_EXPORT), unchanged: true, before, after: before };
}

const children: ChildProcess[] = [];
// A pre-built isolated export must survive its own build run: it is the input to the journey run.
const keepIsolated = process.env.JARVIS_ACCEPTANCE_BUILD_ONLY === '1' || process.env.JARVIS_ACCEPTANCE_SKIP_BUILD === '1';
const kill = (child?: ChildProcess) => { if (child?.pid) { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* best effort */ } } };

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

async function waitFor(url: string, attempts = 180): Promise<boolean> {
  for (let index = 0; index < attempts; index++) {
    try { const response = await fetch(url); if (response.ok) return true; } catch { /* not yet */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

const ROOT = process.cwd();
const TSX = `${ROOT}/node_modules/tsx/dist/cli.mjs`;
const NEXT = `${ROOT}/node_modules/next/dist/bin/next`;

async function run(args: string[], env: NodeJS.ProcessEnv, cwd = process.cwd()): Promise<number> {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  children.push(child);
  let stderr = '';
  child.stderr?.on('data', chunk => { if (stderr.length < 1500) stderr += String(chunk); });
  const code = await new Promise<number>(resolve => child.once('exit', value => resolve(value ?? 1)));
  if (code !== 0) say(`command failed (${args.join(' ')}): ${stderr.slice(0, 500)}`);
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
  // Fixed ports when the build is produced ahead of the journey, so a static export baked with
  // NEXT_PUBLIC values still points at the kernel that will serve it.
  const fixed = (name: string) => { const value = Number(process.env[name] ?? 0); return value > 0 ? value : 0; };
  const gatewayPort = fixed('JARVIS_ACCEPTANCE_GATEWAY_PORT') || await freePort();
  const kernelPort = fixed('JARVIS_ACCEPTANCE_KERNEL_PORT') || await freePort();
  const presencePort = fixed('JARVIS_ACCEPTANCE_PRESENCE_PORT') || await freePort();
  const debugPort = await freePort();

  const admin = createPg({ url: 'postgres://jarvis:jarvis@127.0.0.1:5433/postgres' });
  await admin.sql.unsafe(`create database ${DB_NAME}`);
  await admin.close();
  const dbUrl = `postgres://jarvis:jarvis@127.0.0.1:5433/${DB_NAME}`;
  if (process.env.JARVIS_ACCEPTANCE_BUILD_ONLY === '1') {
    const hashBefore = isolateOwnerExport();
    const built = await run([NEXT, 'build'], {
      NEXT_PUBLIC_JARVIS_CORE_URL: `http://127.0.0.1:${kernelPort}`,
      NEXT_PUBLIC_JARVIS_BOOTSTRAP_CREDENTIAL: BOOTSTRAP,
      NEXT_PUBLIC_JARVIS_NODE_ID: 'local-server',
    }, 'apps/desktop');
    const relocated = restoreOwnerExport();
    check('export rebuilt for the fixed kernel port', built === 0);
    check('owner export untouched by the pre-build', relocated.before === hashBefore);
    say(`isolated export at ${ISOLATED} for kernel port ${kernelPort}`);
    return;
  }

  const migrated = await run([TSX, 'src/migrate-cli.ts'], { JARVIS_DB_URL: dbUrl }, 'packages/persistence');
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

  const gateway = spawn(process.execPath, [TSX, 'apps/gateway/src/main.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, JARVIS_GATEWAY_PORT: String(gatewayPort), JARVIS_GATEWAY_HOST: '127.0.0.1', JARVIS_GATEWAY_TOKEN: GATEWAY_TOKEN, OPENROUTER_API_KEY: 'fixture-key', JARVIS_OPENROUTER_MODEL: MODEL, JARVIS_OPENROUTER_BASE_URL: `http://127.0.0.1:${providerPort}/v1`, JARVIS_ALLOW_PROVIDER_REDIRECT: '1', JARVIS_TELEMETRY_DISABLED: '1', JARVIS_TRACE_DISCLOSURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  children.push(gateway);
  let gatewayErr = '';
  gateway.stderr?.on('data', chunk => { const text = String(chunk); gatewayErr += text.slice(0, 4000 - gatewayErr.length); });
  const gatewayReady = await waitFor(`http://127.0.0.1:${gatewayPort}/health`);
  check('real gateway ready', gatewayReady, gatewayReady ? undefined : gatewayErr.slice(-600) || 'no stderr');

  const kernel = spawn(process.execPath, [TSX, 'apps/core/src/main.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, JARVIS_DB_URL: dbUrl, JARVIS_DIAGNOSTICS_PORT: String(kernelPort), JARVIS_DIAGNOSTICS_HOST: '127.0.0.1', JARVIS_REDIS_URL: 'redis://127.0.0.1:6380', JARVIS_NATS_URL: 'nats://127.0.0.1:4222', JARVIS_MODEL_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`, JARVIS_GATEWAY_TOKEN: GATEWAY_TOKEN, JARVIS_BOOTSTRAP_PRINCIPAL: PRINCIPAL, JARVIS_BOOTSTRAP_CREDENTIAL: BOOTSTRAP, JARVIS_MODEL_CLOUD_ALLOWED: '1', JARVIS_PREFERRED_MODELS: MODEL, JARVIS_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  children.push(kernel);
  let kernelErr = '';
  kernel.stderr?.on('data', chunk => { const text = String(chunk); if (process.env.JARVIS_ACCEPTANCE_VERBOSE === '1') say('KERNEL: ' + text.trim().slice(0, 200)); });
  kernel.stderr?.on('data', chunk => { if (kernelErr.length < 4000) kernelErr += String(chunk); });
  const kernelReady = await waitFor(`http://127.0.0.1:${kernelPort}/healthz`);
  check('real kernel ready', kernelReady, kernelReady ? undefined : (kernelErr.slice(-600) || gatewayErr.slice(-300) || 'no stderr'));
  if (!kernelReady) { process.exitCode = 1; return; }

  // The export is built against this run's kernel, exactly as a deployed build is — but never in
  // the directory the launcher serves. The owner's build is moved aside first and put back after.
  const ownerHashBefore = isolateOwnerExport();
  const built = process.env.JARVIS_ACCEPTANCE_SKIP_BUILD === '1'
    ? (existsSync(`${ISOLATED}/index.html`) ? 0 : 1)
    : await run([NEXT, 'build'], {
    NEXT_PUBLIC_JARVIS_CORE_URL: `http://127.0.0.1:${kernelPort}`,
    NEXT_PUBLIC_JARVIS_BOOTSTRAP_CREDENTIAL: BOOTSTRAP,
    NEXT_PUBLIC_JARVIS_NODE_ID: 'local-server',
  }, 'apps/desktop');
  check('static export built against the isolated kernel', built === 0);
  const relocated = process.env.JARVIS_ACCEPTANCE_SKIP_BUILD === '1' ? { restored: existsSync(LIVE_EXPORT), unchanged: true, before: hashOf(`${LIVE_EXPORT}/index.html`), after: null } : restoreOwnerExport();
  check('owner export restored untouched after the build', relocated.before === ownerHashBefore,
    relocated.before === ownerHashBefore ? 'hash unchanged' : 'HASH CHANGED — the live export was modified');

  const serving = spawn(process.execPath, ['scripts/serve-export.mjs'], { cwd: process.cwd(), env: { ...process.env, JARVIS_DESKTOP_PORT: String(presencePort), JARVIS_EXPORT_DIR: ISOLATED }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
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
  for (let index = 0; index < 40; index++) {
    if (await evaluate<boolean>("Boolean(document.querySelector('input[type=text], input:not([type])'))")) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  check('presence input rendered', await evaluate<boolean>("Boolean(document.querySelector('input'))"));

  const ask = async (text: string): Promise<{ answer: string; state: string }> => {
    // A new turn is proven by a new arrival at the provider, not by the answer text changing: the
    // fixture answers every turn identically, so text is not a clock.
    const baseline = providerBodies.length;
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
    for (let index = 0; index < 60; index++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const snapshot = await evaluate<{ text: string; state: string }>(`(() => {
        const answerNode = document.querySelector('.presence-answer');
        const body = document.body.innerText || '';
        const stateWord = (body.match(/\\b(STANDBY|LISTENING|THINKING|SPEAKING|VERIFIED|DEGRADED|DISCONNECTED)\\b/) || [])[0] || '';
        return { text: answerNode ? answerNode.innerText : '', state: stateWord };
      })()`);
      answer = snapshot.text;
      state = snapshot.state;
      if (providerBodies.length > baseline && answer.includes('BROWSER-FIXTURE-ANSWER')) break;
    }
    // The interface refuses a new command while it is thinking; wait for it to settle before the
    // next turn, otherwise the following submit is silently ignored and looks like a product failure.
    for (let index = 0; index < 40 && state === 'THINKING'; index++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      state = await evaluate<string>(`(() => {
        const body = document.body.innerText || '';
        return (body.match(/\b(STANDBY|LISTENING|THINKING|SPEAKING|VERIFIED|DEGRADED|DISCONNECTED)\b/) || [])[0] || '';
      })()`);
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

  // Consent is granted per command in this build, so the second question asks for it again through
  // the same control a person would use.
  const consentedAgain = await evaluate<boolean>(`(async () => {
    const chip = [...document.querySelectorAll('button')].find(node => /allow cloud|cloud/i.test(node.textContent || ''));
    if (!chip) return false;
    chip.click();
    await new Promise(resolve => setTimeout(resolve, 800));
    return true;
  })()`);
  say(consentedAgain ? 'consent control offered again for the second question' : 'consent already held; no control to click');

  providerBodies.length = 0;
  const general = await ask("What's the difference between ionic and covalent bonds?");
  const generalBody = providerBodies.at(-1) ?? '';
  if (generalBody.length === 0) say('UI after general question: ' + (await evaluate<string>('document.body.innerText')).slice(-400));
  check('general question sent', generalBody.length > 0);
  check('no personal memory on a general question', !generalBody.includes('Approved context about the owner'));
  check('second answer rendered', general.answer.includes('BROWSER-FIXTURE-ANSWER'));

  const ownerHashAfter = hashOf(`${LIVE_EXPORT}/index.html`);
  // The classification must be visible on the wire, not merely present in a struct.
  // The marker is Kernel-to-Gateway metadata; it is deliberately not forwarded to the provider (a
  // provider has no business knowing). So the proof is the Gateway's own receipt of it.
  // The allowance must arrive at the provider, not merely exist in a policy table.
  check('career turn asked for a deep allowance', (providerMaxTokens[0] ?? 0) >= 4096, `max_tokens=${providerMaxTokens[0]}`);
  check('general question asked for a smaller allowance', (providerMaxTokens[1] ?? 9999) <= 2048, `max_tokens=${providerMaxTokens[1]}`);

  const classified = (gatewayErr.match(/"disclosure":"(personal-memory|unprotected)"/g) ?? []);
  check('gateway received a personal-memory classification', classified.some(line => line.includes('personal-memory')), `observed: ${classified.join(',') || 'none'}`);
  // A later turn in the same conversation carries history, so it is personal too - that is the
  // policy, not an accident. What must never happen is a turn with a memory block arriving unmarked.
  check('every turn with history reached the gateway classified as personal', classified.length >= 2 && classified.every(line => line.includes('personal-memory')), `observed: ${classified.join(',') || 'none'}`);

  check('live desktop export byte-identical before and after the whole journey', ownerHashAfter === ownerHashBefore,
    `${ownerHashBefore ?? 'absent'} -> ${ownerHashAfter ?? 'absent'}`);
  check('no acceptance build left where the launcher looks', !existsSync(`${LIVE_EXPORT}/.acceptance-build`));

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
  // Cleanup must survive failure: the owner's export is restored even if the run threw.
  try {
    if (existsSync(LIVE_EXPORT) && existsSync(`${LIVE_EXPORT}/.acceptance-build`)) rmSync(LIVE_EXPORT, { recursive: true, force: true });
    if (!existsSync(LIVE_EXPORT) && existsSync(BACKUP)) renameSync(BACKUP, LIVE_EXPORT);
    if (!keepIsolated) rmSync(ISOLATED, { recursive: true, force: true });
  } catch { /* best effort; the next run refuses if a backup is left behind */ }
  try { await new Promise<void>(resolve => provider.close(() => resolve())); } catch { /* closed */ }
  try { const admin = createPg({ url: 'postgres://jarvis:jarvis@127.0.0.1:5433/postgres' }); await admin.sql.unsafe(`drop database if exists ${DB_NAME} with (force)`); await admin.close(); } catch { /* leave */ }
}
