'use client';
import { motion, useReducedMotion } from 'motion/react';
import type { OperatingModelRun } from '@jarvis/scene';

/** Render-only route geometry. A finite pulse is keyed to an observed transition. */
export function ModelRoutingDiagram({run,live}:{run:OperatingModelRun;live:boolean}) {
 const reduced=Boolean(useReducedMotion());
 const routing=run.routing;if(!routing)return null;
 const candidates=routing.candidates.slice(0,12);
 const height=Math.max(70,candidates.length*28);
 return <svg className="routing-diagram" viewBox={`0 0 260 ${height}`} role="img" aria-label={`Observed model routing: ${routing.phase??'candidate evaluation'}${live?'':' — stale'}`}>
   <circle cx="25" cy={height/2} r="19" fill="#101315" stroke="#a0a5aa"/>
   <text x="25" y={height/2+3} textAnchor="middle" fill="#dce2e5" fontSize="8">MK42</text>
   {candidates.map((candidate,index)=>{
    const selected=candidate.modelId===routing.selectedModelId;
    const unavailable=candidate.state==='UNAVAILABLE'||candidate.state==='FAILED';
    const y=index*28+18,path=`M 46 ${height/2} C 100 ${height/2}, 90 ${y}, 137 ${y}`;
    const color=unavailable?'#545351':selected?(routing.phase==='COMPLETE'?'#72e2b2':routing.phase==='FALLBACK'?'#e0a348':'#55d9ff'):'#46525b';
    return <g key={candidate.modelId} opacity={unavailable?.4:1}>
     <path d={path} fill="none" stroke={color} strokeWidth={selected?1.5:.6}/>
     {selected&&live&&!reduced?<motion.path key={`${run.requestId}:${candidate.modelId}:${routing.phase}`} d={routing.phase==='COMPLETE'?`M 137 ${y} C 90 ${y}, 100 ${height/2}, 46 ${height/2}`:path} fill="none" stroke={color} strokeWidth="3" initial={{pathLength:0,opacity:1}} animate={{pathLength:1,opacity:0}} transition={{duration:.45}}/>:null}
     <circle cx="139" cy={y} r={selected?4:2} fill={color}/>
     <text x="150" y={y+3} fill={color} fontSize="8">{candidate.displayName.slice(0,20)}</text>
    </g>;
   })}
 </svg>;
}
