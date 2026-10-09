import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile as callbackExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const execFile = promisify(callbackExecFile);
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
async function launch(loadLocalEnv?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-env-'));
  try {
    await mkdir(join(directory, 'scripts'));
    const helper = join(directory, 'scripts', 'local-env.ts');
    await copyFile(new URL('../../../../scripts/local-env.ts', import.meta.url), helper);
    await writeFile(join(directory, '.env'), 'JARVIS_QUALIFICATION_ENV_SENTINEL=from-file\nJARVIS_QUALIFICATION_ENV_EXISTING=from-file\n');
    const env: NodeJS.ProcessEnv = { ...process.env, JARVIS_QUALIFICATION_ENV_EXISTING: 'preexisting' };
    delete env.JARVIS_QUALIFICATION_ENV_SENTINEL;
    delete env.JARVIS_LOAD_LOCAL_ENV;
    if (loadLocalEnv !== undefined) env.JARVIS_LOAD_LOCAL_ENV = loadLocalEnv;
    const script = `await import(${JSON.stringify(pathToFileURL(helper).href)}); process.stdout.write(JSON.stringify({sentinel:process.env.JARVIS_QUALIFICATION_ENV_SENTINEL??null,existing:process.env.JARVIS_QUALIFICATION_ENV_EXISTING}));`;
    const { stdout } = await execFile(process.execPath, ['--import', tsxLoader, '--input-type=module', '--eval', script], { env, timeout: 10000, windowsHide: true });
    return JSON.parse(stdout) as { sentinel: string | null; existing: string };
  } finally {
    // This directory was created by this invocation, never supplied by a user.
    if (!directory.startsWith(join(tmpdir(), 'jarvis-env-'))) throw new Error('unexpected qualification directory');
    await rm(directory, { recursive: true, force: true });
  }
}

it('loads the workspace file by default while preserving existing environment values', async () => {
  expect(await launch()).toEqual({ sentinel: 'from-file', existing: 'preexisting' });
});
it('prevents qualification subprocesses from loading workstation configuration', async () => {
  expect(await launch('0')).toEqual({ sentinel: null, existing: 'preexisting' });
});
