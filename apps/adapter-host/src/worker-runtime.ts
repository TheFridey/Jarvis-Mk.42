import { readFileSync } from 'node:fs';
import type { AdapterJob, WorkerReply } from './ipc.ts';
const job = JSON.parse(readFileSync(0, 'utf8')) as AdapterJob;
const logs: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> = [];
try {
  const imported = await import(job.moduleUrl) as { default?: { actions?: Record<string, { execute: (ctx: unknown, input: unknown) => Promise<unknown> }> } };
  const action = imported.default?.actions?.[job.action]; if (!action) throw new Error('adapter action not found');
  const output = await action.execute({ input: job.input, mode: job.mode, credential: job.handle, abortSignal: new AbortController().signal,
    log: (level: string, msg: string, fields?: Record<string, unknown>) => logs.push({ level, msg, fields }), http: async () => { throw new Error('egress unavailable'); } }, job.input);
  process.stdout.write(JSON.stringify({ ok: true, output, logs } satisfies WorkerReply));
} catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'worker failed' } satisfies WorkerReply)); }
