"use client";
import { useEffect, useState } from 'react';
import type { SystemTelemetrySnapshot } from '@jarvis/scene';
const fields=[['cpu','CPU'],['gpu','GPU'],['ram','RAM'],['tokens','TOKENS'],['latency','LATENCY'],['cost','COST'],['agents','AGENTS'],['queue','QUEUE'],['network','NETWORK']] as const;
function Sparkline({values}:{values:Array<number|null>}){
  const finite=values.filter((v):v is number=>v!==null&&Number.isFinite(v));if(finite.length<2)return <span>History unavailable</span>;
  const min=Math.min(...finite),range=Math.max(...finite)-min||1;
  // Separate segments at missing samples; never bridge missing measurements.
  const segments:string[]=[];let segment:string[]=[];
  values.forEach((v,i)=>{if(v===null){if(segment.length)segments.push(segment.join(' '));segment=[];}else segment.push(`${i*160/Math.max(values.length-1,1)},${35-(v-min)*30/range}`);});if(segment.length)segments.push(segment.join(' '));
  return <svg viewBox="0 0 160 40" role="img" aria-label="Recent measured samples">{segments.map((points,i)=><polyline key={i} points={points} fill="none" stroke="currentColor" strokeWidth="1.5"/>)}</svg>;
}
export function TelemetryRail({snapshot,live,degraded=false}:{snapshot?:SystemTelemetrySnapshot;live:boolean;degraded?:boolean}){
  const [expanded,setExpanded]=useState(false);const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[]);
  const fresh=live&&snapshot&&now-Date.parse(snapshot.generatedAt)<30_000&&now-Date.parse(snapshot.generatedAt)>=-5000;
  const format=(key:string)=>{const r=fresh?snapshot?.readings[key]:undefined;return !r||r.value===null||r.status!=='available'?'Unavailable':`${new Intl.NumberFormat('en-GB',{maximumFractionDigits:key==='cost'?4:1,notation:r.value>100000?'compact':'standard'}).format(r.value)} ${r.unit}`;};
  return <section className="telemetry-rail" aria-label="System telemetry"><div className="telemetry-collapsed">{fields.map(([key,label])=><div key={key}><small>{label}</small><strong>{format(key)}</strong></div>)}<div><small>SYSTEM HEALTH</small><strong>{fresh?(degraded?'DEGRADED':snapshot.overallHealth.toUpperCase()):'UNAVAILABLE'}</strong></div><button aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'COLLAPSE':'OPERATIONS'}</button></div>{expanded&&<div className="telemetry-expanded"><p>Measured samples / session history / tokens, cost and completion latency cover 24 hours / cost is an estimate</p>{!fresh&&<p role="status">Fresh Kernel telemetry is unavailable. History is shown only while connected.</p>}<div className="telemetry-charts">{Object.keys(snapshot?.readings??{}).map(key=><article key={key}><small>{key}</small><strong>{format(key)}</strong><Sparkline values={fresh?snapshot.history.map(sample=>sample.values[key]??null):[]}/></article>)}</div></div>}</section>;
}
