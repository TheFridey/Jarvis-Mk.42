import { z } from 'zod';
import { defineCapability } from '@jarvis/capability-sdk';
import { integrationAction } from '../integration-action.ts';
export const areas = ['clients','leads','projects','tasks','invoices','payments','retainers','proposals','analytics','deployments','infrastructure','caseStudies'] as const;
const read = z.object({ id: z.string().min(1).max(200).optional(), clientId: z.string().min(1).max(200).optional(), cursor: z.string().max(2000).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict();
export default defineCapability({
  id: 'capabilities.scalesmiths', version: '2.0.0', description: 'ScaleSmiths service boundary; no database access', provider: 'scalesmiths',
  executionEnvironment: 'worker', auditPolicy: { hashInput: true, recordOutput: 'none' }, privacyRequirements: { maxContentPrivacyClass: 'RESTRICTED' },
  actions: Object.fromEntries([
    ...areas.map(area => [`${area}.read`, integrationAction('scalesmiths', `${area}.read`, read)]),
    ...['leads','tasks'].map(area => [`${area}.update`, integrationAction('scalesmiths', `${area}.update`, z.object({ id: z.string().min(1).max(200), patch: z.record(z.unknown()) }).strict(), true)]),
  ]),
});
