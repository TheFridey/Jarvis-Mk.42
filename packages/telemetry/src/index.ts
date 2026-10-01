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
class DiagnosticExporter implements SpanExporter{constructor(private inner:SpanExporter){}export(spans:ReadableSpan[],cb:(result:any)=>void){this.inner.export(spans,(result)=>{if(result.code===0){diagnostic.lastExportAt=new Date().toISOString();diagnostic.lastError=undefined}else diagnostic.lastError=result.error?.message??'export failed';cb(result)})}shutdown(){return this.inner.shutdown()}forceFlush(){return this.inner.forceFlush?.()??Promise.resolve()}}
export function startTelemetry(opts:TelemetryOptions):void{if(opts.disabled||sdk){diagnostic.enabled=!opts.disabled;return}const endpoint=opts.otlpEndpoint??'http://localhost:4318/v1/traces';const exporter=new DiagnosticExporter(opts.spanExporter??new OTLPTraceExporter({url:endpoint}));processor=new SimpleSpanProcessor(exporter);sdk=new NodeSDK({resource:resourceFromAttributes({[ATTR_SERVICE_NAME]:opts.serviceName,[ATTR_SERVICE_VERSION]:opts.serviceVersion,'service.instance.id':opts.nodeId??'unknown','deployment.environment.name':opts.environment??process.env.NODE_ENV??'development','jarvis.node.id':opts.nodeId??'unknown'}),spanProcessors:[processor],instrumentations:[new HttpInstrumentation(),new UndiciInstrumentation(),new IORedisInstrumentation(),new NetInstrumentation()]});sdk.start();diagnostic={enabled:true,started:true,endpoint,lastExportAt:undefined,lastError:undefined}}
export async function stopTelemetry(){if(sdk){await sdk.shutdown();sdk=undefined;processor=undefined}diagnostic={...diagnostic,started:false}}
export async function flushTelemetry(){await processor?.forceFlush()}
export function telemetryDiagnostics(){return{...diagnostic}}
export function tracer(){return trace.getTracer(TRACER_NAME)}
export function currentTraceId(){const id=trace.getSpan(context.active())?.spanContext().traceId;return id&&id!=='00000000000000000000000000000000'?id:undefined}
export async function withSpan<T>(name:string,attrs:Record<string,string|number|boolean>,fn:(span:Span)=>Promise<T>):Promise<T>{return tracer().startActiveSpan(name,async span=>{for(const[k,v]of Object.entries(attrs))span.setAttribute(k,v);try{const out=await fn(span);span.setStatus({code:SpanStatusCode.OK});return out}catch(err){span.recordException(err as Error);span.setStatus({code:SpanStatusCode.ERROR,message:err instanceof Error?err.message:String(err)});throw err}finally{span.end()}})}
const getter:TextMapGetter<Record<string,string|undefined>>={keys:c=>Object.keys(c),get:(c,k)=>c[k]};const setter:TextMapSetter<Record<string,string>>={set:(c,k,v)=>{c[k]=v}};
export function injectTraceHeaders(headers:Record<string,string>={}){propagation.inject(context.active(),headers,setter);return headers}
export function extractTraceContext(headers:Record<string,string|undefined>){return propagation.extract(context.active(),headers,getter)}
export function withTraceContext<T>(traceContext: Context, fn: () => T): T { return context.with(traceContext, fn); }
