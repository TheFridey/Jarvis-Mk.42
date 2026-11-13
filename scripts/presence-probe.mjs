#!/usr/bin/env node
/**
 * Priority-zero probe: open the live export, wait for hydration and WebGL, then report what
 * the Presence layer actually looks like — DOM presence, computed visibility, stacking,
 * pointer target, and whether controls exist at all.
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
  console.log('--- after ' + settle + 'ms'); console.log(JSON.stringify(first.result.value, null, 1));
  // Evidence hygiene: never capture live business content that a notification may have pushed.
  await send('Runtime.evaluate', { expression: `document.querySelectorAll('.presence-answer').forEach(n => n.remove())`, returnByValue: true });
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync('D:/Hermes/cache/scratch', { recursive: true });
  writeFileSync('D:/Hermes/cache/scratch/presence-probe.png', Buffer.from(shot.data, 'base64'));
  console.log('--- screenshot D:/Hermes/cache/scratch/presence-probe.png');
  // Press C and probe again: does Command Centre appear, and is Presence hidden?
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', text: 'c' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC' });
  await sleep(2500);
  const second = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  console.log('--- after pressing C'); console.log(JSON.stringify({ html: second.result.value.html, layer: second.result.value.styles.layer?.position ?? null, inputHit: second.result.value.hitTest.input }));
  // 'C' selects the command centre, 'P' selects presence: they are two keys, not a toggle.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP', text: 'p' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP' });
  await sleep(2500);
  const third = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  console.log('--- back to presence'); console.log(JSON.stringify({ html: third.result.value.html, layer: third.result.value.styles.layer?.position ?? null, input: third.result.value.styles.input?.rect ?? null, inputHit: third.result.value.hitTest.input, privacyHit: third.result.value.hitTest.privacy }));
} )().catch(error => { console.error('probe failed:', error.message); process.exitCode = 1; }).finally(() => { try { ws?.close(); } catch {} ; try { browser.kill(); } catch {} ; setTimeout(() => process.exit(), 500); });
