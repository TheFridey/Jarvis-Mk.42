import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Resolve against this module so package-level launches also load the root file.
// Node preserves existing environment variables over values in the file.
const path = fileURLToPath(new URL('../.env', import.meta.url));
// Qualification subprocesses must not import workstation credentials/configuration.
if (process.env.JARVIS_LOAD_LOCAL_ENV !== '0' && existsSync(path)) loadEnvFile(path);
