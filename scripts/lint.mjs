// Lightweight structural lint. ESLint could not be installed in this
// environment (external drive; pathological pnpm link times) so the lint gate
// is: `tsc` strict (run by the npm script before this) + these checks.
//
// MK.43 DEVIATION - tracked in docs/architecture note "MK43 implementation
// notes". Replace with eslint + typescript-eslint (ADR-0001 stack) when the
// toolchain allows.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lintCapabilities } from '../packages/capability-sdk/lint/capabilities-lint.mjs';

const ROOTS = ['packages', 'apps'];
const BAD = [
  { re: /\bconsole\.log\(/, msg: 'console.log (use structured logging / events)' },
  { re: /@ts-ignore/, msg: '@ts-ignore (use @ts-expect-error with a reason)' },
  { re: /\bas any\b/, msg: '`as any` cast' },
  { re: /\bTODO\b(?!:)/, msg: 'bare TODO (use TODO: with detail or an issue)' },
];
const ALLOW_FILES = [
  /scripts\//,
  /\.test\.ts$/,
  /lint\.mjs$/,
  /-cli\.ts$/, // CLI entrypoints may write to stdout
  /main\.ts$/, // process entrypoint
];

let problems = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next' || entry === 'out') continue;
      walk(p);
    } else if (entry.endsWith('.ts')) {
      if (ALLOW_FILES.some((re) => re.test(p))) continue;
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const b of BAD) {
          if (b.re.test(line)) {
            console.error(`${p}:${i + 1}  ${b.msg}`);
            problems++;
          }
        }
      });
    }
  }
}

for (const r of ROOTS) walk(r);

const capabilityFiles = [];
function findCapabilities(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) findCapabilities(p);
    else if (entry.endsWith('.ts')) capabilityFiles.push(p);
  }
}
findCapabilities('capabilities');
for (const finding of lintCapabilities(capabilityFiles)) {
  console.error(`${finding.file}  ${finding.message}`);
  problems++;
}

if (problems > 0) {
  console.error(`\nlint: ${problems} problem(s)`);
  process.exit(1);
}
console.log('lint: clean');
