import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const nodeVersion = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
const pnpmVersion = pkg.packageManager.split('@')[1];
let failures = 0;
function check(ok, message) {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${message}\n`);
  if (!ok) failures++;
}
function command(name, args) {
  // Windows pnpm is a command shim; no user-controlled arguments enter the shell.
  return spawnSync(name, args, { cwd: root, encoding: 'utf8', timeout: 30000,
    shell: process.platform === 'win32' && name === 'pnpm' });
}
check(process.versions.node === nodeVersion, `Node ${nodeVersion} (found ${process.versions.node})`);
const pnpm = command('pnpm', ['--version']);
check(pnpm.status === 0 && pnpm.stdout.trim() === pnpmVersion, `pnpm ${pnpmVersion}`);
check(/^lockfileVersion: '9\.0'/m.test(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')), 'pnpm lockfile format 9');
if (process.argv.includes('--installed')) {
  const tsc = command('pnpm', ['exec', 'tsc', '--version']);
  check(tsc.status === 0 && tsc.stdout.trim() === `Version ${pkg.devDependencies.typescript}`, `installed TypeScript ${pkg.devDependencies.typescript}`);
}
if (process.argv.includes('--full')) {
  const docker = command('docker', ['info', '--format', '{{.OSType}}']);
  check(docker.status === 0 && docker.stdout.trim() === 'linux', 'reachable Docker Linux engine for real integration/chaos/restore gates');
}
if (process.argv.includes('--native')) {
  check(command('rustc', ['--version']).status === 0, 'Rust compiler available');
  check(command('cargo', ['--version']).status === 0, 'Cargo available (use Cargo.lock with --locked)');
  if (process.platform === 'linux') {
    check(command('pkg-config', ['--exists', 'gtk+-3.0', 'webkit2gtk-4.1', 'ayatana-appindicator3-0', 'librsvg-2.0']).status === 0,
      'Linux Tauri GTK/WebKit/AppIndicator/librsvg development packages');
  } else if (process.platform === 'win32') {
    process.stdout.write('CHECK Windows native build also requires MSVC C++ build tools, Windows SDK and WebView2; Cargo build is the definitive check.\n');
  } else check(false, 'native setup check currently supports Windows and Linux');
}
process.exitCode = failures ? 1 : 0;
