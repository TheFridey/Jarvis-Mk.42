import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AdapterJob, WorkerReply } from './ipc.ts';
const runtime = fileURLToPath(new URL('./worker-runtime.ts', import.meta.url));
export class AdapterHost {
  async run(job: AdapterJob): Promise<{ output: unknown; log: Array<{ level: string; msg: string; fields?: Record<string, unknown> }>; workerPid: number }> {
    if (job.executionEnvironment === 'worker+container') throw new Error('container runner required');
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', runtime], { env: { NODE_ENV: process.env.NODE_ENV ?? 'production' }, cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill(); reject(new Error('adapter timeout')); }, job.timeoutMs);
      let output = ''; child.stdout.on('data', (data) => { output += String(data); }); child.stderr.on('data', () => undefined);
      child.on('error', reject); child.on('close', () => { clearTimeout(timer); try { const reply = JSON.parse(output) as WorkerReply; if (!reply.ok) reject(new Error(reply.error)); else resolve({ output: reply.output, log: reply.logs, workerPid: child.pid ?? -1 }); } catch (error) { reject(error); } });
      child.stdin.end(JSON.stringify(job));
    });
  }
}
