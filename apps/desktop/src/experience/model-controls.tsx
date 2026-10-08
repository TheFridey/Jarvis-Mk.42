'use client';
import { useState } from 'react';
import type { DesktopKernelSnapshot, UsagePeriod } from '@jarvis/scene';
import { VISUAL_PRESETS, type VisualPreset } from './cinematic-palette.ts';
const PERIODS:Record<UsagePeriod,string>={'24h':'24 hours',week:'1 week',month:'1 month',all:'All time'};
export function ModelControls({picture,modelId,preset,onPreset,preferredModel,onPreferredModel,current}:{picture?:DesktopKernelSnapshot;modelId?:string;preset:VisualPreset;onPreset:(value:VisualPreset)=>void;preferredModel:string;onPreferredModel:(id:string)=>void;current:boolean}) {
 const [usageModel,setUsageModel]=useState<string>();
 const selectedModel=usageModel??modelId;
 const modelIds=Array.from(new Set([...(picture?.modelUsage?.models.map(row=>row.modelId)??[]),...(modelId?[modelId]:[])]));
 const [period,setPeriod]=useState<UsagePeriod>('24h');
 const usage=picture?.modelUsage?.models.find(row=>row.modelId===selectedModel&&row.period===period);
 const run=[...(picture?.activeModels??[]),...(picture?.recentModelRuns??[])].filter(r=>r.modelId===selectedModel&&r.usage?.limits).sort((a,b)=>Date.parse(b.usage!.limits!.observedAt)-Date.parse(a.usage!.limits!.observedAt))[0];
 const limits=run?.usage?.limits;
 const age=limits?Date.now()-Date.parse(limits.observedAt):Infinity;
 const dollars=(n:number|null|undefined)=>n===null||n===undefined?'Unreported':`$${n.toFixed(4)}`;
 return <details className="model-controls"><summary>MODEL VISUALS & USAGE</summary>
  <label>Preferred inference model<input aria-label="Preferred inference model" value={preferredModel} onChange={e=>onPreferredModel(e.target.value)} placeholder="Automatic routing"/></label>
  <p>Preferred for typed requests when available. GPT-6.1 Sol is the default. Privacy rules and fallback still apply.</p>
  <label>Visual preset<select aria-label="Model visual preset" value={preset} onChange={e=>onPreset(e.target.value as VisualPreset)}>{Object.entries(VISUAL_PRESETS).map(([id,value])=><option key={id} value={id}>{value.label}</option>)}</select></label>
  <p>Saved for this model. Visual changes do not reroute inference. Observed model: {modelId??'Unreported'}</p>
  <label>Usage model<select aria-label="Usage model" value={selectedModel??''} onChange={e=>setUsageModel(e.target.value)}><option value="" disabled>Select a recorded model</option>{modelIds.map(id=><option key={id} value={id}>{id}</option>)}</select></label>
  <label>Spend period<select aria-label="Model spend period" value={period} onChange={e=>setPeriod(e.target.value as UsagePeriod)}>{Object.entries(PERIODS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
  <p>{current?'Completed JARVIS runs':'Offline · last received data'} · 1 month = 30 days</p>
  <dl><div><dt>Provider-reported spend (USD)</dt><dd>{`${dollars(usage?.actualCost)}${usage&&usage.measuredCostRequests<usage.requests?' · partial':''}`}</dd></div><div><dt>Reported coverage</dt><dd>{usage?`${usage.measuredCostRequests} / ${usage.requests} calls`:'No stored usage'}</dd></div><div><dt>Estimated cost</dt><dd>{usage?.estimatedCost==null?'Unreported':`${usage.estimatedCost.toFixed(4)} units`}</dd></div><div><dt>Input / output tokens</dt><dd>{usage?`${usage.inputTokens??'—'} / ${usage.outputTokens??'—'}`:'Unreported'}</dd></div></dl>
  <h3>Provider limits</h3><p>{limits?`${limits.scope} · ${age>60000||!current?'Last observation — may have reset':'Recently observed'}`:'Provider has not reported rate limits.'}</p>
  {limits&&<dl><div><dt>Requests remaining / limit</dt><dd>{limits.remainingRequests??'—'} / {limits.requests??'—'}</dd></div><div><dt>Tokens remaining / limit</dt><dd>{limits.remainingTokens??'—'} / {limits.tokens??'—'}</dd></div>{(limits.keyLimitUSD!==undefined||limits.keyUnlimited)&&<div><dt>Shared key spend limit</dt><dd>{limits.keyUnlimited?'No key cap':dollars(limits.keyLimitUSD)}</dd></div>}{limits.keyRemainingUSD!==undefined&&<div><dt>Shared key remaining</dt><dd>{dollars(limits.keyRemainingUSD)}</dd></div>}<div><dt>Request / token reset</dt><dd>{limits.resetRequests??'—'} / {limits.resetTokens??'—'}</dd></div></dl>}
  <p>Account subscription allowances and API credits are separate. This view counts recorded completed JARVIS runs; unreported costs stay unknown.</p>
 </details>;
}
