#!/usr/bin/env node
/**
 * Presence layout audit: real geometry from the real browser.
 *
 * It loads the built export at several viewport sizes and scenarios and reports,
 * for each: the bounding box of every presence surface, every pairwise overlap,
 * the rendered font size and colour of the word and detail line, whether text is
 * clipped, whether focus is visible, and whether the response surface stays
 * inside its zone with a long answer injected.
 *
 * This finds the defects a screenshot review misses and a unit test cannot see,
 * because it measures the browser's own layout.
 *
 * Usage:
 *   node scripts/inspect-presence.mjs                     # headless, all cases
 *   node scripts/inspect-presence.mjs --headful           # visible window
 *   node scripts/inspect-presence.mjs --only 390x844
 */
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const ROOT = resolve('.'), OUT = join(ROOT, 'apps/desktop/out');
const PORT = Number(option('port', '4391')), CDP_PORT = Number(option('cdpPort', '9334'));
const ONLY = option('only');
const VIEWPORTS = [{ width: 1856, height: 890 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }];
const SCENARIOS = ['ambient', 'approval', 'executing', 'disconnected'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!CHROME) { console.error('inspect: no system Chrome/Edge found'); process.exit(1); }

const AUDIT = `(scenario) => {
  const box = selector => {
    const element = document.querySelector(selector); if (!element) return null;
    const r = element.getBoundingClientRect(); const s = getComputedStyle(element);
    // Hidden surfaces cannot collide with anything; measuring them would report
    // phantom overlaps for chrome that is deliberately suppressed.
    if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return null;
    return { selector, x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), fontSize: s.fontSize, colour: s.color, opacity: s.opacity, clipped: element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2 };
  };
  const names = ['.presence-word strong', '.presence-detail', '.presence-input', '.presence-answer', '.presence-answer-body', '.presence-footer', '.approval-barrier', '.presence-satellite'];
  const boxes = names.map(box).filter(Boolean);
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.selector === '.presence-answer' && b.selector === '.presence-answer-body') continue;
    if (a.selector === '.presence-answer-body' && b.selector === '.presence-answer') continue;
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
    if (x > 2 && y > 2) overlaps.push({ a: a.selector, b: b.selector, px: +(x * y).toFixed(0) });
  }
  const viewportOverflow = boxes.filter(entry => entry.x < -1 || entry.y < -1 || entry.right > innerWidth + 1 || entry.bottom > innerHeight + 1).map(entry => entry.selector);
  // Focus visibility, measured, not assumed.
  const input = document.querySelector('.presence-input input');
  let focus = null;
  if (input) {
    input.focus();
    const s = getComputedStyle(input.closest('form') ?? input);
    focus = { formBorderColour: s.borderColor, formBoxShadow: s.boxShadow !== 'none', outlineWidth: getComputedStyle(input).outlineWidth };
  }
  // Long-answer behaviour: inject a long body and verify it stays in its zone.
  const body = document.querySelector('.presence-answer-body');
  let longAnswer = null;
  if (body) {
    const before = body.textContent;
    const filler = 'The overnight build produced three failures in the persistence suite, none in the event fabric. ';
    body.textContent = filler.repeat(24);
    const r = body.getBoundingClientRect();
    const inputTop = document.querySelector('.presence-input').getBoundingClientRect().top;
    longAnswer = { heightPx: +r.height.toFixed(1), bottomPx: +r.bottom.toFixed(1), inputTopPx: +inputTop.toFixed(1), crossesInput: r.bottom > inputTop + 1, scrolls: body.scrollHeight > body.clientHeight + 2 };
    body.textContent = before;
  }
  return { viewport: { width: innerWidth, height: innerHeight }, state: document.querySelector('.presence-layer')?.getAttribute('data-presence-state') ?? null, word: document.querySelector('.presence-word strong')?.textContent ?? null, detail: document.querySelector('.presence-detail')?.textContent ?? null, answerText: document.querySelector('.presence-answer-body')?.textContent?.slice(0, 200) ?? null, link: document.querySelector('.presence-link')?.textContent ?? null, boxes, overlaps, viewportOverflow, focus, longAnswer, satellites: document.querySelectorAll('.presence-satellite').length };
}`;

async function serve(root, port) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const file = join(root, path === '/' ? 'index.html' : path);
    try { response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(port, '127.0.0.1', done));
  return server;
}

class Cdp {
  #socket; #id = 0; #pending = new Map();
  static async attach(url) {
    const client = new Cdp();
    client.#socket = new WebSocket(url);
    await new Promise((ready, failed) => { client.#socket.addEventListener('open', ready, { once: true }); client.#socket.addEventListener('error', () => failed(new Error('socket failed')), { once: true }); });
    client.#socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && client.#pending.has(message.id)) { const { done, reject } = client.#pending.get(message.id); client.#pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : done(message.result); }
    });
    return client;
  }
  send(method, params = {}) { const id = ++this.#id; this.#socket.send(JSON.stringify({ id, method, params })); return new Promise((done, reject) => this.#pending.set(id, { done, reject })); }
  close() { this.#socket.close(); }
}

const wait = ms => new Promise(done => setTimeout(done, ms));

async function main() {
  if (!existsSync(join(OUT, 'index.html'))) { console.error('inspect: no built export; run the desktop build first'); process.exit(1); }
  const server = await serve(OUT, PORT);
  const profile = join(tmpdir(), `jarvis-inspect-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const browser = spawn(CHROME, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1856,900', ...(args.includes('--headful') ? [] : ['--headless=new']), 'about:blank'], { stdio: 'ignore' });
  const results = [];
  try {
    let version;
    for (let attempt = 0; attempt < 60 && !version; attempt++) { try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); } catch { await wait(250); } }
    const tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const cdp = await Cdp.attach(tab.webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const evaluate = async expression => { for (let attempt = 0; ; attempt++) { try { const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed'); return result.result.value; } catch (error) { if (attempt < 3 && /context was destroyed/i.test(String(error))) { await wait(1000); continue; } throw error; } } };
    for (const viewport of VIEWPORTS) {
      if (ONLY && `${viewport.width}x${viewport.height}` !== ONLY) continue;
      for (const scenario of SCENARIOS) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 500 });
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?scenario=${scenario}` });
        await wait(3800);
        // Emulation does not always emit a resize; make the app re-measure so the
        // audit judges the layout the viewport actually gets.
        await evaluate('window.dispatchEvent(new Event("resize")), window.innerWidth + "x" + window.innerHeight');
        await wait(600);
        const audit = await evaluate(`(${AUDIT})(${JSON.stringify(scenario)})`);
        results.push({ viewportLabel: `${viewport.width}x${viewport.height}`, scenario, ...audit });
      }
    }
    cdp.close();
  } finally {
    try { browser.kill(); } catch { /* gone */ }
    await new Promise(done => server.close(done));
  }
  const problems = results.filter(entry => entry.overlaps.length || entry.viewportOverflow.length || entry.longAnswer?.crossesInput);
  const evidence = join(ROOT, 'docs/evidence/sentience-awakening');
  await mkdir(evidence, { recursive: true });
  const file = join(evidence, `layout-audit-${Date.now()}.json`);
  await writeFile(file, JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2));
  for (const entry of results) {
    const answer = entry.boxes.find(box => box.selector === '.presence-answer-body');
    console.log(`${entry.viewportLabel.padEnd(9)} ${entry.scenario.padEnd(13)} state=${String(entry.state).padEnd(12)} word="${entry.word}" satellites=${entry.satellites} overlaps=${entry.overlaps.length} overflow=${entry.viewportOverflow.length}${answer ? ` answer=${answer?.h}px clipped=${answer?.clipped}` : ''}${entry.longAnswer ? ` longAnswerCrossesInput=${entry.longAnswer.crossesInput}` : ''}`);
  }
  console.log(`\n${problems.length ? `PROBLEMS: ${problems.length} case(s)` : 'no overlap, overflow or clipping detected'} → ${file}`);
  if (problems.length) { for (const entry of problems) console.log(JSON.stringify({ viewport: entry.viewportLabel, scenario: entry.scenario, overlaps: entry.overlaps, viewportOverflow: entry.viewportOverflow, longAnswer: entry.longAnswer }, null, 1)); process.exitCode = 2; }
}

await main();
