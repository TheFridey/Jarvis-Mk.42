import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const alias = {
  '@jarvis/contracts': r('./packages/contracts/src/index.ts'),
  '@jarvis/validation': r('./packages/validation/src/index.ts'),
  '@jarvis/persistence': r('./packages/persistence/src/index.ts'),
  '@jarvis/telemetry': r('./packages/telemetry/src/index.ts'),
  '@jarvis/testkit': r('./packages/testkit/src/index.ts'),
};

const isIntegration = process.env.JARVIS_IT === '1';

export default defineConfig({
  resolve: { alias },
  test: {
    globals: false,
    environment: 'node',
    include: isIntegration
      ? ['packages/*/test/**/*.integration.test.ts', 'apps/*/test/**/*.integration.test.ts']
      : ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    hookTimeout: isIntegration ? 180_000 : 20_000,
    testTimeout: isIntegration ? 60_000 : 15_000,
    // vitest 2.x: name the logical project so `--project unit` / `--project integration` select it
    name: isIntegration ? 'integration' : 'unit',
  },
});
