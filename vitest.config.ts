import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const alias = {
  '@jarvis/contracts': r('./packages/contracts/src/index.ts'),
  '@jarvis/validation': r('./packages/validation/src/index.ts'),
  '@jarvis/persistence': r('./packages/persistence/src/index.ts'),
  '@jarvis/telemetry': r('./packages/telemetry/src/index.ts'),
  '@jarvis/testkit': r('./packages/testkit/src/index.ts'),
  '@jarvis/permissions': r('./packages/permissions/src/index.ts'),
  '@jarvis/capability-sdk': r('./packages/capability-sdk/src/index.ts'),
  '@jarvis/scene': r('./packages/scene/src/index.ts'),
  '@jarvis/spatial': r('./packages/spatial/src/index.ts'),
  '@jarvis/adapter-host': r('./apps/adapter-host/src/index.ts'),
};

const isIntegration = process.env.JARVIS_IT === '1';

export default defineConfig({
  resolve: { alias },
  test: {
    globals: false,
    environment: 'node',
    include: isIntegration
      ? ['packages/*/test/**/*.integration.test.ts', 'apps/*/test/**/*.integration.test.ts']
      : ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/test/**/*.security.test.ts', 'apps/*/test/**/boundary-sweep.test.ts'],
    hookTimeout: isIntegration ? 180_000 : 20_000,
    testTimeout: isIntegration ? 60_000 : 15_000,
    // vitest 2.x: name the logical project so `--project unit` / `--project integration` select it
    name: isIntegration ? 'integration' : 'unit',
    ...(isIntegration ? { fileParallelism: false, maxWorkers: 1, minWorkers: 1 } : {}),
  },
});
