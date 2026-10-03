import { z } from 'zod';
import { defineCapability } from '@jarvis/capability-sdk';
import { integrationAction } from '../integration-action.ts';
const messageId = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200);
const mail = z.object({ to: z.array(z.string().email().max(254)).min(1).max(50), subject: z.string().max(998).refine(v => !/[\r\n]/.test(v)), body: z.string().max(200000), threadId: messageId.optional(), inReplyTo: z.string().regex(/^<[^<>\s]+>$/).max(320).optional() }).strict();
export default defineCapability({
  id: 'capabilities.email', version: '2.0.0', description: 'Principal-bound Gmail integration', provider: 'email',
  executionEnvironment: 'worker', auditPolicy: { hashInput: true, recordOutput: 'none' }, privacyRequirements: { maxContentPrivacyClass: 'RESTRICTED' },
  actions: {
    search: integrationAction('email', 'search', z.object({ query: z.string().max(2000), pageToken: z.string().max(2000).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict()),
    read: integrationAction('email', 'read', z.object({ messageId }).strict()),
    'thread.read': integrationAction('email', 'thread.read', z.object({ threadId: messageId }).strict()),
    'draft.create': integrationAction('email', 'draft.create', mail, true),
    'draft.update': integrationAction('email', 'draft.update', mail.extend({ draftId: messageId }), true),
    send: integrationAction('email', 'send', mail, true, true),
    archive: integrationAction('email', 'archive', z.object({ messageId }).strict(), true),
  },
});
