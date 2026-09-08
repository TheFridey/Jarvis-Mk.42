import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import type { AdapterJob, WorkerReply } from './ipc.ts';
const job = JSON.parse(readFileSync(0, 'utf8')) as AdapterJob;
const logs: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> = [];
if(!job.nonce||!job.issuedAt||!process.env.JARVIS_WORKER_IPC_SECRET)throw new Error('authenticated worker IPC required');
const binding=()=>({invocationId:job.invocationId,capabilityId:job.capabilityId,action:job.action,nonce:job.nonce!,issuedAt:job.issuedAt!,mac:createHmac('sha256',process.env.JARVIS_WORKER_IPC_SECRET!).update(`${job.invocationId}\0${job.capabilityId}\0${job.action}\0${job.nonce}\0${job.issuedAt}`).digest('hex')});
try {
  const imported = await import(job.moduleUrl) as { default?: { actions?: Record<string, { execute: (ctx: unknown, input: unknown) => Promise<unknown>; verify?: (ctx: unknown, input: unknown, output: unknown) => Promise<unknown>; rollback?: (ctx: unknown, input: unknown, before: unknown) => Promise<unknown>; simulate?: (ctx: unknown, input: unknown) => Promise<unknown> }> } };
  const action = imported.default?.actions?.[job.action]; if (!action) throw new Error('adapter action not found');
  const ctx = { input: job.input, mode: job.mode, credential: job.handle, abortSignal: new AbortController().signal, log: (level: string, msg: string, fields?: Record<string, unknown>) => logs.push({ level, msg, fields }), http: async () => { throw new Error('egress unavailable'); } };
  let output: unknown;
  if (job.operation === 'hash-file') {
    const input = job.input as { root?: string; path?: string }; if (!input.root || !input.path) throw new Error('hash-file requires root and path');
    const root = resolve(input.root); const path = resolve(input.path); if (path !== root && !path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`)) throw new Error('path outside credential scope');
    output = createHash('sha256').update(readFileSync(path)).digest('hex');
  } else if (job.operation === 'verify') { if (!action.verify) throw new Error('adapter verify unavailable'); output = await action.verify(ctx, job.input, job.output); }
  else if (job.operation === 'rollback') { if (!action.rollback) throw new Error('adapter rollback unavailable'); output = await action.rollback(ctx, job.input, job.before); }
  else if (job.operation === 'simulate') { if (!action.simulate) throw new Error('adapter simulation unavailable'); output = await action.simulate(ctx, job.input); }
  else output = await action.execute(ctx, job.input);
  process.stdout.write(JSON.stringify({ ok: true, output, logs, binding:binding() } satisfies WorkerReply));
} catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'worker failed', binding:binding() } satisfies WorkerReply)); }
