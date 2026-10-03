import { describe,it,expect,vi } from 'vitest';
import { structuredLog } from './signals.ts';
import { sanitizeSpan } from './index.ts';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
describe('telemetry privacy boundary',()=>{
 it('drops arbitrary content from structured logs',async()=>{const spy=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);await structuredLog({component:'test',node:'node',event:'safe',correlationId:'Bearer secret token',payload:'PRIVATE PROMPT'} as Parameters<typeof structuredLog>[0]);const wire=String(spy.mock.calls[0]?.[0]);expect(wire).not.toContain('secret');expect(wire).not.toContain('PRIVATE');expect(JSON.parse(wire)).toHaveProperty('traceId');spy.mockRestore();});
 it('removes span messages, exception events, links and URL/SQL content',()=>{const span={attributes:{'db.statement':'SECRET SQL','url.full':'http://secret','jarvis.correlation_id':'safe'},events:[{name:'exception',attributes:{message:'secret'}}],links:[{attributes:{secret:'secret'}}],status:{code:2,message:'secret'},spanContext:()=>({traceId:'trace'})} as unknown as ReadableSpan;const result=sanitizeSpan(span);expect(result.attributes).toEqual({'jarvis.correlation_id':'safe'});expect(result.events).toEqual([]);expect(JSON.stringify(result)).not.toContain('secret');});
});
