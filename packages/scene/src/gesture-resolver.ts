import type { AirTouchFrame, MagneticTarget } from './types.ts';
export interface GestureResolution { targetId?: string; acquired: boolean; tracking: 'ready' | 'active' | 'lost'; action?: 'focus' | 'move' | 'dismiss' | 'collapse'; point?: { x: number; y: number }; }
export function resolveAirTouch(frame: AirTouchFrame, targets: MagneticTarget[]): GestureResolution {
  if (frame.phase === 'lost' || !Number.isFinite(frame.confidence)||frame.confidence < .55||frame.confidence>1) return { acquired: false, tracking: 'lost' };
  const hit = frame.point ? [...targets].filter((target) => (!target.monitorId||target.monitorId===frame.monitorId)&&Math.hypot(target.centre.x - frame.point!.x, target.centre.y - frame.point!.y) <= target.radius).sort((a, b) => b.zIndex - a.zIndex)[0] : undefined;
  if (!hit) return { acquired: false, tracking: frame.phase.startsWith('pinch') ? 'active' : 'ready', point: frame.point };
  const action = frame.phase === 'open-palm' ? 'dismiss' : frame.phase === 'swipe' ? 'collapse' : frame.phase === 'pinch-move' ? 'move' : frame.phase === 'pinch-start' ? 'focus' : undefined;
  return { targetId: hit.objectId, acquired: true, tracking: frame.phase.startsWith('pinch') ? 'active' : 'ready', action, point: frame.point };
}
