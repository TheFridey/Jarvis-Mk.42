import { afterEach, expect, it, vi } from 'vitest';
import type { ModelRequest, ModelResponse } from '@jarvis/contracts';
import { HttpModelGatewayClient } from './model-client.ts';
afterEach(()=>vi.unstubAllGlobals());
const request={correlationId:'correlation',task:'reason'} as ModelRequest;
it('consumes fragmented routing frames in order and returns the genuine result',async()=>{
 const response={modelId:'local'} as ModelResponse;
 const frames=`data: ${JSON.stringify({type:'routing',routing:{phase:'STARTING',correlationId:'correlation'}})}\n\ndata: ${JSON.stringify({type:'done',response})}\n\n`;
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(controller){for(const part of [frames.slice(0,17),frames.slice(17)])controller.enqueue(new TextEncoder().encode(part));controller.close()}}))));
 const observed:string[]=[];
 expect(await new HttpModelGatewayClient('http://gateway','token').generate(request,undefined,async routing=>{observed.push(routing.phase!)})).toEqual(response);
 expect(observed).toEqual(['STARTING']);
});
it('fails closed on disconnect without a terminal result',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: {"type":"routing","routing":{"phase":"STARTING"}}\n\n')));
 await expect(new HttpModelGatewayClient('http://gateway','token').generate(request,undefined,async()=>{})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});
it('preserves typed error classification without leaking response text',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: {"type":"error","error":{"code":"RATE_LIMITED","retryable":true}}\n\n')));
 await expect(new HttpModelGatewayClient('http://gateway','token').generate(request,undefined,async()=>{})).rejects.toMatchObject({code:'RATE_LIMITED',retryable:true});
});
