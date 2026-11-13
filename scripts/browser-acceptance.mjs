#!/usr/bin/env node
/**
 * Browser acceptance for the production export.
 *
 * The stylesheet truncation of PRESENCE taught the lesson: a build that compiles, a passing
 * component test and a working command centre can all coexist with an interface the owner
 * cannot use. These assertions are made in a real browser against the real export, and they
 * fail the process when the interface is not usable.
 *
 *   node scripts/browser-acceptance.mjs [url]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:4300/?mode=presence';
const settle = Number(process.argv[3] ?? 9000);
const CDP_PORT = 9333;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!CHROME) { console.error('system Chrome not found'); process.exit(1); }

const profile = join(process.env.TEMP ?? '.', `jarvis-probe-${Date.now()}`);
mkdirSync(profile, { recursive: true });
const browser = spawn(CHROME, ['--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--window-size=1856,900',
  '--enable-unsafe-swiftshader', '--headless=new', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
const pending = new Map();
const send = (() => {
  let id = 0;
  return (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
    setTimeout(() => { if (pending.delete(messageId)) reject(new Error('timeout ' + method)); }, 30000);
  });
})();
const waiters = [];

const PROBE = `(() => {
  const pick = sel => document.querySelector(sel);
  const layer = pick('.presence-layer');
  const stack = pick('.presence-stack');
  const input = pick('.presence-input input, .presence-input textarea');
  const privacy = pick('.presence-privacy');
  const canvas = pick('canvas');
  const style = el => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { display: s.display, visibility: s.visibility, opacity: s.opacity, position: s.position,
      zIndex: s.zIndex, pointerEvents: s.pointerEvents, transform: s.transform,
      overflow: s.overflow, animationName: s.animationName, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  };
  const hit = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top ? (top.className && typeof top.className === 'string' ? '.' + top.className.split(' ').filter(Boolean).join('.') : top.tagName) : null;
  };
  return {
    readyState: document.readyState,
    bodyClass: document.body.className,
    layerClass: layer ? layer.className : null,
    layerState: layer ? layer.getAttribute('data-presence-state') : null,
    html: { layer: !!layer, stack: !!stack, input: !!input, privacy: !!privacy, canvas: !!canvas },
    styles: { layer: style(layer), stack: style(stack), input: style(input), privacy: style(privacy), canvas: style(canvas) },
    hitTest: { input: hit(input), privacy: hit(privacy) },
    counters: { presenceAnswers: document.querySelectorAll('.presence-answer').length,
                satellites: document.querySelectorAll('.presence-satellite').length,
                buttons: document.querySelectorAll('.presence-layer button').length },
    viewport: { w: innerWidth, h: innerHeight },
    overlap: (() => {
      const detail = document.querySelector('.presence-detail');
      const chip = document.querySelector('.presence-privacy');
      const input = document.querySelector('.presence-input');
      const stack = document.querySelector('.presence-stack');
      const rect = el => el ? el.getBoundingClientRect() : null;
      const clash = (a, b) => { if (!a || !b) return false; return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom); };
      const d = rect(detail), c = rect(chip), i = rect(input), st = rect(stack);
      return { detailVsChip: clash(d, c), detailVsInput: clash(d, i), chipVsInput: clash(c, i),
               stackTop: st ? Math.round(st.top) : null, detailBottom: d ? Math.round(d.bottom) : null,
               chipTop: c ? Math.round(c.top) : null };
    })(),
    text: (document.querySelector('.presence-layer')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400),
  };
})()`;

(async () => {
  let version;
  for (let i = 0; i < 80; i++) { try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(250); } }
  if (!version) throw new Error('chrome did not expose CDP');
  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); } }
    else if (message.method === 'Page.loadEventFired') waiters.splice(0).forEach(fn => fn());
  });
  await send('Page.enable'); await send('Runtime.enable');
  const loaded = new Promise(resolve => waiters.push(resolve));
  await send('Page.navigate', { url });
  await Promise.race([loaded, sleep(15000)]);
  await sleep(settle);
  const first = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  const view = first.result.value;
  const failures = [];
  const check = (name, ok, detail) => { if (!ok) failures.push(name + (detail ? ' (' + detail + ')' : '')); console.log((ok ? 'PASS ' : 'FAIL ') + name); };

  check('presence layer exists', view.html.layer);
  check('overlay is fixed, not in document flow', view.styles.layer?.position === 'fixed', view.styles.layer?.position);
  check('overlay covers the viewport', (view.styles.layer?.rect.w ?? 0) > 300 && (view.styles.layer?.rect.h ?? 0) > 300);
  check('presence stylesheet applied', view.styles.input?.display !== undefined && view.styles.privacy !== null);
  check('command input visible', (view.styles.input?.rect.w ?? 0) > 100, JSON.stringify(view.styles.input?.rect));
  check('command input receives pointer', view.hitTest.input === 'INPUT', String(view.hitTest.input));
  check('privacy chip visible', (view.styles.privacy?.rect.w ?? 0) > 40);
  check('privacy chip receives pointer', Boolean(view.hitTest.privacy));
  check('status and privacy chip do not overlap', view.overlap?.detailVsChip === false);
  check('status and input do not overlap', view.overlap?.detailVsInput === false);
  check('no historical answer on open', view.counters.presenceAnswers === 0, String(view.counters.presenceAnswers));
  // Evidence hygiene: never capture live business content that a notification may have pushed.
  if (failures.length === 0) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync('D:/Hermes/cache/scratch', { recursive: true });
    writeFileSync('D:/Hermes/cache/scratch/presence-acceptance.png', Buffer.from(shot.data, 'base64'));
    console.log('screenshot: D:/Hermes/cache/scratch/presence-acceptance.png');
  }
  // Press C and probe again: does Command Centre appear, and is Presence hidden?
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', text: 'c' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC' });
  await sleep(2500);
  const second = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  check('C enters the command centre', second.result.value.html.layer === false);
  // 'C' selects the command centre, 'P' selects presence: they are two keys, not a toggle.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP', text: 'p' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP' });
  await sleep(2500);
  const third = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  const back = third.result.value;
  check('P returns to presence with controls', back.html.layer === true && back.html.input === true && back.html.privacy === true);
  check('returned input is interactive', back.hitTest.input === 'INPUT');
  check('returned overlay is still fixed', back.styles.layer?.position === 'fixed');

  console.log('');
  if (failures.length) { console.log('FAILED: ' + failures.join('; ')); process.exitCode = 1; }
  else console.log('BROWSER ACCEPTANCE PASSED');
} )().catch(error => { console.error('probe failed:', error.message); process.exitCode = 1; }).finally(() => { try { ws?.close(); } catch {} ; try { browser.kill(); } catch {} ; setTimeout(() => process.exit(), 500); });
