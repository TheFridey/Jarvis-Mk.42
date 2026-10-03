import { beginStage, startSignals, stopSignals, structuredLog, signalNode, signalsEnabled, signalDiagnostics } from './signals.ts';
export { exportGauges, structuredLog } from './signals.ts';
import { context, propagation, SpanStatusCode, trace, type Context, type Span, type TextMapGetter, type TextMapSetter } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SimpleSpanProcessor, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
// RC-audit note on auto-instrumentation coverage (2026-09-08):
//   HttpInstrumentation  — live for the node:http diagnostics/ingress server.
//   IORedisInstrumentation — live for the ioredis ephemeral store.
//   NetInstrumentation   — low-level sockets only.
//   UndiciInstrumentation — outbound global fetch/undici operations. Domain
//     spans still wrap model/provider calls so traces remain useful and bounded.
// postgres.js has no supported OTel auto-instrumentation in this stack. Useful
// persistence boundaries are therefore traced explicitly by the Kernel.
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NetInstrumentation } from '@opentelemetry/instrumentation-net';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

export { trace, context, propagation, SpanStatusCode }; export type { Span, ReadableSpan };
const TRACER_NAME='jarvis';let sdk:NodeSDK|undefined;let processor:SimpleSpanProcessor|undefined;let diagnostic={enabled:false,started:false,endpoint:undefined as string|undefined,lastExportAt:undefined as string|undefined,lastError:undefined as string|undefined};
export interface TelemetryOptions {serviceName:string;serviceVersion:string;nodeId?:string;environment?:string;otlpEndpoint?:string;disabled?:boolean;spanExporter?:SpanExporter}
class DiagnosticExporter implements SpanExporter{constructor(private inner:SpanExporter){}export(spans:ReadableSpan[],cb:(result:any)=>void){this.inner.export(spans.map(sanitizeSpan),(result)=>{if(result.code===0){diagnostic.lastExportAt=new Date().toISOString();diagnostic.lastError=undefined}else diagnostic.lastError='export failed';cb(result)})}shutdown(){return this.inner.shutdown()}forceFlush(){return this.inner.forceFlush?.()??Promise.resolve()}}
export function startTelemetry(opts:TelemetryOptions):void{if(opts.disabled||sdk){diagnostic.enabled=!opts.disabled;return}const endpoint=opts.otlpEndpoint??'http://localhost:4318/v1/traces';const exporter=new DiagnosticExporter(opts.spanExporter??new OTLPTraceExporter({url:endpoint}));processor=new SimpleSpanProcessor(exporter);sdk=new NodeSDK({resource:resourceFromAttributes({[ATTR_SERVICE_NAME]:opts.serviceName,[ATTR_SERVICE_VERSION]:opts.serviceVersion,'service.instance.id':opts.nodeId??'unknown','deployment.environment.name':opts.environment??process.env.NODE_ENV??'development','jarvis.node.id':opts.nodeId??'unknown'}),spanProcessors:[processor],instrumentations:[new HttpInstrumentation(),new UndiciInstrumentation(),new IORedisInstrumentation(),new NetInstrumentation()]});sdk.start();startSignals(opts);diagnostic={enabled:true,started:true,endpoint:safeEndpoint(endpoint),lastExportAt:undefined,lastError:undefined}}
export async function stopTelemetry(){await stopSignals();if(sdk){await sdk.shutdown();sdk=undefined;processor=undefined}diagnostic={...diagnostic,started:false}}
export async function flushTelemetry(){await processor?.forceFlush()}
export function telemetryDiagnostics(){return{...diagnostic,signals:signalDiagnostics()}}
export function tracer(){return trace.getTracer(TRACER_NAME)}
export function currentTraceId(){const id=trace.getSpan(context.active())?.spanContext().traceId;return id&&id!=='00000000000000000000000000000000'?id:undefined}
export async function withSpan<T>(name:string,attrs:Record<string,string|number|boolean>,fn:(span:Span)=>Promise<T>):Promise<T>{const finish=beginStage(name);const started=performance.now();let failed=false;return tracer().startActiveSpan(name,async span=>{for(const[k,v]of Object.entries(attrs))span.setAttribute(k,v);try{const out=await fn(span);span.setStatus({code:SpanStatusCode.OK});return out}catch(err){failed=true;span.setStatus({code:SpanStatusCode.ERROR});throw err}finally{finish(failed);if(signalsEnabled()&&!name.startsWith('HTTP')&&!name.startsWith('tcp'))void structuredLog({component:name.split('.')[0]??'telemetry',node:signalNode(),event:name,durationMs:performance.now()-started,causationId:typeof attrs['jarvis.causation_id']==='string'?attrs['jarvis.causation_id']:undefined,correlationId:typeof attrs['jarvis.correlation_id']==='string'?attrs['jarvis.correlation_id']:undefined,severity:failed?'ERROR':'INFO'});span.end()}})}
const getter:TextMapGetter<Record<string,string|undefined>>={keys:c=>Object.keys(c),get:(c,k)=>c[k]};const setter:TextMapSetter<Record<string,string>>={set:(c,k,v)=>{c[k]=v}};
export function injectTraceHeaders(headers:Record<string,string>={}){propagation.inject(context.active(),headers,setter);return headers}
export function extractTraceContext(headers:Record<string,string|undefined>){return propagation.extract(context.active(),headers,getter)}
export function withTraceContext<T>(traceContext: Context, fn: () => T): T { return context.with(traceContext, fn); }

export function sanitizeSpan(span:ReadableSpan):ReadableSpan {
  const attributes:ReadableSpan['attributes']={};
  for(const [key,value]of Object.entries(span.attributes)){
    if(['jarvis.probe','jarvis.correlation_id','jarvis.causation_id','jarvis.node.id','jarvis.agent.id','jarvis.model.id','jarvis.model.provider','jarvis.model.task','jarvis.capability.id','jarvis.capability.action'].includes(key)&&typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(value))attributes[key]=value;
    else if(['http.request.method','http.response.status_code','network.transport','db.system'].includes(key))attributes[key]=value;
  }
  return {...span,name:/^[a-z_.]{1,96}$/.test(span.name)?span.name:'transport.request',attributes,events:[],links:[],status:{code:span.status.code},spanContext:()=>span.spanContext()};
}

function safeEndpoint(value:string):string|undefined {try{const url=new URL(value);url.username='';url.password='';url.search='';url.hash='';return url.toString();}catch{return undefined;}}

export function telemetryNodeId(){return signalNode();}
