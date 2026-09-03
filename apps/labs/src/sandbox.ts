import { execFile } from 'node:child_process'; import { promisify } from 'node:util'; import { randomUUID } from 'node:crypto';
const run = promisify(execFile);
export class LabsSandbox {
  async execute(image: string, command: string[], wallTimeMs = 60_000) {
    const name = `jarvis-labs-${randomUUID()}`;
    const args = ['run', '--name', name, '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '1', '--pids-limit', '64', image, ...command];
    try { const result = await run('docker', args, { timeout: wallTimeMs, windowsHide: true }); return { ok: true, log: `${result.stdout}${result.stderr}` }; }
    catch (error) { return { ok: false, log: error instanceof Error ? error.message : 'LABS failed' }; }
    finally { await run('docker', ['rm', '-f', name], { windowsHide: true }).catch(() => undefined); }
  }
}
