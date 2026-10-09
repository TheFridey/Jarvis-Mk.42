import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPg, runMigrations, type PgHandle } from '@jarvis/persistence';
import { startEphemeralPg, type EphemeralPg } from '@jarvis/testkit';

let container:EphemeralPg;let pg:PgHandle;let previous:string;
const migrations=fileURLToPath(new URL('../../../packages/persistence/src/migrations/',import.meta.url));
beforeAll(async()=>{
  container=await startEphemeralPg();pg=createPg({url:container.url});
  previous=await mkdtemp(join(tmpdir(),'jarvis-domain-upgrade-'));
  for(const file of await readdir(migrations))if(file.endsWith('.sql')&&file<'0018_domains.sql')await copyFile(join(migrations,file),join(previous,file));
  await runMigrations(pg.sql,previous);
});
afterAll(async()=>{await pg?.close();await container?.stop();if(previous)await rm(previous,{recursive:true,force:true});});
it('upgrades existing knowledge without guessing a business, deleting content or changing the principal',async()=>{
  await pg.sql`insert into mnemosyne.preferences(id,key,value,confidence,principal_id) values('legacy-pref','private.note','{"text":"retained legacy information"}',1,'legacy-owner')`;
  const upgraded=await runMigrations(pg.sql);
  expect(upgraded.applied).toEqual(['0018_domains.sql']);
  const [row]=await pg.sql`select p.*,d.kind from mnemosyne.preferences p join identity.domains d on d.id=p.domain_id where p.id='legacy-pref'`;
  expect(row).toMatchObject({principal_id:'legacy-owner',domain_id:'legacy-owner:system',kind:'SYSTEM',value:{text:'retained legacy information'}});
  expect((await runMigrations(pg.sql)).applied).toEqual([]);
  expect((await pg.sql`select count(*)::int as n from mnemosyne.preferences where id='legacy-pref'`)[0]?.n).toBe(1);
});
