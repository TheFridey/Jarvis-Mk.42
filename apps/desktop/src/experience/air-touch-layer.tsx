'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { resolveAirTouch, type AirTouchFrame, type SceneIntent, type SceneObject } from '@jarvis/scene';
import type { SceneTransport } from './scene-client.ts';
declare global { interface WindowEventMap { 'jarvis:air-touch': CustomEvent<AirTouchFrame>; } }

export function AirTouchLayer({ objects, submit, transport }: { objects: SceneObject[]; submit: (intent: SceneIntent) => void; transport: SceneTransport }) {
  const [cursor, setCursor] = useState<{ x: number; y: number; state: string; acquired: boolean }>();
  const activeTarget = useRef<string | undefined>(undefined);
  const latest = useRef({ objects, submit });
  // Scene intents update the parent. Keep the stream subscribed across those
  // renders, while resolving each frame against the latest committed scene.
  useLayoutEffect(() => { latest.current = { objects, submit }; }, [objects, submit]);
  useEffect(() => {
    const handle = (frame: AirTouchFrame) => {
      const { objects, submit } = latest.current;
      const targets = objects.map((object) => ({ objectId: object.id,monitorId:object.monitorId, centre: { x: object.position.x + object.size.width / 2, y: object.position.y + object.size.height / 2 }, radius: Math.max(object.size.width, object.size.height) * .58, zIndex: object.zIndex }));
      const result = resolveAirTouch(frame, targets);
      if (frame.phase === 'lost' || frame.phase === 'pinch-end') activeTarget.current = undefined;
      if (frame.phase === 'pinch-start' && result.targetId) activeTarget.current = result.targetId;
      const next = result.point ? { ...result.point, state: result.tracking, acquired: result.acquired || Boolean(activeTarget.current) } : undefined;
      setCursor(previous => previous?.x === next?.x && previous?.y === next?.y && previous?.state === next?.state && previous?.acquired === next?.acquired ? previous : next);
      if(frame.phase==='pinch-move'&&activeTarget.current&&frame.point&&result.tracking!=='lost'){submit({type:'move',targetId:activeTarget.current,monitorId:frame.monitorId,position:frame.point,input:'air-touch'});return;}
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
  }, [transport]);
  return cursor ? <div className={`air-pointer ${cursor.state} ${cursor.acquired ? 'acquired' : ''}`} style={{ left:`${cursor.x/1920*100}%`,top:`${cursor.y/1080*100}%` }}><i /></div> : null;
}
