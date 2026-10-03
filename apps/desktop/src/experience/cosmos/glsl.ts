/** Shared GLSL. Cheap value noise for integrated GPUs; no derivatives or textures. */
export const NOISE = /* glsl */ `
float hash13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float vnoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p,int octaves){float v=0.,a=.5;for(int i=0;i<6;i++){if(i>=octaves)break;v+=a*vnoise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return v;}
`;

/** Quadratic Bézier ribbon evaluated on the GPU: the geometry is shared, endpoints are uniforms. */
export const RIBBON_VERTEX = /* glsl */ `
attribute float aT; attribute float aSide;
uniform vec3 uP0; uniform vec3 uP1; uniform vec3 uP2; uniform float uWidth;
varying float vT; varying float vSide;
void main(){
  vec3 a=mix(uP0,uP1,aT), b=mix(uP1,uP2,aT), p=mix(a,b,aT);
  vec3 d=b-a; float len=max(length(d),1e-5); d/=len;
  p+=vec3(-d.y,d.x,0.)*aSide*uWidth*.5;
  vT=aT; vSide=aSide;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;

export const RIBBON_FRAGMENT = /* glsl */ `
uniform vec3 uColour; uniform vec3 uPulseColour;
uniform float uAlpha; uniform float uDraw; uniform float uPulse; uniform float uPhase; uniform float uPulseCount;
uniform float uBroken; uniform float uDash; uniform float uHold; uniform float uFlicker; uniform float uTime;
varying float vT; varying float vSide;
void main(){
  if(vT>uDraw||uAlpha<.002) discard;
  float edge=pow(clamp(1.-abs(vSide),0.,1.),1.6);
  float a=uAlpha*edge*smoothstep(0.,.06,vT);
  a*=mix(1.,step(.45,fract(vT*46.)),uDash);
  a*=mix(1.,step(.22,abs(fract(vT*5.+.5)-.5))*.55,uBroken);
  a*=1.-uFlicker*.5*(.5+.5*sin(uTime*23.+vT*40.));
  float ph=fract(vT*uPulseCount-uPhase);
  float pulse=smoothstep(0.,.05,ph)*smoothstep(.16,.05,ph)*uPulse;
  float tip=smoothstep(uDraw-.05,uDraw,vT)*step(uDraw,.995)*.8;
  float hold=smoothstep(uDraw-.25,uDraw,vT)*uHold;
  vec3 col=mix(uColour,uPulseColour,clamp(pulse,0.,1.));
  gl_FragColor=vec4(col,(a+(pulse+tip+hold)*edge*uAlpha*1.4));
}`;

/** Camera-facing soft disc used for halos, node glows and energy cores. */
export const DISC_VERTEX = /* glsl */ `
varying vec2 vUv;
void main(){vUv=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

export const DISC_FRAGMENT = /* glsl */ `
uniform vec3 uColour; uniform float uAlpha; uniform float uCore; uniform float uFalloff;
varying vec2 vUv;
void main(){
  float r=length(vUv); if(r>1.) discard;
  float glow=pow(max(1.-r,0.),uFalloff);
  float core=smoothstep(uCore,0.,r)*step(.0001,uCore);
  gl_FragColor=vec4(uColour*(1.+core*1.5),(glow+core)*uAlpha);
}`;

/**
 * Flat ring with angular structure: ticks, travelling packets, a highlight lobe
 * at uLobe, partial arcs (uArc) and gaps. One shader for every technical ring.
 */
export const RING_VERTEX = /* glsl */ `
varying vec2 vPos; uniform float uWave; uniform float uWaveAmp; uniform float uTime;
void main(){
  vec3 p=position; float ang=atan(p.y,p.x); float r=length(p.xy);
  float w=(sin(ang*12.+uTime*4.)*.6+sin(ang*7.-uTime*2.7)*.4)*uWaveAmp*uWave;
  p.xy*= (r+w)/max(r,1e-5);
  vPos=position.xy;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;

export const RING_FRAGMENT = /* glsl */ `
#define TAU 6.28318530718
uniform vec3 uColour; uniform vec3 uAccent; uniform float uAlpha; uniform float uTicks; uniform float uTickAlpha;
uniform float uPackets; uniform float uPhase; uniform float uLobe; uniform float uLobeAlpha; uniform float uLobeWidth;
uniform float uArc; uniform float uArcStart; uniform float uGap; uniform float uInner; uniform float uOuter;
varying vec2 vPos;
void main(){
  float r=length(vPos); float band=(r-uInner)/max(uOuter-uInner,1e-5);
  float edge=1.-abs(band*2.-1.); edge=smoothstep(0.,.6,edge);
  float ang=atan(vPos.y,vPos.x); float u=fract(ang/TAU+1.);
  float arcU=fract(u-uArcStart+1.); if(arcU>uArc) discard;
  float a=uAlpha*edge; float vis=smoothstep(0.,.03,uAlpha);
  float tick=step(.86,fract(u*uTicks))*uTickAlpha*vis; a+=tick*edge;
  float pk=fract(u*max(uPackets,1.)-uPhase); float packet=smoothstep(.0,.03,pk)*smoothstep(.09,.03,pk)*step(.5,uPackets);
  a+=packet*edge*.9*vis;
  float chord=2.-2.*cos(ang-uLobe);
  float lobe=exp(-chord/max(uLobeWidth*uLobeWidth,1e-4))*uLobeAlpha; a+=lobe*edge;
  a*=1.-uGap*step(.5,fract(u*3.+.1))*.85;
  vec3 col=mix(uColour,uAccent,clamp(lobe+packet*.6,0.,1.));
  gl_FragColor=vec4(col,a);
}`;
