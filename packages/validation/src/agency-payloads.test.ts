import { describe, expect, it } from 'vitest';
import { EventNames } from '@jarvis/contracts';
import { hasPayloadSchema, payloadSchemaFor } from './payloads.schema.ts';

const agencyEvents = Object.values(EventNames).filter((name) =>
  name.startsWith('jarvis.agency.') || name.startsWith('jarvis.security.'),
);

describe('agency and security event payload validation', () => {
  it('registers an explicit schema for every agency/security event', () => {
    for (const event of agencyEvents) expect(hasPayloadSchema(event, 1), event).toBe(true);
  });

  it('rejects an empty payload for every agency/security event', () => {
    for (const event of agencyEvents) expect(payloadSchemaFor(event, 1).safeParse({}).success, event).toBe(false);
  });
});
