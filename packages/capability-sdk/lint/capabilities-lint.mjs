import { readFileSync } from 'node:fs';

const rules = [
  ['forbidden-import', /from\s+['"]@jarvis\/(?:gateway|agents|world-model|memory|persistence|atlas|mnemosyne)/],
  ['process-env', /process\.env\.(?!NODE_ENV\b)/],
  ['bare-fetch', /(?<![\w.])fetch\s*\(/],
  ['http-request', /(?:https?|node:https?)\.request\s*\(/],
  ['offensive-side-effect', /\b(?:exploit|bruteforce|port-scan|payload|c2|keylog|exfiltrate)\b/i],
  ['invalid-id', /id\s*:\s*['"](?!capabilities\.[a-z][a-z0-9_]*['"])/],
];

export function lintCapabilities(files) {
  const findings = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const provider = source.match(/provider\s*:\s*['"]([^'"]+)/)?.[1];
    const allRules = provider === 'terminal' ? rules : [...rules, ['process-execution', /(?:node:)?(?:child_process|worker_threads)|node:vm/]];
    for (const [rule, re] of allRules) if (re.test(source)) findings.push({ file, rule, message: `capability security rule ${rule} failed` });
    if (/actions\s*:/.test(source) && !/\bverify\s*\(/.test(source)) findings.push({ file, rule: 'verify-required', message: 'actions require verify' });
    if (/risk\s*:\s*['"]CRITICAL['"]/.test(source) && !/confirmationPhrase\s*:/.test(source)) findings.push({ file, rule: 'critical-confirmation', message: 'CRITICAL requires confirmationPhrase' });
  }
  return findings;
}
