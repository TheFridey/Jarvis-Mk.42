import { describe, expect, it } from 'vitest';
import { supportsWebGL } from './webgl-support.ts';

describe('WebGL fallback detection',()=>{it('uses WebGL2 or WebGL and otherwise fails closed',()=>{expect(supportsWebGL(()=>({getContext:name=>name==='webgl2'?{}:null}))).toBe(true);expect(supportsWebGL(()=>({getContext:()=>null}))).toBe(false);expect(supportsWebGL(()=>{throw new Error('canvas unavailable')})).toBe(false)})});
