import type { TrackedHand } from './ports.ts';
export type Primitive = 'point'|'pinch'|'pinch-hold'|'open-palm'|'swipe-left'|'swipe-right'|'none';
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
export class GestureClassifier {
 private pinching=false; private pinchSince=0; private history:Array<{x:number;t:number}>=[];private swipeAt=-Infinity;
 classify(hand:TrackedHand,now:number):Primitive {
  const p=hand.landmarks;if(p.length<21)return'none';const palm=distance(p[0]!,p[9]!)||.1;const pinch=distance(p[4]!,p[8]!)/palm;
  if(this.pinching){if(pinch>.48){this.pinching=false;this.pinchSince=0}else return now-this.pinchSince>450?'pinch-hold':'pinch'}
  else if(pinch<.32){this.pinching=true;this.pinchSince=now;return'pinch'}
  const extended=[8,12,16,20].map((tip)=>distance(p[tip]!,p[0]!)>distance(p[tip-2]!,p[0]!)*1.18);
  this.history.push({x:p[8]!.x,t:now});this.history=this.history.filter(v=>now-v.t<250);const dx=p[8]!.x-(this.history[0]?.x??p[8]!.x);
  if(Math.abs(dx)>.18&&now-this.swipeAt>700){this.history=[];this.swipeAt=now;return dx>0?'swipe-right':'swipe-left'}
  if(extended.every(Boolean))return'open-palm';if(extended[0]&&!extended.slice(1).some(Boolean))return'point';return'none';
 }
 reset(){this.pinching=false;this.pinchSince=0;this.history=[]}
}
