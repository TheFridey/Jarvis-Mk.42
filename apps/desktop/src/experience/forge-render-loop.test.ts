import { expect, it, vi } from 'vitest';
import { ForgeRenderLoop, type FrameHost } from './forge-render-loop.ts';

it('cancels its animation resource and stops rendering on cleanup',()=>{let callback:FrameRequestCallback=()=>undefined;let id=0;const cancel=vi.fn();const frame=vi.fn();const host:FrameHost={request(next){callback=next;return++id},cancel,now:()=>0};const loop=new ForgeRenderLoop(host,frame,60);loop.start();callback(20);expect(frame).toHaveBeenCalledOnce();loop.stop();expect(cancel).toHaveBeenCalledWith(2)});
