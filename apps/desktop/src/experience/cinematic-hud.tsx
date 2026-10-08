'use client';
import type { CSSProperties } from 'react';
import type { ModelNode } from './cognition-router-policy.ts';
import type { AgentNode } from './agent-field-policy.ts';
import type { Instrument } from './telemetry-instrument-policy.ts';
import type { ExperiencePhase, DataLiveness } from './experience-phase-policy.ts';
import type { SpatialLayout } from './spatial-layout-policy.ts';
import { modelTint } from './cinematic-palette.ts';

function Trace({instrument}:{instrument:Instrument}) {
  const values=instrument.history, finite=values.filter((v):v is number=>v!==null);
  if(finite.length<2)return <span className="cinematic-no-history">{instrument.status==='stale'?'DATA STALE':'AWAITING SAMPLES'}</span>;
  const max=Math.max(1,...finite),min=Math.min(0,...finite);
  // Missing observations break the path rather than inventing a continuous measurement.
  let open=false;const path=values.map((value,i)=>{if(value===null){open=false;return '';}const part=`${open?'L':'M'}${i/Math.max(1,values.length-1)*200},${36-(value-min)/(max-min)*30}`;open=true;return part;}).join(' ');
  return <svg viewBox="0 0 200 40" preserveAspectRatio="none" aria-label={`${instrument.label} observed history`}><path d={path}/></svg>;
}
export function CinematicHud({models,focused,onFocus,instruments,agents,phase,liveness,layout,onAgents}:{models:ModelNode[];focused?:string;onFocus:(id?:string)=>void;instruments:Instrument[];agents:AgentNode[];phase:ExperiencePhase;liveness:DataLiveness;layout:SpatialLayout;onAgents:()=>void}) {
  const active=models.find(model=>model.route==='SELECTED');
  const shown=models.find(model=>model.modelId===focused)??active;
  const compute=instruments.filter(item=>['cpu','ram','gpu'].includes(item.key));
  const cognition=instruments.filter(item=>['tokens','latency','cost'].includes(item.key));
  return <>
    <div className="cinematic-title"><span>PERSONAL INTELLIGENCE SYSTEM</span><h1>JARVIS<span>MARK / 42</span></h1><p>Intelligence, in motion.</p></div>
    <aside className="cinematic-models" aria-label="Model observatory">
      <div className="cinematic-section-label"><span>01 / COGNITION</span><span>{models.length.toString().padStart(2,'0')}</span></div>
      <h2>Model observatory</h2><p className="cinematic-hint">{focused?'Inspecting recorded model usage':'Following the observed route'}</p>
      {focused&&<button className="cinematic-follow" onClick={()=>onFocus(undefined)}>FOLLOW ACTIVE ROUTE ↗</button>}
      <div className="cinematic-model-list">{models.length?models.map(model=><button key={model.modelId} style={{'--model-accent':modelTint(model.modelId)} as CSSProperties} className={`cinematic-model${shown?.modelId===model.modelId?' chosen':''}${model.departing?' departing':''}`} aria-pressed={shown?.modelId===model.modelId} onClick={()=>onFocus(model.modelId===focused?undefined:model.modelId)}>
        <span className="cinematic-model-glyph">{model.glyph}</span><span className="cinematic-model-name"><strong>{model.displayName}</strong><small>{model.provider??'PROVIDER UNREPORTED'} / {model.locality==='local'?'LOCAL':model.locality==='cloud-ok'?'CLOUD':'UNREPORTED'}</small></span><i className={model.route==='SELECTED'&&liveness.current?'selected':''}/>
        <span className="cinematic-model-state">{!liveness.current?'STALE':model.activity.replaceAll('-',' ').toUpperCase()}</span>
        <span className="cinematic-usage-track"><b style={{width:`${(model.contextRatio??0)*100}%`}}/></span><span className="cinematic-usage-label">CONTEXT <em>{model.contextRatio!==undefined?`${(model.contextRatio*100).toFixed(1)}%`:'UNREPORTED'}</em></span>
      </button>):<div className="cinematic-empty">No observed model runs.<small>{liveness.current?'Models appear when JARVIS routes a request.':'Reconnect to receive the model state.'}</small></div>}</div>
      <div className="cinematic-model-detail"><span>{focused?'INSPECTED MODEL':'ACTIVE MODEL'}</span><strong>{shown?.displayName??'Awaiting connection'}</strong><dl><div><dt>OUTPUT RATE</dt><dd>{shown?.tokensPerSecond!==undefined?`${shown.tokensPerSecond.toFixed(1)} t/s`:'—'}</dd></div><div><dt>LATENCY</dt><dd>{shown?.latencyMs!==undefined?`${(shown.latencyMs/1000).toFixed(2)} s`:'—'}</dd></div></dl><p>{shown?.reason??'Usage appears when reported by the model provider.'}</p></div>
    </aside>
    <div className="cinematic-core-caption" style={{left:layout.core.x,top:layout.core.y+layout.coreRadius*1.03}}><span className="cinematic-phase">{phase.replaceAll('_',' ')}</span><strong>{focused?'MODEL OBSERVATORY':liveness.current?'AT YOUR SERVICE':'AWAITING KERNEL'}</strong><small>{focused?'Inspection changes the visual focus only':liveness.synthetic?'Synthetic demonstration':liveness.current?'Connected to your operating environment':'Connect JARVIS to begin'}</small></div>
    <aside className="cinematic-telemetry" aria-label="System telemetry">
      <div className="cinematic-section-label"><span>02 / SYSTEM</span><i/></div><h2>Operating pulse</h2>
      {compute.map(item=><div className={`cinematic-instrument ${item.status}`} key={item.key}><div><span>{item.label}</span><strong>{item.display}</strong></div><div className="cinematic-meter">{Array.from({length:28},(_,i)=><i key={i} className={item.ratio!==undefined&&i/28<item.ratio?'lit':''}/>)}</div><Trace instrument={item}/></div>)}
      <div className="cinematic-section-label cognition-label"><span>SESSION / TELEMETRY</span></div><dl className="cinematic-session">{cognition.map(item=><div key={item.key}><dt>{item.label}</dt><dd>{item.display}</dd></div>)}</dl>
      <button className="cinematic-agents" onClick={onAgents}><span>AGENT ACTIVITY</span><strong>{agents.length.toString().padStart(2,'0')} <small>↗</small></strong><p>{agents.length?agents.map(agent=>`${agent.name} · ${agent.state}`).join(' / '):'No observed agent jobs'}</p></button>
    </aside>
    <div className="cinematic-bottom-label"><span>J.A.R.V.I.S. / PERSONAL OPERATING LAYER</span><span>{liveness.label}</span></div>
  </>;
}
