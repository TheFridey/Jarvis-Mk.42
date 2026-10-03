/// <reference lib="dom" />
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandTracker, TrackingResult } from './ports.ts';
import {verifyVisionAssets} from './local-assets.ts';
export class MediaPipeHandTracker implements HandTracker {
 private constructor(private readonly landmarker:HandLandmarker){}
 static async create(){const assets=await verifyVisionAssets(),wasm=await FilesetResolver.forVisionTasks(assets.wasmRoot);const options={runningMode:'VIDEO' as const,numHands:1,minHandDetectionConfidence:.55,minTrackingConfidence:.55,minHandPresenceConfidence:.55};let landmarker:HandLandmarker;try{landmarker=await HandLandmarker.createFromOptions(wasm,{...options,baseOptions:{modelAssetPath:assets.modelPath,delegate:'GPU'}});}catch{landmarker=await HandLandmarker.createFromOptions(wasm,{...options,baseOptions:{modelAssetPath:assets.modelPath,delegate:'CPU'}});}return new MediaPipeHandTracker(landmarker);}
 async track(source:ImageBitmapSource,timestampMs:number):Promise<TrackingResult>{const start=performance.now();const result=this.landmarker.detectForVideo(source as HTMLVideoElement,timestampMs);return{hands:result.landmarks.map((landmarks,index)=>({landmarks,handedness:result.handedness[index]?.[0]?.categoryName.toLowerCase()==='left'?'left':'right',confidence:result.handedness[index]?.[0]?.score??0})),inferenceLatencyMs:performance.now()-start,capturedAt:new Date().toISOString()}}
 close(){this.landmarker.close()}
}
