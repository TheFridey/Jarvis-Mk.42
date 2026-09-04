import type { CapabilityDefinition } from './define.ts';
import { defineCapability } from './define.ts';

export function generateManifest(definition: CapabilityDefinition) { return defineCapability(definition).manifest; }
export function generateWorkerEntry(definitionImport = './definition.ts'): string {
  return `import capability from '${definitionImport}';\nimport { runWorker } from '@jarvis/capability-sdk/worker';\nrunWorker(capability);\n`;
}
