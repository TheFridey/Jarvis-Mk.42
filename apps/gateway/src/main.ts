import '../../../scripts/local-env.ts';
import { createServer, type IncomingMessage } from 'node:http';
import { ModelGatewayError, type ModelRegistration, type ModelRequest, type ModelStreamChunk } from '@jarvis/contracts';
import { once } from 'node:events';
import { AnthropicAdapter } from './adapters/anthropic.ts';
import { OpenAIAdapter } from './adapters/openai.ts';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.ts';
import { ModelGateway } from './gateway.ts'; import { ModelRegistry } from './registry.ts';
import { extractTraceContext, startTelemetry, withSpan, withTraceContext } from '@jarvis/telemetry';
import { assertGatewayIngressIsSecure, assertProviderBaseUrl, providerVerificationEnabled, DEVELOPMENT_GATEWAY_TOKEN } from './runtime-config.ts';
import { speechHttp } from './speech-http.ts';
const registry=new ModelRegistry(),now=new Date().toISOString();
function register(id:string,provider:string,adapter:Parameters<ModelRegistry['register']>[1],locality:ModelRegistration['locality'],cost=0){registry.register({id,provider,displayName:id,tasks:['reason','plan','summarize','extract','classify','code'],capabilities:['json','streaming','long_context'],contextLimitUnits:128_000,costPerContextUnit:cost,costPerOutputUnit:cost*3,locality,enabled:true,registeredAt:now},adapter)}
if(process.env.OPENAI_API_KEY)register(process.env.JARVIS_OPENAI_MODEL??'gpt-6.1-sol','openai',new OpenAIAdapter(process.env.OPENAI_API_KEY),'cloud-ok',.00001);
if(process.env.ANTHROPIC_API_KEY)register(process.env.JARVIS_ANTHROPIC_MODEL??'claude-opus-5-5','anthropic',new AnthropicAdapter(process.env.ANTHROPIC_API_KEY),'cloud-ok',.00001);
if(process.env.OPENROUTER_API_KEY){
 const model=process.env.JARVIS_OPENROUTER_MODEL?.trim();
 if(!model)throw new Error('JARVIS_OPENROUTER_MODEL is required when OPENROUTER_API_KEY is configured');
 // Isolated-configuration seam: the default is unchanged, and only an explicit override can
  // point provider traffic elsewhere. Used by the offline wire-proof, never by production runs.
  const verification = providerVerificationEnabled();
  const openrouterBase = process.env.JARVIS_OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';
  if (openrouterBase !== 'https://openrouter.ai/api/v1' && !verification) {
    throw new Error('JARVIS_OPENROUTER_BASE_URL requires JARVIS_ALLOW_PROVIDER_REDIRECT=1');
  }
  // Fail closed: in verification mode the endpoint must be numeric loopback with no proxy in the
  // environment, and redirects are errors rather than hops to somewhere less approved.
  assertProviderBaseUrl(openrouterBase, { verification });
  const providerFetch: typeof fetch = verification ? (input, init) => fetch(input, { ...init, redirect: 'error' }) : fetch;
  register(model,'openrouter',new OpenAICompatibleAdapter('openrouter',openrouterBase,process.env.OPENROUTER_API_KEY,providerFetch),'cloud-ok');
}
if(process.env.JARVIS_LOCAL_MODEL_URL)register(process.env.JARVIS_LOCAL_MODEL??'local-model','local-openai-compatible',new OpenAICompatibleAdapter('local-openai-compatible',process.env.JARVIS_LOCAL_MODEL_URL,process.env.JARVIS_LOCAL_MODEL_KEY),'local');
const gateway=new ModelGateway(registry),token=process.env.JARVIS_GATEWAY_TOKEN??DEVELOPMENT_GATEWAY_TOKEN;
const host=process.env.JARVIS_GATEWAY_HOST??'127.0.0.1';
assertGatewayIngressIsSecure(host,token);
startTelemetry({serviceName:'jarvis-model-gateway',serviceVersion:'0.50.0',environment:process.env.NODE_ENV,otlpEndpoint:process.env.JARVIS_OTLP_ENDPOINT,disabled:process.env.JARVIS_TELEMETRY_DISABLED==='true'});
async function body(req:IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const c of req){const b=Buffer.from(c);size+=b.length;if(size>2_000_000)throw new Error('request too large');chunks.push(b)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))as ModelRequest}
const server=createServer(async(req,res)=>{
 if(req.method==='POST'&&req.url==='/v1/speech'){await speechHttp(req,res,token);return}
 if(req.url==='/health'){res.setHeader('content-type','application/json');res.end(JSON.stringify({models:await gateway.health()}));return}
 if(req.method!=='POST'||!['/v1/generate','/v1/stream','/v1/route'].includes(req.url??'')){res.statusCode=404;res.end(JSON.stringify({error:'not_found'}));return}
 if(req.headers.authorization!==`Bearer ${token}`){res.statusCode=401;res.end(JSON.stringify({error:'unauthorized'}));return}
 const abort=new AbortController();req.once('aborted',()=>abort.abort());res.once('close',()=>{if(!res.writableEnded)abort.abort()});
 const headers:Record<string,string|undefined>={};for(const[key,value]of Object.entries(req.headers))headers[key]=Array.isArray(value)?value.join(','):value;
 const send=async(chunk:ModelStreamChunk)=>{abort.signal.throwIfAborted();if(!res.write(`data: ${JSON.stringify(chunk)}\n\n`))await once(res,'drain',{signal:abort.signal})};
 try{await withTraceContext(extractTraceContext(headers),()=>withSpan('model_gateway.interaction',{'http.request.method':req.method??'GET','url.path':req.url??'/'},async()=>{const request=await body(req);
    // Fail safe, not fail open: only an explicit "0" from a caller that classified its own request
    // as non-personal permits fallback. A missing or unrecognised marker is treated as personal,
    // because the cost of a refused fallback is one honest error and the cost of a wrong fallback is
    // a second disclosure nobody consented to.
    request.disclosure=req.headers['x-jarvis-memory-disclosure']==='0'?undefined:'personal-memory';
    // Opt-in, metadata only: no prompt, no body, no statement. Enough to prove on the wire that the
    // Kernel's classification survived the hop, which is what a passing unit test cannot show.
    if(process.env.JARVIS_TRACE_DISCLOSURE==='1')process.stderr.write(JSON.stringify({event:'disclosure.classified',disclosure:request.disclosure??'unprotected',correlationId:request.correlationId})+String.fromCharCode(10));if(req.url==='/v1/route'){res.setHeader('content-type','application/json');res.end(JSON.stringify(gateway.inspect(request)));return}if(req.url==='/v1/stream'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});const response=await gateway.generate(request,abort.signal,routing=>send({type:'routing',routing}));await send({type:'done',response});res.end();return}res.setHeader('content-type','application/json');res.end(JSON.stringify(await gateway.generate(request,abort.signal)))}))}catch(e){const error={code:e instanceof ModelGatewayError?e.code:'PROVIDER_ERROR' as const,retryable:e instanceof ModelGatewayError?e.retryable:false};if(!res.headersSent){res.statusCode=502;res.setHeader('content-type','application/json');res.end(JSON.stringify({error}))}else if(!res.destroyed){res.end(`data: ${JSON.stringify({type:'error',error})}\n\n`)}}
});
server.listen(Number(process.env.JARVIS_GATEWAY_PORT??7430),host);for(const sig of['SIGTERM','SIGINT']as const)process.once(sig,()=>server.close(()=>process.exit(0)));
