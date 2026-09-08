/// <reference lib="dom" />
export interface Landmark { x: number; y: number; z?: number; visibility?: number }
export interface TrackedHand { landmarks: Landmark[]; handedness?: 'left' | 'right'; confidence: number }
export interface TrackingResult { hands: TrackedHand[]; inferenceLatencyMs: number; capturedAt: string }
export interface HandTracker { track(source: ImageBitmapSource, timestampMs: number): Promise<TrackingResult>; close(): void }
