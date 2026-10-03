import type { SystemTelemetrySnapshot } from '@jarvis/scene';
export interface TelemetryFinding {key:string;title:string;body:string;reasoningRequired?:boolean;}
// Deterministic threshold incidents need no model. Missing optional GPU readings
// never create an incident. Unknown root causes remain observations for Argus.
export class TelemetryMonitor {
  private consecutive=new Map<string,number>();private lastAt?:string;private previousQueue?:number;private queueGrowth=0;
  evaluate(snapshot:SystemTelemetrySnapshot):TelemetryFinding[]{
    if(snapshot.generatedAt===this.lastAt)return [];this.lastAt=snapshot.generatedAt;
    const findings:TelemetryFinding[]=[];
    for(const [key,threshold]of [['cpu',95],['ram',95],['disk',95],['postgresSaturation',90],['agentLeaseTimeouts',0],['gpuTemperature',90],['natsRedeliveries',100],['gatewayProvidersOffline',0],['gatewayCircuitOpen',0]] as const){
      const r=snapshot.readings[key];const anomalous=r?.status==='available'&&r.value!==null&&r.value>threshold;
      const count=anomalous?(this.consecutive.get(key)??0)+1:0;this.consecutive.set(key,count);
      if(count===3||(count>3&&count%90===0))findings.push({key:'telemetry.'+key,title:'System telemetry: '+key,body:`${key} exceeded ${threshold} ${r!.unit} in three consecutive samples. Inspect Operations for evidence.`});
    }
    for(const key of ['postgres','redis','nats']){const r=snapshot.readings[key];const down=r?.status==='available'&&r.value===0;const count=down?(this.consecutive.get(key)??0)+1:0;this.consecutive.set(key,count);if(count===2||(count>2&&count%90===0))findings.push({key:'telemetry.'+key,title:key+' connection unavailable',body:'Two consecutive connection probes failed. No autonomous remediation was performed.'});}
    const queue=snapshot.readings.queue;
    if(queue?.status==='available'&&queue.value!==null){
      this.queueGrowth=this.previousQueue!==undefined&&queue.value>this.previousQueue?this.queueGrowth+1:0;this.previousQueue=queue.value;
      if(this.queueGrowth===3&&snapshot.readings.postgres?.value===1&&snapshot.readings.redis?.value===1)findings.push({key:'telemetry.queue.growth',title:'Unexplained sustained queue growth',body:'The queue grew in three consecutive samples while dependency probes were healthy. Root cause is unknown; a bounded local Argus review is eligible when available.',reasoningRequired:true});
    }else{this.queueGrowth=0;this.previousQueue=undefined;}
    return findings;
  }
}
