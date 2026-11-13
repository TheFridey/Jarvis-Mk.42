import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Local speech synthesis, offline, using the voice already installed on this machine.
 *
 * Text arrives on stdin as JSON; only the output path is an argument. Nothing is sent
 * anywhere, and the generated audio is returned to the caller and deleted from disk.
 */

export const SYNTHESIS_MAX_CHARS = 600;

export function cleanSpeechText(text: string): string {
  // Control characters and runaway whitespace only — the words are the user's.
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SYNTHESIS_MAX_CHARS);
}

const script = fileURLToPath(new URL('../../../scripts/system-speak.ps1', import.meta.url));

export interface SynthesisOptions {
  voice?: string;
  timeoutMs?: number;
  /** Injected for tests: returns a small valid WAV instead of running PowerShell. */
  runner?: (text: string) => Promise<Buffer>;
}

export async function synthesiseToWav(text: string, options: SynthesisOptions = {}): Promise<Buffer> {
  const spoken = cleanSpeechText(text);
  if (!spoken) throw new Error('nothing to speak');
  if (options.runner) return options.runner(spoken);

  const dir = mkdtempSync(join(tmpdir(), 'jarvis-tts-'));
  const out = join(dir, 'speech.wav');
  const timeoutMs = options.timeoutMs ?? 20_000;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true, shell: false });
      let stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('synthesis timed out')); }, timeoutMs);
      child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 1024) stderr += chunk.toString('utf8'); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`synthesis failed (${code})${stderr ? ': ' + stderr.trim().slice(0, 120) : ''}`));
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(JSON.stringify({ text: spoken, out, ...(options.voice ? { voice: options.voice } : {}) }));
    });
    return readFileSync(out);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* bounded scratch */ }
  }
}
