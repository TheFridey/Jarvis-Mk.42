import type { PrivacyClass } from './event.ts';

export type VisionGesture = 'point' | 'pinch' | 'pinch-hold' | 'open-palm' | 'swipe-left' | 'swipe-right' | 'none';
export interface VisionAirTouchFrame { phase: 'hover' | 'pinch-start' | 'pinch-move' | 'pinch-end' | 'swipe' | 'open-palm' | 'lost'; monitorId: string; point?: { x: number; y: number }; direction?: 'left' | 'right' | 'up' | 'down'; confidence: number; observedAt: string; sequence?: number; latencyMs?: number }

export interface VisionDiagnostics {
  status: 'starting' | 'ready' | 'degraded' | 'offline';
  cameraId?: string;
  cameraLabel?: string;
  fps: number;
  inferenceLatencyMs: number;
  airTouchLatencyMs: number;
  confidence: number;
  currentTarget?: string;
  droppedFrames: number;
  calibrationQuality: number;
  model: string;
  updatedAt: string;
}

export interface ScreenContext {
  source?:'windows'|'browser';
  coordinateSpace?:'physical-pixels'|'css-pixels';
  monitors: Array<{ id: string; label: string; x: number; y: number; width: number; height: number; scaleFactor: number; primary: boolean }>;
  activeMonitorId?: string;
  activeWindow?: { title: string; application: string;processId?:number;windowId?:string;executable?:string;bounds?:{x:number;y:number;width:number;height:number} };
  scene?:{focusedId?:string;selectedIds:string[];observedAt:string};
  workspace?:{rootPath:string;repositoryRoot?:string;source:'explicit-process-binding';processId:number};
  cursor?: { x: number; y: number };
  selection?: { monitorId: string; x: number; y: number; width: number; height: number };
  observedAt: string;
}

export type VisionSignal =
  | { type: 'air-touch'; frame: VisionAirTouchFrame; gesture: VisionGesture; handedness?: 'left' | 'right'; diagnostics: VisionDiagnostics }
  | { type: 'presence'; state: 'present' | 'absent' | 'near'; confidence: number; observedAt: string }
  | { type: 'screen-context'; context: ScreenContext }
  | { type: 'camera.lost' | 'camera.restored'; cameraId?: string; observedAt: string }
  | { type: 'diagnostics'; diagnostics: VisionDiagnostics };

export interface VisionEventCommand { commandId: string; nodeId: string; principalId: string; signal: VisionSignal }
export interface VisionEventResponse { accepted: true; observedAt: string }

export interface SelectedFrameRequest {
  requestId: string;
  principalId: string;
  source: 'camera' | 'screen';
  region: { x: number; y: number; width: number; height: number };
  privacyClass: PrivacyClass;
  imageRef: string;
  purpose: string;
}

export interface SelectedFrameDecision { allowed: boolean; reason: string; requiresApproval: boolean }
