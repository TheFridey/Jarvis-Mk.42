'use client';
import type { InteractionState, JarvisOperatingPicture, PresentationState, WorkState } from '@jarvis/scene';
export function JarvisCore({ state, picture, activity }: { state: PresentationState; picture?:JarvisOperatingPicture; activity: string[] }) {const interaction:InteractionState=picture?.interactionState??'DORMANT';const work:WorkState=picture?.workState??'IDLE';const label=work==='IDLE'?interaction:work;return <div className={`core-wrap core-${state.toLowerCase()}`} role="status" aria-live="polite" aria-label={`JARVIS — ${label}`}>
  <div className="core-readout"><small>{label}</small><strong>JARVIS <em>42</em></strong><div><span>{picture?.systemMode??'UNAVAILABLE'}</span>{activity.slice(0, 2).map((item) => <span key={item}>{item}</span>)}</div></div>
 </div>; }
