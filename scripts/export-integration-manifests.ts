import { writeFile } from 'node:fs/promises';
import email from '../capabilities/email/definition.ts';
import calendar from '../capabilities/calendar/definition.ts';
import scalesmiths from '../capabilities/scalesmiths/definition.ts';
for (const [provider, definition] of Object.entries({ email, calendar, scalesmiths })) {
  await writeFile(new URL(`../capabilities/${provider}/manifest.json`, import.meta.url), JSON.stringify(definition.manifest, null, 2) + '\n');
}
