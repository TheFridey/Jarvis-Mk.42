import{describe,expect,it,vi}from'vitest';import{JarvisSoundEngine}from'./sound-engine.ts';
describe('JARVIS sound engine',()=>{it('does nothing while optional sound is disabled',async()=>{const context=vi.fn();vi.stubGlobal('AudioContext',context);await new JarvisSoundEngine().play('wake',false);expect(context).not.toHaveBeenCalled();vi.unstubAllGlobals()})});
