/// <reference lib="dom" />
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandTracker, TrackingResult } from './ports.ts';
export class MediaPipeHandTracker implements HandTracker {
 private constructor(private readonly landmarker:HandLandmarker){}
 static async create(modelAssetPath:string){const wasm=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm');const landmarker=await HandLandmarker.createFromOptions(wasm,{baseOptions:{modelAssetPath,delegate:'GPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.55,minTrackingConfidence:.55,minHandPresenceConfidence:.55});return new MediaPipeHandTracker(landmarker)}
 async track(source:ImageBitmapSource,timestampMs:number):Promise<TrackingResult>{const start=performance.now();const result=this.landmarker.detectForVideo(source as HTMLVideoElement,timestampMs);return{hands:result.landmarks.map((landmarks,index)=>({landmarks,handedness:result.handedness[index]?.[0]?.categoryName.toLowerCase()==='left'?'left':'right',confidence:result.handedness[index]?.[0]?.score??0})),personPresent:result.landmarks.length>0,inferenceLatencyMs:performance.now()-start,capturedAt:new Date().toISOString()}}
 close(){this.landmarker.close()}
}
