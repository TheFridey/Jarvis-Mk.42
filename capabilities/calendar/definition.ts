import { z } from 'zod';
import { defineCapability } from '@jarvis/capability-sdk';
import { integrationAction } from '../integration-action.ts';
const id = z.string().min(1).max(300);
const base = z.object({ calendarId: id.default('primary') }).strict();
const interval = { timeMin: z.string().datetime({ offset: true }), timeMax: z.string().datetime({ offset: true }) };
const time = z.object({ dateTime: z.string().datetime({ offset: true }), timeZone: z.string().max(100).optional() }).strict();
const event = z.object({ summary: z.string().min(1).max(1000), description: z.string().max(20000).optional(), start: time, end: time, attendees: z.array(z.object({ email: z.string().email() }).strict()).max(100).optional() }).strict();
export default defineCapability({
  id: 'capabilities.calendar', version: '2.0.0', description: 'Principal-bound Google Calendar integration', provider: 'calendar',
  executionEnvironment: 'worker', auditPolicy: { hashInput: true, recordOutput: 'none' }, privacyRequirements: { maxContentPrivacyClass: 'RESTRICTED' },
  actions: {
    'events.read': integrationAction('calendar', 'events.read', base.extend({ ...interval, eventId: id.optional(), pageToken: id.optional() })),
    'availability.read': integrationAction('calendar', 'availability.read', base.extend(interval)),
    'event.create': integrationAction('calendar', 'event.create', base.extend({ event }).refine(v => Date.parse(v.event.end.dateTime) > Date.parse(v.event.start.dateTime)), true, true),
    'event.update': integrationAction('calendar', 'event.update', base.extend({ eventId: id, event }).refine(v => Date.parse(v.event.end.dateTime) > Date.parse(v.event.start.dateTime)), true, true),
    'event.cancel': integrationAction('calendar', 'event.cancel', base.extend({ eventId: id }), true, true),
    RSVP: integrationAction('calendar', 'RSVP', base.extend({ eventId: id, response: z.enum(['accepted','declined','tentative']) }), true, true),
  },
});
