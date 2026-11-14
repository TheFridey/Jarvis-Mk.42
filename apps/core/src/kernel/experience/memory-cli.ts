#!/usr/bin/env node
/* eslint-disable no-console -- operator CLI; output is the interface. */
/**
 * Owner management for personal memory. Local, offline, no HTTP surface.
 *
 * Every operation goes through `PersonalMemoryService`, which is the same object the Kernel
 * uses — the CLI is a console, not a second authority. It never prints memory statements in
 * diagnostics and never writes approved rows without an explicit approval command.
 *
 *   pnpm memory list
 *   pnpm memory show <id>
 *   pnpm memory import D:\JarvisData\Memory\Imports\pack.json
 *   pnpm memory approve <id>          reject <id>
 *   pnpm memory grant-cloud <id>      revoke-cloud <id>
 *   pnpm memory correct <id> "subject" "statement"
 *   pnpm memory revoke <id>           delete <id>
 *   pnpm memory export out.json
 *
 * Principal defaults to the local owner and can be overridden with JARVIS_PRINCIPAL_ID for an
 * isolated test principal.
 */
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createPg } from '../../../../../packages/persistence/src/client.ts';
import { PersonalMemoryStore } from '../../kernel/experience/personal-memory-store.ts';
import { PersonalMemoryService } from '../../kernel/experience/personal-memory-service.ts';
import { ReviewSession } from '../../kernel/experience/memory-review.ts';
import { createInterface } from 'node:readline/promises';
import type { MemoryRecord } from '../../kernel/experience/personal-memory.ts';

const principalId = process.env.JARVIS_PRINCIPAL_ID?.trim() || 'local-owner';
const [command, ...args] = process.argv.slice(2);

const shape = (record: MemoryRecord) => ({
  id: record.id,
  status: record.reviewStatus,
  category: record.category,
  subject: record.subject,
  class: record.privacyClass,
  cloud: record.cloudEligible,
  confidence: record.confidence,
  recorded: record.recordedAt,
  ...(record.revokedAt ? { revoked: record.revokedAt } : {}),
  ...(record.supersededBy ? { supersededBy: record.supersededBy } : {}),
  // The statement is only shown in `show`, not in a listing.
});

async function main(): Promise<void> {
  const client = createPg({ url: process.env.JARVIS_DB_URL ?? 'postgres://jarvis:jarvis@127.0.0.1:5433/jarvis' });
  const sql = client.sql as never;
  const service = new PersonalMemoryService(new PersonalMemoryStore(sql));
  try {
    switch (command) {
      case 'list': {
        const records = await service.list(principalId);
        console.log(JSON.stringify(records.map(shape), null, 2));
        console.log(`\n${records.filter(record => record.reviewStatus === 'pending').length} pending, ${records.filter(record => record.reviewStatus === 'approved' && !record.revokedAt).length} active.`);
        break;
      }
      case 'active': {
        console.log(JSON.stringify((await service.active(principalId)).map(shape), null, 2));
        break;
      }
      case 'show': {
        const record = (await service.list(principalId)).find(held => held.id === args[0]);
        if (!record) throw new Error(`no such memory: ${args[0]}`);
        console.log(JSON.stringify({ ...shape(record), statement: record.statement, source: record.source }, null, 2));
        break;
      }
      case 'import': {
        const pack = JSON.parse(readFileSync(args[0]!, 'utf8'));
        const result = await service.importPack(principalId, pack);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case 'approve': await service.approve(principalId, args[0]!); console.log(`approved ${args[0]} (local use only unless granted)`); break;
      case 'reject': await service.reject(principalId, args[0]!); console.log(`rejected ${args[0]}`); break;
      case 'grant-cloud': await service.grantCloud(principalId, args[0]!); console.log(`cloud disclosure granted for ${args[0]}`); break;
      case 'revoke-cloud': await service.revokeCloud(principalId, args[0]!); console.log(`cloud disclosure revoked for ${args[0]}`); break;
      case 'correct': {
        const id = await service.correct(principalId, args[0]!, { subject: args[1] ?? 'Owner correction', statement: args[2] ?? '' });
        console.log(`corrected: ${args[0]} superseded by ${id}`);
        break;
      }
      case 'revoke': await service.revokeUse(principalId, args[0]!); console.log(`revoked ${args[0]} (statement retained); cloud disclosure off`); break;
      case 'delete': await service.deleteContent(principalId, args[0]!); console.log(`deleted the content of ${args[0]}; an audit row remains`); break;
      case 'review': {
        // An interactive review must be interactive: a pipe or redirected stdin can never approve.
        if (!process.stdin.isTTY) {
          throw new Error('memory review needs an interactive terminal; use list/approve for scripted use');
        }
        const terminal = createInterface({ input: process.stdin, output: process.stdout });
        let interrupted = false;
        terminal.on('SIGINT', () => { interrupted = true; });
        const session = new ReviewSession(service, principalId, {
          write: line => console.log(line),
          ask: async prompt => {
            if (interrupted) return '__eof__';
            try {
              const answer = await terminal.question(prompt);
              return answer;
            } catch {
              return '__eof__';
            }
          },
        });
        const outcome = await session.run();
        terminal.close();
        // Quitting mid-session is a normal exit, not a failure.
        if (outcome.errors.length) process.exitCode = 1;
        break;
      }
      case 'export': {
        const records = await service.exportApproved(principalId);
        writeFileSync(args[0] ?? 'memory-export.json', JSON.stringify({ schemaVersion: 1, records }, null, 2));
        console.log(`exported ${records.length} approved records to ${args[0] ?? 'memory-export.json'}`);
        break;
      }
      default:
        console.log('usage: list | active | show <id> | import <file> | approve <id> | reject <id> | grant-cloud <id> | revoke-cloud <id> | correct <id> "subject" "statement" | revoke <id> | delete <id> | export [file]');
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

await main();
