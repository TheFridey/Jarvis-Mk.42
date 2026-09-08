'use client';
import { useEffect, useRef, useState } from 'react';
import { resolveAirTouch, type AirTouchFrame, type SceneIntent, type SceneObject } from '@jarvis/scene';
import type { SceneTransport } from './scene-client.ts';
declare global { interface WindowEventMap { 'jarvis:air-touch': CustomEvent<AirTouchFrame>; } }

export function AirTouchLayer({ objects, submit, transport }: { objects: SceneObject[]; submit: (intent: SceneIntent) => void; transport: SceneTransport }) {
  const [cursor, setCursor] = useState<{ x: number; y: number; state: string; acquired: boolean }>();
  const activeTarget = useRef<string | undefined>(undefined);
  useEffect(() => {
    const handle = (frame: AirTouchFrame) => {
      const targets = objects.map((object) => ({ objectId: object.id, centre: { x: object.position.x + object.size.width / 2, y: object.position.y + object.size.height / 2 }, radius: Math.max(object.size.width, object.size.height) * .58, zIndex: object.zIndex }));
      const result = resolveAirTouch(frame, targets);
      if (result.point) setCursor({ ...result.point, state: result.tracking, acquired: result.acquired || Boolean(activeTarget.current) }); else setCursor(undefined);
      if (frame.phase === 'lost' || frame.phase === 'pinch-end') activeTarget.current = undefined;
      if (frame.phase === 'pinch-start' && result.targetId) activeTarget.current = result.targetId;
      const targetId = frame.phase === 'pinch-move' ? activeTarget.current : result.targetId;
      if (!targetId || !result.action) return;
      if (result.action === 'dismiss') submit({ type: 'dismiss', targetId, input: 'air-touch' });
      else if (result.action === 'collapse') submit({ type: 'collapse', targetId, input: 'air-touch' });
      else if (result.action === 'focus') submit({ type: 'focus', targetId, input: 'air-touch' });
      else if (result.point) submit({ type: 'move', targetId, monitorId: frame.monitorId, position: result.point, input: 'air-touch' });
    };
    const dom = (event: CustomEvent<AirTouchFrame>) => handle(event.detail);
    window.addEventListener('jarvis:air-touch', dom);
    const unsubscribe = transport.subscribeAirTouch(handle);
    return () => { window.removeEventListener('jarvis:air-touch', dom); unsubscribe(); };
  }, [objects, submit, transport]);
  return cursor ? <div className={`air-pointer ${cursor.state} ${cursor.acquired ? 'acquired' : ''}`} style={{ transform: `translate3d(${cursor.x}px,${cursor.y}px,0)` }}><i /></div> : null;
}
