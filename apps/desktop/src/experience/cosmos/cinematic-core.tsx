'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, ShaderMaterial } from 'three';
import { modelTint } from '../cinematic-palette.ts';
const random = (seed: number, index: number) => { let h = Math.imul(index ^ seed, 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
import { useCosmosClock } from './runtime.tsx';

const vertex = /* glsl */ `
attribute float aSeed;
uniform float uTime, uPixel, uEnergy, uAudio, uGalaxy;
varying float vLight, vSeed;
void main(){
  vec3 p=position; float s=aSeed;
  if(uGalaxy<.5){
    float wave=sin(p.y*12.+uTime*.65+s*3.)*cos(p.x*9.-uTime*.35);
    p*=1.+wave*(.022+uEnergy*.035)+uAudio*.055;
    float a=uTime*.045; p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz;
    vLight=.3+.7*pow(.5+.5*sin(s*130.+uTime*.8),3.);
  }else{
    float a=uTime*.012*(1.2-length(p)*.15);p.xy=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xy;
    vLight=.35+.65*pow(.5+.5*sin(s*87.+uTime*.3),5.);
  }
  vec4 mv=modelViewMatrix*vec4(p,1.);
  gl_PointSize=clamp((.65+s*1.6)*uPixel*(9./max(.5,-mv.z)),.5,5.);
  vSeed=s; gl_Position=projectionMatrix*mv;
}`;
const fragment = /* glsl */ `
uniform vec3 uColour; uniform float uGalaxy;
varying float vLight,vSeed;
void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;
  float light=pow(1.-r,2.);vec3 c=mix(uColour,vec3(.95,.97,1.),pow(vSeed,8.)*.65);
  gl_FragColor=vec4(c*(1.+vLight*1.8),light*vLight*(uGalaxy>.5?.5:.85));
}`;

/** Uniform spherical sampling avoids latitude bands; all movement follows the shared motion clock. */
export function CinematicCore({position,scale,colour,energy,audio,count}:{position:[number,number];scale:number;colour:string;energy:number;audio:number;count:number}) {
  const clock=useCosmosClock(), dpr=useThree(state=>state.viewport.dpr);
  const root=useRef<Group>(null);
  const assets=useMemo(()=>{
    const make=(galaxy:boolean,n:number)=>{
      const geometry=new BufferGeometry(), positions=new Float32Array(n*3), seeds=new Float32Array(n);
      for(let i=0;i<n;i++){
        const a=random(galaxy?411:97,i*3),b=random(galaxy?419:101,i*3+1),c=random(galaxy?421:107,i*3+2);
        seeds[i]=c;
        if(galaxy){
          const radius=.95+Math.pow(a,.7)*2.5,angle=(i%3)*Math.PI*2/3+radius*1.6+(b-.5)*(.2+radius*.3);
          positions.set([Math.cos(angle)*radius,Math.sin(angle)*radius*.37,(c-.5)*.45-1.2],i*3);
        }else{
          const y=a*2-1,theta=b*Math.PI*2,r=Math.sqrt(1-y*y),radius=.81+Math.pow(c,5)*.13;
          positions.set([r*Math.cos(theta)*radius,y*radius,r*Math.sin(theta)*radius],i*3);
        }
      }
      geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setAttribute('aSeed',new BufferAttribute(seeds,1));
      const material=new ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,blending:AdditiveBlending,uniforms:{uTime:{value:0},uPixel:{value:1},uEnergy:{value:0},uAudio:{value:0},uGalaxy:{value:galaxy?1:0},uColour:{value:new Color(modelTint())}}});
      return {geometry,material};
    };
    return {sphere:make(false,count),galaxy:make(true,Math.floor(count*.5))};
  },[count]);
  const target=useMemo(()=>new Color(colour),[colour]);
  useEffect(()=>()=>{Object.values(assets).forEach(({geometry,material})=>{geometry.dispose();material.dispose();});},[assets]);
  useFrame(()=>{
    for(const {material} of Object.values(assets)){
      const u=material.uniforms;u.uTime!.value=clock.t;u.uPixel!.value=dpr;u.uEnergy!.value=energy;u.uAudio!.value=audio;
      (u.uColour!.value as Color).lerp(target,clock.snap?1:1-Math.exp(-clock.dt*2.4));
    }
    if(root.current)root.current.rotation.z=Math.sin(clock.t*.04)*.04;
  });
  return <group position={[position[0],position[1],0]} scale={scale} ref={root}>
    <points geometry={assets.galaxy.geometry} material={assets.galaxy.material} frustumCulled={false}/>
    <points geometry={assets.sphere.geometry} material={assets.sphere.material} frustumCulled={false}/>
  </group>;
}
