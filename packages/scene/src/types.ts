import type { MonitorSurface, Point2, Size2, SpatialInput, SpatialReference } from '@jarvis/spatial';
export type SceneObjectKind = 'jarvis-core' | 'objective' | 'infrastructure' | 'research' | 'revenue' | 'alert' | 'browser' | 'communications' | 'today' | 'artifact' | 'diagnostics';
export type PresentationState = 'DORMANT' | 'LISTENING' | 'THINKING' | 'WORKING' | 'ALERT' | 'GUARDIAN' | 'DEGRADED';
export interface SceneObject { id: string; kind: SceneObjectKind; title: string; semanticRole: string; monitorId: string; position: Point2; size: Size2; zIndex: number; state: 'expanded' | 'collapsed' | 'focused'; pinned: boolean; dismissible: boolean; groupId?: string; resourceRefs: string[]; updatedAt: string; staleAfter?: string; data: Record<string, unknown>; }
export interface SemanticScene { id: string; principalId: string; version: number; asOfEventPosition?: string; presentation: PresentationState; monitors: MonitorSurface[]; objects: SceneObject[]; selectedProjectId?: string; updatedAt: string; }
export type SceneIntent =
  | { type: 'focus' | 'dismiss' | 'expand' | 'collapse' | 'pin'; targetId: string; input: SpatialInput }
  | { type: 'move'; targetId: string; monitorId: string; position: Point2; input: SpatialInput }
  | { type: 'resize'; targetId: string; size: Size2; input: SpatialInput }
  | { type: 'group'; targetIds: string[]; groupId: string; input: SpatialInput }
  | { type: 'restore'; snapshot: SceneSnapshot; availableResourceRefs: string[]; monitors: MonitorSurface[]; input: SpatialInput };
export interface SceneSnapshot { id: string; name: string; sceneVersion: number; objects: SceneObject[]; selectedProjectId?: string; savedAt: string; }
export interface ReferenceContext { utterance: string; focusedId?: string; selectedIds: string[]; hoveredId?: string; recentIds: string[]; pointing?: SpatialReference; now: string; }
export interface ResolvedReference { objectIds: string[]; confidence: number; reason: string; requiresClarification: boolean; }
export interface AirTouchFrame { phase: 'hover' | 'pinch-start' | 'pinch-move' | 'pinch-end' | 'swipe' | 'open-palm' | 'lost'; monitorId: string; point?: Point2; direction?: 'left' | 'right' | 'up' | 'down'; confidence: number; observedAt: string; }
export interface MagneticTarget { objectId: string; centre: Point2; radius: number; zIndex: number; }
