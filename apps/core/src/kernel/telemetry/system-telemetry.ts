import type { VisionDiagnostics } from '@jarvis/contracts';
import { optionalHostProbes } from './host-probes.ts';
import { cpus, freemem, totalmem, loadavg, platform } from 'node:os';
import type { Sql } from '@jarvis/persistence';
import type { SystemTelemetrySnapshot, TelemetryReading } from '@jarvis/scene';
import { exportGauges } from '@jarvis/telemetry';

// Fixed queries only. No browser-supplied query, URL, labels, or raw response.
export const TELEMETRY_QUERIES: Record<string, [string, string]> = {
  disk: ['100 * (1 - sum(windows_logical_disk_free_bytes) / sum(windows_logical_disk_size_bytes))', '%'],
  network: ['sum(rate(windows_net_bytes_total[2m]))', 'B/s'],
  gpu: ['max(DCGM_FI_DEV_GPU_UTIL)', '%'],
  gpuVram: ['sum(DCGM_FI_DEV_FB_USED) * 1048576', 'bytes'],
  gpuTemperature: ['max(DCGM_FI_DEV_GPU_TEMP)', 'Celsius'],
  gpuPower: ['sum(DCGM_FI_DEV_POWER_USAGE)', 'W'],
  redisMemory: ['redis_memory_used_bytes', 'bytes'],
  redisConnections: ['redis_connected_clients', 'connections'],
  natsStreamHealth: ['1 - max(jetstream_server_jetstream_disabled)', 'enabled'],
  natsStreams: ['sum(jetstream_server_total_streams)', 'streams'],
  natsStorage: ['sum(jetstream_server_total_message_bytes)', 'bytes'],
  natsConsumers: ['sum(jetstream_server_total_consumers)', 'consumers'],
  natsPending: ['sum(jetstream_consumer_num_pending)', 'messages'],
  natsRedeliveries: ['sum(jetstream_consumer_num_redelivered)', 'messages'],
  gatewayLatency: ['sum(rate(jarvis_span_duration_seconds_total{stage="model.provider.request"}[2m])) / sum(rate(jarvis_span_calls_total{stage="model.provider.request"}[2m])) * 1000', 'ms'],
  models: ['jarvis_gateway_models', 'models'],
  gateway: ['max(jarvis_gateway_provider_healthy) > bool 0', 'healthy'],
  gatewayProvidersHealthy: ['jarvis_gateway_provider_healthy', 'providers'],
  gatewayCircuitOpen: ['jarvis_gateway_circuit_open', 'circuits'],
  gatewayProvidersOffline: ['jarvis_gateway_provider_offline', 'providers'],
  gatewayCost: ['jarvis_gateway_cost_estimate', 'process cost estimate'],
  postgresAppendLatency: ['sum(rate(jarvis_span_duration_seconds_total{stage="postgres.event_append"}[2m])) / sum(rate(jarvis_span_calls_total{stage="postgres.event_append"}[2m])) * 1000', 'ms'],
  gatewayRate: ['sum(rate(jarvis_span_calls_total{stage="model.provider.request"}[2m]))', 'requests/s'],
  gatewayErrors: ['sum(rate(jarvis_span_errors_total{stage="model.provider.request"}[2m]))', 'errors/s'],
  gatewayActive: ['sum(jarvis_span_active{stage="model.provider.request"})', 'requests'],
};
export function parsePrometheusReading(body: unknown, unit: string, now: number): TelemetryReading {
  const missing: TelemetryReading = {value:null,unit,status:'unavailable',observedAt:null};
  const response = body as {status?:string;data?:{resultType?:string;result?:Array<{value?:[number,string]}>}};
  if (response?.status !== 'success' || response.data?.resultType !== 'vector' || response.data.result?.length !== 1) return missing;
  const sample = response.data.result[0]?.value;
  if (!sample || !Number.isFinite(sample[0]) || !Number.isFinite(Number(sample[1])) || sample[0]*1000 > now+5000) return missing;
  if(now-sample[0]*1000>60_000)return {...missing,status:'stale',observedAt:new Date(sample[0]*1000).toISOString()};
  return {value:Number(sample[1]),unit,status:'available',observedAt:new Date(sample[0]*1000).toISOString()};
}
export class SystemTelemetry {
  private previousCpu?: {idle:number;total:number};
  private cached?: SystemTelemetrySnapshot;
  private inFlight?: Promise<SystemTelemetrySnapshot>;
  private history: SystemTelemetrySnapshot['history'] = [];
  constructor(private readonly deps: {sql:Sql; redisPing:()=>Promise<boolean>; prometheusUrl?:string; fetch?:typeof fetch; sourceHealth?:()=>Record<string,number|null>; vision?:()=>VisionDiagnostics|undefined; voice?:()=>{ready:boolean;deviceReady:boolean;updatedAt:string;processingLatencyMs:number;droppedObservations?:number}|undefined}) {}
  snapshot(): Promise<SystemTelemetrySnapshot> {
    if(this.cached && Date.now()-Date.parse(this.cached.generatedAt)<10_000)return Promise.resolve(structuredClone(this.cached));
    return (this.inFlight ??= this.collect().finally(()=>{this.inFlight=undefined;})).then(snapshot=>structuredClone(snapshot));
  }
  private async collect(): Promise<SystemTelemetrySnapshot> {
    const at=new Date().toISOString(), readings:Record<string,TelemetryReading>={};
    const set=(key:string,value:number|null,unit:string)=>{readings[key]={value:Number.isFinite(value)?value:null,unit,status:value!==null&&Number.isFinite(value)?'available':'unavailable',observedAt:value!==null?at:null};};
    const cpu=cpus().reduce((sum,cpu)=>({idle:sum.idle+cpu.times.idle,total:sum.total+Object.values(cpu.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});
    const previous=this.previousCpu;this.previousCpu=cpu;
    set('cpu',previous&&cpu.total>previous.total?100*(1-(cpu.idle-previous.idle)/(cpu.total-previous.total)):null,'%');
    set('ram',100*(1-freemem()/totalmem()),'%');set('ramBytes',totalmem()-freemem(),'bytes');
    set('load',platform()==='win32'?null:loadavg()[0]??null,'load');
    const nativeHost=optionalHostProbes();
    await Promise.all(Object.entries(TELEMETRY_QUERIES).map(async([key,[query,unit]])=>{
      set(key,null,unit);
      if(!this.deps.prometheusUrl)return;
      try{const url=new URL('/api/v1/query',this.deps.prometheusUrl);url.searchParams.set('query',query);
        const response=await(this.deps.fetch??fetch)(url,{signal:AbortSignal.timeout(2000),redirect:'error'});
        if(response.ok)readings[key]=parsePrometheusReading(await response.json(),unit,Date.now());
      }catch{/* Optional engineering plane never blocks authority. */}
    }));
    for(const[key,value]of Object.entries(await nativeHost))if(readings[key]?.status!=='available')set(key,value,TELEMETRY_QUERIES[key]?.[1]??'');
    const vision=this.deps.vision?.();const visionFresh=vision&&Date.now()-Date.parse(vision.updatedAt)<30_000;
    set('vision',visionFresh?Number(vision.status==='ready'):null,'ready');set('visionLatency',visionFresh?vision.inferenceLatencyMs:null,'ms');set('visionDropped',visionFresh?vision.droppedFrames:null,'frames');
    set('visionDevice',visionFresh&&vision.cameraId?Number(vision.status!=='offline'):null,'connected');
    const voice=this.deps.voice?.();const voiceFresh=voice&&Date.now()-Date.parse(voice.updatedAt)<30_000;
    set('voice',voiceFresh?Number(voice.ready):null,'ready');set('voiceDevice',voiceFresh?Number(voice.deviceReady):null,'connected');set('voiceLatency',voiceFresh?voice.processingLatencyMs:null,'ms');set('voiceDropped',voiceFresh?voice.droppedObservations??null:null,'observations');
    set('postgresPoolSaturation',null,'% pool busy');set('postgresPoolAwaiting',null,'queries');
    const redisStart=performance.now();let redisTimer:ReturnType<typeof setTimeout>|undefined;try{const ok=await Promise.race([this.deps.redisPing(),new Promise<boolean>((resolve)=>{redisTimer=setTimeout(()=>resolve(false),1500);})]);set('redis',ok?1:0,'connected');set('redisLatency',ok?performance.now()-redisStart:null,'ms');}catch{set('redis',0,'connected');set('redisLatency',null,'ms');}finally{if(redisTimer)clearTimeout(redisTimer);}
    const queries: Array<[string,string,()=>Promise<Record<string,unknown>[]>]> = [
      ['outbox','events',()=>this.deps.sql`select count(*)::float8 as value from events.outbox where dispatched_at is null`],
      ['eventDepth','events',()=>this.deps.sql`select count(*)::float8 as value from events.events`],
      ['postgresPoolBusy','connections',()=>this.deps.sql`select count(*)::float8 as value from pg_stat_activity where application_name='jarvis-core' and pid<>pg_backend_pid() and state in ('active','idle in transaction')`],
      ['postgresSize','bytes',()=>this.deps.sql`select pg_database_size(current_database())::float8 as value`],
      ['postgresConnections','connections',()=>this.deps.sql`select count(*)::float8 as value from pg_stat_activity where datname=current_database()`],
      ['postgresCapacity','connections',()=>this.deps.sql`select current_setting('max_connections')::float8 as value`],
      ['agents','jobs',()=>this.deps.sql`select count(*)::float8 as value from cognition.agent_jobs where state in ('RUNNING','WAITING') and lease_expiry>clock_timestamp()`],
      ['queue','jobs',()=>this.deps.sql`select count(*)::float8 as value from cognition.agent_jobs where state='QUEUED'`],
      ['agentFailures','jobs',()=>this.deps.sql`select count(*)::float8 as value from cognition.agent_jobs where state='FAILED' and created_at>clock_timestamp()-interval '24 hours'`],
      ['agentLeaseTimeouts','jobs',()=>this.deps.sql`select count(*)::float8 as value from cognition.agent_jobs where (state in ('LEASED','RUNNING','WAITING') and lease_expiry<clock_timestamp()) or (error_code='LEASE_EXPIRED' and created_at>clock_timestamp()-interval '24 hours')`],
      ['agentLatency','ms',()=>this.deps.sql`select avg(extract(epoch from (finished_at-started_at))*1000)::float8 as value from cognition.agent_jobs where state='COMPLETE' and finished_at>clock_timestamp()-interval '24 hours'`],
      ['tokens','tokens',()=>this.deps.sql`select sum((usage_observability->>'inputTokens')::float8+(usage_observability->>'outputTokens')::float8)::float8 as value from cognition.runs where status='completed' and created_at>clock_timestamp()-interval '24 hours'`],
      ['cost','cost units estimate',()=>this.deps.sql`select sum(cost_estimate)::float8 as value from cognition.runs where status='completed' and created_at>clock_timestamp()-interval '24 hours'`],
      ['latency','ms',()=>this.deps.sql`select avg(latency_ms)::float8 as value from cognition.runs where status='completed' and created_at>clock_timestamp()-interval '24 hours'`],
    ];
    // Serial probes bound pool impact. Driver query timeout is configured at composition.
    const bounded=async<T>(query:PromiseLike<T>&{cancel?:()=>void}):Promise<T>=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(query),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{query.cancel?.();reject(new Error('telemetry probe timeout'));},1500);})]);}finally{if(timer)clearTimeout(timer);}};
    const start=performance.now();try{await bounded(this.deps.sql`select 1`);set('postgres',1,'connected');set('postgresLatency',performance.now()-start,'ms');}catch{set('postgres',0,'connected');set('postgresLatency',null,'ms');}
    for(const[key,unit,query]of queries){if(readings.postgres?.value!==1){set(key,null,unit);continue;}try{const rows=await bounded(query());const value=rows[0]?.value;set(key,value==null?null:Number(value),unit);}catch{set(key,null,unit);}}
    const poolMax=this.deps.sql.options?.max;
    set('postgresPoolCapacity',typeof poolMax==='number'?poolMax:null,'connections');
    if(readings.postgresPoolBusy?.value!=null&&typeof poolMax==='number'&&poolMax>0)set('postgresPoolSaturation',100*readings.postgresPoolBusy.value/poolMax,'% pool busy');
    if(readings.postgresConnections?.value!=null&&readings.postgresCapacity?.value)set('postgresSaturation',100*readings.postgresConnections.value/readings.postgresCapacity.value,'% server connections');
    try{if(readings.postgres?.value!==1)throw new Error('postgres unavailable');const rows=await bounded(this.deps.sql`select state,count(*)::float8 as value from agency.invocations group by state`);for(const state of ['PROPOSED','AWAITING_APPROVAL','EXECUTING','VERIFYING','COMPLETED','ROLLING_BACK','ROLLED_BACK'])set('agency'+state,Number(rows.find(row=>row.state===state)?.value??0),'invocations');}catch{/* Absent schema is unavailable, not zero. */}
    for(const[key,value]of Object.entries(this.deps.sourceHealth?.()??{}))set(key,value,'healthy');
    void exportGauges(Object.fromEntries(Object.entries(readings).filter(([,r])=>r.status==='available'&&r.value!==null).map(([key,r])=>['jarvis_system_'+key,r.value!])));
    this.history.push({at,values:Object.fromEntries(Object.entries(readings).map(([k,v])=>[k,v.value]))});this.history=this.history.slice(-120);
    this.cached={generatedAt:at,window:'24h',overallHealth:readings.postgres?.value===0||readings.redis?.value===0?'degraded':'unknown',readings,history:[...this.history]};return structuredClone(this.cached);
  }
}
