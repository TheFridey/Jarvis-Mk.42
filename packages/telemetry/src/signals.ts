import { currentTraceId } from './index.ts';
let resource: Record<string,string> = {};
let endpoint: string | undefined;
let activeExports=0;let droppedExports=0;let failedExports=0;let lastExportAt:string|undefined;
export function signalDiagnostics(){return{activeExports,droppedExports,failedExports,lastExportAt};}
let timer: ReturnType<typeof setInterval> | undefined;
const stageStart=String(BigInt(Date.now())*1000000n);
const stages = new Map<string,{calls:number;errors:number;active:number;duration:number}>();
const attributes=(values:Record<string,string>)=>Object.entries(values).map(([key,stringValue])=>({key,value:{stringValue}}));
async function send(kind:'metrics'|'logs',body:unknown) {
  if(!endpoint)return;
  if(activeExports>=8){droppedExports++;return;}activeExports++;
  try{const response=await fetch(new URL('/v1/'+kind,endpoint),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(2000),redirect:'error'});if(response.ok)lastExportAt=new Date().toISOString();else failedExports++;}catch{failedExports++;/* Export failure must not fail an authorized operation. */}finally{activeExports--;}
}
export function signalNode(){return resource['service.instance.id']??'unknown';}
export function signalsEnabled(){return Boolean(endpoint);}
export function startSignals(options:{serviceName:string;nodeId?:string;otlpEndpoint?:string;disabled?:boolean}){
  if(options.disabled)return;endpoint=options.otlpEndpoint??'http://localhost:4318';resource={'service.name':options.serviceName,'service.instance.id':options.nodeId??'unknown'};
  if(!timer){timer=setInterval(()=>{void exportStages()},15000);timer.unref();}
}
export async function stopSignals(){if(timer)clearInterval(timer);timer=undefined;await exportStages();endpoint=undefined;stages.clear();}
export function beginStage(name:string){
  // Only static instrumentation names become metric labels.
  if(!/^(kernel|context|agent|model|model_gateway|agency|event|outbox|persistence|postgres|adapter|verification)[a-z_.]{0,80}$/.test(name))return()=>{};
  let metric=stages.get(name);if(!metric){if(stages.size>=64)return()=>{};metric={calls:0,errors:0,active:0,duration:0};stages.set(name,metric);}
  metric.active++;const start=performance.now();return(failed=false)=>{metric!.active--;metric!.calls++;metric!.duration+=(performance.now()-start)/1000;if(failed)metric!.errors++;};
}
export async function exportGauges(values:Record<string,number>){
  const timeUnixNano=String(BigInt(Date.now())*1000000n);
  await send('metrics',{resourceMetrics:[{resource:{attributes:attributes(resource)},scopeMetrics:[{scope:{name:'jarvis'},metrics:Object.entries(values).filter(([,value])=>Number.isFinite(value)).map(([name,asDouble])=>({name,gauge:{dataPoints:[{timeUnixNano,asDouble}]}}))}]}]});
}
async function exportStages(){
  const timeUnixNano=String(BigInt(Date.now())*1000000n);
  const metrics=['calls','errors','active','duration'].map(kind=>{
    const dataPoints=[...stages].map(([stage,m])=>({attributes:attributes({stage}),timeUnixNano,startTimeUnixNano:stageStart,asDouble:m[kind as keyof typeof m]}));
    return {name:'jarvis_span_'+(kind==='duration'?'duration_seconds':kind==='active'?'active':kind+'_total'),...(kind==='active'?{gauge:{dataPoints}}:{sum:{dataPoints,aggregationTemporality:2,isMonotonic:true}})};
  });
  await send('metrics',{resourceMetrics:[{resource:{attributes:attributes(resource)},scopeMetrics:[{scope:{name:'jarvis'},metrics}]}]});
}
// Deliberate allowlist: no free-form message, exception, prompt, payload, URL,
// credential, transcript, file path, device label, or provider response is logged.
export async function structuredLog(input:{component:string;node:string;event:string;correlationId?:string;causationId?:string;severity?:'INFO'|'ERROR';durationMs?:number}){
  const safeId=(value:string|undefined)=>value&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)?value:undefined;
  const record={component:safeId(input.component),node:safeId(input.node),event:safeId(input.event),correlationId:safeId(input.correlationId)??null,causationId:safeId(input.causationId)??null,traceId:currentTraceId()??null,...(Number.isFinite(input.durationMs)?{durationMs:input.durationMs}:{})};
  const body=JSON.stringify(record);process.stdout.write(body+'\n');
  await send('logs',{resourceLogs:[{resource:{attributes:attributes(resource)},scopeLogs:[{scope:{name:'jarvis'},logRecords:[{timeUnixNano:String(BigInt(Date.now())*1000000n),severityText:input.severity??'INFO',body:{stringValue:body},...(record.traceId?{traceId:record.traceId}:{})}]}]}]});
}
