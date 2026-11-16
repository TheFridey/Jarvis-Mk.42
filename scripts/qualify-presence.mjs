#!/usr/bin/env node
/**
 * Presence qualification: measure the real browser, not a simulated one.
 *
 * It serves the production export, launches the *system* Chrome with GPU
 * acceleration left alone (no --disable-gpu, no SwiftShader flag), drives it over
 * the DevTools Protocol and records what the machine actually did:
 *
 *   - the WebGL renderer string, so hardware acceleration is provable rather
 *     than assumed;
 *   - requestAnimationFrame frame times (mean, p50, p95, p99, drops) while idle
 *     and while a workflow fixture is animating;
 *   - JS heap use from the browser's own counters;
 *   - command-centre ↔ presence switch latency;
 *   - the reduced-motion path, via a real media emulation;
 *   - keystroke-to-frame latency for the presence input.
 *
 * Everything it prints is measured. If a measurement is unavailable it says so
 * and omits the number instead of inventing one. A headless or software renderer
 * is reported as NOT hardware-qualified.
 *
 * Usage:
 *   node scripts/qualify-presence.mjs                     # headful, real GPU
 *   node scripts/qualify-presence.mjs --headless          # headless (usually software)
 *   node scripts/qualify-presence.mjs --scenario approval --frames 300
 *   node scripts/qualify-presence.mjs --url http://127.0.0.1:4320/index.html
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };

const ROOT = resolve('.');
const OUT = join(ROOT, 'apps/desktop/out');
const FRAMES = Number(option('frames', '240'));
const SCENARIO = option('scenario', 'ambient');
/** Hydration + auth + first operating picture can exceed 4s on a loaded host. */
const SETTLE = Number(option('settle', '4000'));
const PORT = Number(option('port', '4390'));
const CDP_PORT = Number(option('cdpPort', '9333'));
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };

function fail(message) { console.error(`qualify: ${message}`); process.exitCode = 1; }

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate;
  throw new Error('No system Chrome or Edge found. Install one, or pass --url with an externally served build.');
}

async function serve(root, port) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const file = join(root, path === '/' ? 'index.html' : path);
    if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      try { response.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(join(root, 'index.html'))); }
      catch { response.writeHead(404).end(); }
    }
  });
  await new Promise(done => server.listen(port, '127.0.0.1', done));
  return server;
}

class Cdp {
  #socket; #id = 0; #pending = new Map(); #events = new Map();
  static async attach(webSocketDebuggerUrl) {
    const client = new Cdp();
    client.#socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((ready, failed) => {
      client.#socket.addEventListener('open', ready, { once: true });
      client.#socket.addEventListener('error', () => failed(new Error('CDP socket failed')), { once: true });
    });
    client.#socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && client.#pending.has(message.id)) {
        const { resolve: done, reject } = client.#pending.get(message.id);
        client.#pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : done(message.result);
      } else if (message.method) {
        for (const listener of client.#events.get(message.method) ?? []) listener(message.params);
      }
    });
    return client;
  }
  send(method, params = {}) {
    const id = ++this.#id;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((done, reject) => this.#pending.set(id, { resolve: done, reject }));
  }
  once(method) { return new Promise(done => { const listener = params => { this.#events.set(method, (this.#events.get(method) ?? []).filter(entry => entry !== listener)); done(params); }; this.#events.set(method, [...(this.#events.get(method) ?? []), listener]); }); }
  close() { this.#socket.close(); }
}

/** Runs inside the page; returns only measurements the browser actually produced. */
const MEASURE = `async ({ frames }) => {
  const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
  let renderer = 'unavailable', vendor = 'unavailable', unmasked = false;
  if (gl) {
    vendor = String(gl.getParameter(gl.VENDOR));
    renderer = String(gl.getParameter(gl.RENDERER));
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    if (debug) { unmasked = true; vendor = String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)); renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)); }
  }
  const sample = async count => new Promise(done => {
    const times = []; let last = performance.now(); let painted = 0;
    const step = now => { times.push(now - last); last = now; painted++; if (painted < count) requestAnimationFrame(step); else done(times); };
    requestAnimationFrame(step);
  });
  const stats = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    return { samples: values.length, meanMs: +mean.toFixed(2), p50Ms: +at(.5).toFixed(2), p95Ms: +at(.95).toFixed(2), p99Ms: +at(.99).toFixed(2), maxMs: +Math.max(...values).toFixed(2), fps: +(1000 / mean).toFixed(1), over33ms: values.filter(v => v > 33.4).length };
  };
  const idle = stats((await sample(frames)).slice(2));
  const heap = performance.memory ? { jsHeapUsedMiB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), jsHeapTotalMiB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1) } : null;
  // Switch to the command centre and back, timing each repaint.
  const layer = () => document.querySelector('.presence-layer');
  const switchTo = key => new Promise(done => {
    const start = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now() - start)));
  });
  const toCommand = await switchTo('c');
  const commandVisible = Boolean(document.querySelector('.command-deck'));
  const toPresence = await switchTo('p');
  const presenceVisible = Boolean(layer());
  // Second pass: separates first-use shader compilation from steady-state cost.
  const toCommandWarm = await switchTo('c');
  const toPresenceWarm = await switchTo('p');
  // Keystroke latency: focus the presence input, type, and wait for the painted frame.
  const input = document.querySelector('.presence-input input');
  let keystrokeMs = null;
  if (input) {
    input.focus();
    const start = performance.now();
    input.value = 'q';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    keystrokeMs = await new Promise(done => requestAnimationFrame(() => done(+(performance.now() - start).toFixed(2))));
  }
  return {
    webgl: { vendor, renderer, unmasked },
    idle, heap, toCommandMs: +toCommand.toFixed(1), toPresenceMs: +toPresence.toFixed(1),
    toCommandWarmMs: +toCommandWarm.toFixed(1), toPresenceWarmMs: +toPresenceWarm.toFixed(1),
    commandVisible, presenceVisible, keystrokeMs,
    devicePixelRatio: window.devicePixelRatio, viewport: { width: innerWidth, height: innerHeight },
    presenceState: layer()?.getAttribute('data-presence-state') ?? null,
    renderer: document.querySelector('.gpu-environment')?.getAttribute('data-renderer') ?? null,
  };
}`;

async function main() {
  if (!existsSync(join(OUT, 'index.html'))) { fail(`no built export at ${OUT}. Run: pnpm --filter @jarvis/desktop build`); return; }
  const url = option('url');
  const server = url ? null : await serve(OUT, PORT);
  const target = url ?? `http://127.0.0.1:${PORT}/index.html?scenario=${encodeURIComponent(SCENARIO)}`;
  const chrome = await findChrome();
  const profile = join(tmpdir(), `jarvis-qualify-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const browser = spawn(chrome, [
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1856,900', '--window-position=0,0', '--autoplay-policy=no-user-gesture-required',
    ...(flag('headless') ? ['--headless=new'] : []),
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  const cleanup = async () => { try { browser.kill(); } catch { /* already gone */ } if (server) await new Promise(done => server.close(done)); };
  try {
    let version;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; } catch { await new Promise(done => setTimeout(done, 250)); }
    }
    if (!version) throw new Error('Chrome did not expose the DevTools endpoint');
    const created = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
    const cdp = await Cdp.attach(created.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // Navigate from the attached context so the execution context is never
    // replaced underneath an in-flight evaluation.
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: target });
    await Promise.race([loaded, new Promise(done => setTimeout(done, 15000))]);
    await new Promise(done => setTimeout(done, SETTLE));
    const evaluate = async expression => {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluation failed');
          return result.result.value;
        } catch (error) {
          // A navigation can still replace the context while the export hydrates.
          if (attempt < 3 && /context was destroyed|Cannot find context/i.test(String(error))) { await new Promise(done => setTimeout(done, 1200)); continue; }
          throw error;
        }
      }
    };
    // Evidence hygiene: a live Kernel can push real business content into the
    // response surface. Dismissing it keeps the capture about the interface.
    let dismissedAnswer;
    if (flag('dismiss-answer')) {
      const dismissed = await cdp.send('Runtime.evaluate', {
        // Remove the surface outright: a live Kernel can repopulate it mid-capture,
        // and an evidence image must not carry business records.
        expression: `(() => { const nodes = document.querySelectorAll('.presence-answer'); const had = nodes.length > 0; nodes.forEach(node => node.remove()); return had; })()`,
        returnByValue: true,
      });
      dismissedAnswer = Boolean(dismissed?.result?.value);
      await new Promise(done => setTimeout(done, 1200));
    }
    const base = await evaluate(`(${MEASURE})(${JSON.stringify({ frames: FRAMES })})`);
    // Reduced motion: a real emulated media feature, then re-measure idle.
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await new Promise(done => setTimeout(done, 1200));
    const reduced = await evaluate(`new Promise(done => { const t=[]; let last=performance.now(), n=0; const step=now=>{ t.push(now-last); last=now; if(++n<60) requestAnimationFrame(step); else done(t); }; requestAnimationFrame(step); }).then(v => { const s=v.slice(2); return { frames:s.length, meanMs:+(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2) }; })`);
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    const software = /swiftshader|llvmpipe|software|basic render/i.test(base.webgl.renderer);
    const report = {
      tool: 'qualify-presence.mjs', measuredAt: new Date().toISOString(), target, scenario: SCENARIO, headless: flag('headless'),
      browser: version.Browser, userAgent: version['User-Agent'],
      hardwareAccelerated: base.webgl.unmasked ? !software : null,
      ...base, reducedMotionIdle: reduced,
      ...(dismissedAnswer !== undefined ? { dismissedAnswer } : {}),
      caveats: [
        'Hardware acceleration is inferred from the unmasked WebGL renderer string; it is not a driver-level audit.',
        ...(software ? ['Renderer string indicates software rasterisation: treat these numbers as a floor, not GPU performance.'] : []),
        ...(base.heap ? [] : ['JS heap metrics unavailable in this browser build.']),
        'Disconnect/reconnect was not forced: it requires a live Kernel to interrupt.',
      ],
    };
    if (flag('screenshot')) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const evidenceDir = join(ROOT, 'docs/evidence/sentience-awakening');
      await mkdir(evidenceDir, { recursive: true });
      const shotFile = join(evidenceDir, `gpu-${SCENARIO}-${flag('headless') ? 'headless' : 'headful'}.png`);
      await writeFile(shotFile, Buffer.from(shot.data, 'base64'));
      report.screenshot = shotFile;
    }
    const evidence = join(ROOT, 'docs/evidence/sentience-awakening');
    await mkdir(evidence, { recursive: true });
    const file = join(evidence, `qualification-${flag('headless') ? 'headless' : 'gpu'}-${Date.now()}.json`);
    await writeFile(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ hardwareAccelerated: report.hardwareAccelerated, renderer: base.webgl.renderer, idleFps: base.idle.fps, p95Ms: base.idle.p95Ms, over33ms: base.idle.over33ms, heap: base.heap, switchMs: { commandFirst: base.toCommandMs, presenceFirst: base.toPresenceMs, commandWarm: base.toCommandWarmMs, presenceWarm: base.toPresenceWarmMs }, keystrokeMs: base.keystrokeMs, presenceState: base.presenceState, reducedMeanMs: reduced.meanMs, report: file, screenshot: report.screenshot ?? null }, null, 2));
    cdp.close();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await cleanup();
  }
}

await main();
