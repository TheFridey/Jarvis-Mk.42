import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VoiceMeasurement } from './adapters.ts';
const checks=['wake','partial','reply','barge-in','same-context','self-trigger','device-recovery','input-switch','output-switch'] as const;
export type QualificationCheck=typeof checks[number];
/** No transcripts, utterances, credentials or audio enter qualification artifacts. */
export class VoiceQualification {
 private measurements:VoiceMeasurement[]=[];private results=new Map<QualificationCheck,'PASS'|'FAIL'>();
 private started=performance.now();private falseWakes=0;private selfTriggers=0;private baselineStarted?:number;private baselineMs=0;
 constructor(private adapter:string){}
 record=(value:VoiceMeasurement)=>{if(Number.isFinite(value.latencyMs)&&value.latencyMs>=0&&this.measurements.length<10000)this.measurements.push(value);};
 mark(name:string,result:string){if(!checks.includes(name as QualificationCheck)||!['PASS','FAIL'].includes(result))throw new Error('Use /mark <check> PASS|FAIL');this.results.set(name as QualificationCheck,result as 'PASS'|'FAIL');}
 falseWake(){if(this.baselineStarted===undefined)throw new Error('False wake observations require an active baseline');this.falseWakes++;}selfTrigger(){this.selfTriggers++;}
 baseline(value:'start'|'stop'){if(value==='start'){if(this.baselineStarted===undefined)this.baselineStarted=performance.now();}else if(this.baselineStarted!==undefined){this.baselineMs+=performance.now()-this.baselineStarted;this.baselineStarted=undefined;}}
 report(){
  const minutes=(performance.now()-this.started)/60000;
  const summary=Object.fromEntries([...new Set(this.measurements.map(x=>x.name))].map(name=>{const values=this.measurements.filter(x=>x.name===name).map(x=>x.latencyMs).sort((a,b)=>a-b);return[name,{count:values.length,minMs:values[0]!,medianMs:values[Math.floor(values.length/2)]!,p95Ms:values[Math.min(values.length-1,Math.ceil(values.length*.95)-1)]!}];}));
  const baselineMinutes=(this.baselineMs+(this.baselineStarted===undefined?0:performance.now()-this.baselineStarted))/60000;
  const complete=checks.every(k=>this.results.get(k)==='PASS')&&this.falseWakes===0&&this.selfTriggers===0&&baselineMinutes>=10&&this.measurements.filter(m=>m.name==='wake').length>=3&&['asr','interruption','response','device-recovery'].every(name=>this.measurements.some(m=>m.name===name));
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),adapter:this.adapter,rawAudioPersisted:false,hardwareVerified:complete,qualificationBasis:'operator-attested functional checks plus host timings; acoustic latency unmeasured',operatorAttested:this.results.size>0,observationMinutes:minutes,baselineMinutes,falseWakeCount:this.falseWakes,falseWakesPerHour:baselineMinutes>0?this.falseWakes*60/baselineMinutes:null,selfTriggerCount:this.selfTriggers,checks:Object.fromEntries(checks.map(k=>[k,this.results.get(k)??'NOT TESTED'])),timings:summary,measurements:this.measurements,timingBoundary:'Host event arrival to host action completion; response ends at playback-start signal. ASR includes utterance duration. Not acoustic onset/offset measurements.'};
  return report;
 }
 save(){
  const report=this.report(),summary=report.timings,minutes=report.observationMinutes;
  const dir=fileURLToPath(new URL('../../../artifacts/hardware-validation/voice/',import.meta.url));mkdirSync(dir,{recursive:true});const path=resolve(dir,'latest.json');writeFileSync(path,JSON.stringify(report,null,2));
  const rows=Object.entries(summary).map(([name,v])=>`| ${name} | ${v.count} | ${v.medianMs.toFixed(1)} | ${v.p95Ms.toFixed(1)} |`).join('\n');
  writeFileSync(resolve(dir,'latest.md'),`# Voice qualification - ${report.generatedAt}\n\nAdapter: ${this.adapter}. Hardware qualified: ${report.hardwareVerified}. Operator attestation is required; this is not automatic acoustic proof.\n\n${report.timingBoundary}\n\n| Metric | Samples | Median ms | p95 ms |\n| --- | --- | --- | --- |\n${rows}\n\n${checks.map(k=>`- ${k}: ${report.checks[k]}`).join('\n')}\n\nObservation: ${minutes.toFixed(2)} minutes. False wakes: ${this.falseWakes}. Self triggers: ${this.selfTriggers}. No raw audio persisted.\n`);return path;
 }
}
