'use client';
import {useEffect,useState} from 'react';
import type {DesktopKernelSnapshot,SceneObject} from '@jarvis/scene';
export function ReferentFocus({focus,objects,developer}:{focus:DesktopKernelSnapshot['referentFocus'];objects:SceneObject[];developer:boolean}){
 const [visible,setVisible]=useState(false);
 useEffect(()=>{const remaining=focus?Date.parse(focus.expiresAt)-Date.now():0;setVisible(remaining>0);if(remaining<=0)return;const timer=setTimeout(()=>setVisible(false),remaining);return()=>clearTimeout(timer);},[focus]);
 if(!visible||!focus)return null;
 // Workstation pixel coordinates are not scene CSS coordinates. External targets
 // receive a short reference indicator, never an invented on-screen location.
 const object=objects.find(o=>o.id===focus.objectId);
 if(!object)return <div className="referent-indicator" role="status">SELECTED SCREEN REGION{developer&&` · ${Math.round(focus.confidence*100)}%`}</div>;
 return <div className="referent-bracket" aria-label="Resolved referent" style={{left:object.position.x,top:object.position.y,width:object.size.width,height:object.size.height}}>{developer&&<small>{Math.round(focus.confidence*100)}%</small>}</div>;
}
