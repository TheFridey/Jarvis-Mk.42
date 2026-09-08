import type { VisionDiagnostics, VisionEventCommand, VisionGesture } from '@jarvis/contracts';
import { PointSmoother, calibratePoint, type CalibrationTransform } from '@jarvis/spatial';
import { GestureClassifier, type Primitive } from './gesture-classifier.ts';
import type { TrackingResult } from './ports.ts';

export class VisionPipeline {
 private readonly classifier=new GestureClassifier();private readonly smoother=new PointSmoother(.3,4);private sequence=0;private prior:Primitive='none';private lastSeen=0;private frames=0;private started=performance.now();private dropped=0;
 constructor(private readonly config:{nodeId:string;principalId:string;cameraId:string;model:string;calibration:CalibrationTransform;now?:()=>number}){}
 process(result:TrackingResult):VisionEventCommand[]{const now=this.config.now?.()??performance.now(),commands:VisionEventCommand[]=[];this.frames++;const hand=result.hands[0];if(!hand){if(this.frames>1&&now-this.lastSeen>180){this.classifier.reset();this.smoother.reset();this.lastSeen=0;commands.push(this.command({type:'air-touch',gesture:'none',frame:{phase:'lost',monitorId:this.config.calibration.monitorId,confidence:0,observedAt:result.capturedAt,sequence:++this.sequence},diagnostics:this.diagnostics(result,0)}))}return commands}
  this.lastSeen=now;const primitive=this.classifier.classify(hand,now);const calibrated=calibratePoint({x:hand.landmarks[8]!.x,y:hand.landmarks[8]!.y},this.config.calibration);const point=this.smoother.update(calibrated.point);const confidence=Math.min(hand.confidence,calibrated.confidence);let phase:'hover'|'pinch-start'|'pinch-move'|'pinch-end'|'swipe'|'open-palm'='hover';let direction:'left'|'right'|undefined;
  if(primitive==='pinch')phase=this.prior==='pinch'||this.prior==='pinch-hold'?'pinch-move':'pinch-start';else if(primitive==='pinch-hold')phase='pinch-move';else if(this.prior==='pinch'||this.prior==='pinch-hold')phase='pinch-end';else if(primitive==='open-palm')phase='open-palm';else if(primitive.startsWith('swipe')){phase='swipe';direction=primitive.endsWith('left')?'left':'right'}this.prior=primitive;
  commands.push(this.command({type:'air-touch',gesture:primitive as VisionGesture,handedness:hand.handedness,frame:{phase,monitorId:calibrated.monitorId,point,...(direction?{direction}:{}),confidence,observedAt:result.capturedAt,sequence:++this.sequence,latencyMs:result.inferenceLatencyMs},diagnostics:this.diagnostics(result,confidence)}));return commands}
 cameraLost(at:string){this.lastSeen=0;this.smoother.reset();this.classifier.reset();return this.command({type:'camera.lost',cameraId:this.config.cameraId,observedAt:at})}
 addDroppedFrame(){this.dropped++}
 private diagnostics(r:TrackingResult,confidence:number):VisionDiagnostics{return{status:'ready',cameraId:this.config.cameraId,fps:this.frames/Math.max(1,(performance.now()-this.started)/1000),inferenceLatencyMs:r.inferenceLatencyMs,airTouchLatencyMs:r.inferenceLatencyMs,confidence,droppedFrames:this.dropped,calibrationQuality:this.config.calibration.quality,model:this.config.model,updatedAt:r.capturedAt}}
 private command(signal:VisionEventCommand['signal']):VisionEventCommand{return{commandId:crypto.randomUUID(),nodeId:this.config.nodeId,principalId:this.config.principalId,signal}}
}
