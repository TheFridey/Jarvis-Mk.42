import { startTelemetry, withSpan, exportGauges, flushTelemetry, stopTelemetry, currentTraceId } from '../packages/telemetry/src/index.ts';
startTelemetry({serviceName:'jarvis-telemetry-smoke',serviceVersion:'1',nodeId:'local-smoke'});
let traceId:string|undefined;const probeValue=Date.now();
await withSpan('kernel.telemetry.smoke',{'jarvis.correlation_id':'telemetry-smoke'},async()=>{traceId=currentTraceId();await exportGauges({jarvis_telemetry_smoke:probeValue});});
await flushTelemetry();await stopTelemetry();const get=async(url:string)=>{const res=await fetch(url,{signal:AbortSignal.timeout(3000)});if(!res.ok)throw new Error('Observability read failed: '+res.status);return await res.json();};
const deadline=Date.now()+60000;
let verified=false;
while(Date.now()<deadline){
 try{
  const metrics=await get('http://127.0.0.1:9090/api/v1/query?query=jarvis_telemetry_smoke');
  const traces=await get('http://127.0.0.1:3200/api/traces/'+traceId);
  const logs=await get('http://127.0.0.1:3100/loki/api/v1/query_range?query='+encodeURIComponent('{service_name="jarvis-telemetry-smoke"}'));
  if(metrics.data?.result?.some((series:{value:[number,string]})=>Number(series.value[1])===probeValue)&&traces.batches?.length&&logs.data?.result?.some((stream:{values:Array<[string,string]>})=>stream.values.some(([,line])=>line.includes(traceId!)))){verified=true;break;}
 }catch{/* Retry collector batching and Prometheus scrape delay. */}
 await new Promise(resolve=>setTimeout(resolve,2000));
}
if(!verified)throw new Error('Metric/log/trace ingestion verification timed out');
process.stdout.write(JSON.stringify({verified,traceId})+'\n');
