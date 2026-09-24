// Real-time 3D PS5 controller scene (ported from the design's slip-scene.js).
// createSlipScene(container, { modelUrl, getScroll, getAnchor, onProgress, onReady, onPlanet, opts })
//   → { replay, fly, pulse, set, destroy }
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eOut = x => 1 - Math.pow(1 - x, 3);
const eIn = x => x * x;
const eInOut = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const eBack = x => { const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const lerp = THREE.MathUtils.lerp;
const YAW = -1.25;

function buildHand(mat) {
  const hand = new THREE.Group();
  const add = (geo, pos, parent = hand) => { const m = new THREE.Mesh(geo, mat); m.position.copy(pos); parent.add(m); return m; };
  const palm = add(new THREE.SphereGeometry(1, 40, 28), new THREE.Vector3(0, -0.22, -0.05)); palm.scale.set(0.8, 0.27, 0.92);
  const heel = add(new THREE.SphereGeometry(1, 32, 24), new THREE.Vector3(0, -0.3, 0.55)); heel.scale.set(0.66, 0.3, 0.5);
  const fingers = [[-0.52, 0.78, 0.13], [-0.18, 0.96, 0.145], [0.17, 1, 0.145], [0.5, 0.88, 0.138]];
  const segL = [0.5, 0.33, 0.26], segR = [1, 0.9, 0.8];
  const joints = [];
  fingers.forEach(([x, len, r], fi) => {
    let parent = new THREE.Group(); parent.position.set(x, -0.14, -0.82); parent.rotation.y = x * -0.12; parent.rotation.x = 0.12; hand.add(parent);
    const fj = [parent]; joints.push(fj);
    add(new THREE.SphereGeometry(r * 1.05, 20, 14), new THREE.Vector3(), parent);
    segL.forEach((l, i) => {
      const L = l * len, R = r * segR[i];
      const c = new THREE.Mesh(new THREE.CapsuleGeometry(R, L, 8, 20), mat); c.rotation.x = -Math.PI / 2; c.position.z = -L / 2; parent.add(c);
      const j = new THREE.Group(); j.position.z = -L; j.rotation.x = 0.22 + fi * 0.02; parent.add(j); parent = j; fj.push(j);
    });
  });
  let t = new THREE.Group(); t.position.set(0.72, -0.2, 0.25); t.rotation.set(0.25, -1.0, 0.15); hand.add(t);
  const thumb = [t];
  [[0.5, 0.17], [0.36, 0.15], [0.28, 0.135]].forEach(([L, R]) => {
    const c = new THREE.Mesh(new THREE.CapsuleGeometry(R, L, 8, 20), mat); c.rotation.x = -Math.PI / 2; c.position.z = -L / 2; t.add(c);
    const j = new THREE.Group(); j.position.z = -L; j.rotation.set(0.2, -0.15, 0); t.add(j); t = j; thumb.push(j);
  });
  const dir = new THREE.Vector3(0, -0.62, 1).normalize();
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.66, 6, 40, 1, true), mat);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
  arm.position.set(0, -0.32, 0.8).addScaledVector(dir, 3); hand.add(arm);
  const wrist = add(new THREE.SphereGeometry(1, 32, 24), new THREE.Vector3(0, -0.34, 0.85)); wrist.scale.set(0.56, 0.4, 0.5);
  const socket = new THREE.Object3D(); hand.add(socket);
  return { hand, socket, joints, thumb };
}

export function createSlipScene(container, { modelUrl, getScroll, getAnchor, onProgress, onReady, onPlanet, opts = {} }) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let o = { glow: 1, flip: false, turn: false, speed: 1, ...opts };

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  const isPhone = Math.min(innerWidth, innerHeight) < 600;
  renderer.setPixelRatio(Math.min(devicePixelRatio, isPhone ? 1.5 : 2));
  renderer.setClearColor(0x04060b, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environmentIntensity = 0.35;
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  camera.position.set(0, 4.2, 12);

  const key = new THREE.DirectionalLight(0xfff4ea, 1.4); key.position.set(3, 7, 6); scene.add(key);
  const rimC = new THREE.DirectionalLight(0x00e5ff, 4); rimC.position.set(-6, 3, -5); scene.add(rimC);
  const rimO = new THREE.PointLight(0xff6b1a, 18, 16, 1.5); rimO.position.set(5, -2, 3); scene.add(rimO);
  const fill = new THREE.HemisphereLight(0x8fb8ff, 0x100806, 0.5); scene.add(fill);

  const rig = new THREE.Group(); rig.rotation.x = 0.45; scene.add(rig);

  const skin = new THREE.MeshPhysicalMaterial({ color: 0xb57a58, roughness: 0.62, metalness: 0, sheen: 1, sheenColor: new THREE.Color(0xff8a70), sheenRoughness: 0.45, clearcoat: 0.08 });
  const { hand, socket, joints, thumb } = buildHand(skin); rig.add(hand);
  const ghost = buildHand(skin); ghost.hand.visible = false; rig.add(ghost.hand);

  const pad = new THREE.Group(); rig.add(pad);
  const orient = new THREE.Group(); pad.add(orient);
  let halfT = 0.3, halfD = 1, halfX = 1.6, model = null;

  // space: nebula dome
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGlow: { value: 1 } }, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform float uGlow; varying vec3 vD;
      float h(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
      float n(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float a=0.5, r=0.0; for(int i=0;i<5;i++){ r+=a*n(p); p*=2.03; a*=0.5; } return r; }
      void main(){ vec3 d=normalize(vD); float t=uTime*0.01;
        float a=fbm(d*2.2+vec3(t,0.0,-t)); float b=fbm(d*3.5-vec3(0.0,t,0.0)+a);
        vec3 col=vec3(0.012,0.016,0.035);
        col+=vec3(0.24,0.12,0.55)*pow(smoothstep(0.45,0.95,b),2.0)*0.55;
        col+=vec3(0.0,0.45,0.6)*pow(smoothstep(0.5,1.0,a*b*1.6),2.0)*0.5;
        col+=vec3(0.9,0.35,0.1)*pow(smoothstep(0.62,1.0,b),3.0)*0.18;
        gl_FragColor=vec4(col*(0.6+0.4*uGlow),1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(90, 48, 32), skyMat));

  // stars (3 parallax layers, twinkle)
  const starLayers = [];
  const starMatFor = size => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSize: { value: size }, uWarp: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float aSeed; attribute vec3 aCol; uniform float uTime; uniform float uSize; uniform float uWarp; uniform float uPx; varying vec3 vC; varying float vA;
      void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;
        float tw=0.55+0.45*sin(uTime*(1.0+aSeed*3.0)+aSeed*40.0);
        vA=tw; vC=aCol; gl_PointSize=uSize*uPx*(0.6+aSeed)*(1.0+uWarp*2.0)*(60.0/-mv.z); }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p); float core=smoothstep(0.5,0.0,d); float spike=max(0.0,1.0-abs(p.x)*18.0)*max(0.0,1.0-abs(p.y)*2.2)+max(0.0,1.0-abs(p.y)*18.0)*max(0.0,1.0-abs(p.x)*2.2);
        float a=(pow(core,3.0)+spike*0.35)*vA; if(a<0.01) discard; gl_FragColor=vec4(vC*a*1.6,a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const starPal = [0xffffff, 0xcfe8ff, 0x9fdcff, 0xffe2c4, 0x00e5ff, 0xb9a6ff].map(c => new THREE.Color(c));
  (isPhone ? [[1100, 60, 1.6, 0.02], [450, 38, 2.1, 0.05], [160, 22, 2.8, 0.12]] : [[2200, 60, 1.5, 0.02], [900, 38, 2.0, 0.05], [320, 22, 2.8, 0.12]]).forEach(([n, R0, size, par]) => {
    const pos = new Float32Array(n * 3), seed = new Float32Array(n), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * 6.283, r = R0 * (0.7 + Math.random() * 0.3), q = Math.sqrt(1 - u * u);
      pos.set([Math.cos(th) * q * r, u * r * 0.7, Math.sin(th) * q * r - (R0 * 0.25)], i * 3); seed[i] = Math.random();
      const c = starPal[Math.random() < 0.7 ? (Math.random() * 2) | 0 : (Math.random() * starPal.length) | 0]; col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, starMatFor(size)); pts.userData.par = par; scene.add(pts); starLayers.push(pts);
  });

  // shooting stars
  const shooters = [];
  const shootMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0xbfefff).multiplyScalar(2.5), transparent: true, opacity: 0, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
  const spawnShooter = (from) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, shootMat.clone()); scene.add(l);
    const p = from || new THREE.Vector3((Math.random() - 0.2) * 30, 8 + Math.random() * 8, -20 - Math.random() * 10);
    shooters.push({ l, p: p.clone(), v: new THREE.Vector3(-14 - Math.random() * 10, -6 - Math.random() * 5, 0), t: 0 });
  };

  // planets
  const planetMat = (c1, c2, c3, bands, seedN) => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHover: { value: 0 }, uLight: { value: new THREE.Vector3(0.6, 0.5, 0.6).normalize() }, c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) }, c3: { value: new THREE.Color(c3) } },
    vertexShader: 'varying vec3 vN; varying vec3 vP; varying vec3 vV; void main(){ vN=normalize(normalMatrix*normal); vP=position; vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
    fragmentShader: `uniform float uTime; uniform float uHover; uniform vec3 uLight; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; varying vec3 vN; varying vec3 vP; varying vec3 vV;
      float h(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
      float n(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){ vec3 p=normalize(vP)*${seedN.toFixed(1)};
        float q=n(p*2.0)+0.5*n(p*4.0);
        float b=${bands ? 'sin(normalize(vP).y*18.0+q*2.5)*0.5+0.5' : 'smoothstep(0.55,0.9,q)'};
        vec3 base=mix(c1,c2,b); base=mix(base,c3,smoothstep(0.75,1.2,q)*0.6);
        float dif=max(0.0,dot(vN,uLight))*0.9+0.08;
        float rim=pow(1.0-max(0.0,dot(vN,vV)),3.0);
        vec3 col=base*dif + c3*rim*(0.9+uHover*2.5) + vec3(0.0,0.9,1.0)*rim*uHover*1.5;
        gl_FragColor=vec4(col,1.0); }`,
  });
  const planets = [];
  const addPlanet = (name, r, pos, mat, ring) => {
    const g = new THREE.Group(); g.position.copy(pos); scene.add(g);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), mat); g.add(m); m.userData.planet = g;
    if (ring) {
      const rg = new THREE.RingGeometry(r * 1.4, r * 2.2, 96);
      const rm = new THREE.ShaderMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, uniforms: { uHover: { value: 0 } },
        vertexShader: 'varying vec2 vU; void main(){ vU=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `uniform float uHover; varying vec2 vU; void main(){ float d=length(vU)/${r.toFixed(2)}; float b=0.5+0.5*sin(d*40.0); float a=smoothstep(1.4,1.55,d)*smoothstep(2.2,2.0,d)*(0.35+0.4*b); gl_FragColor=vec4(mix(vec3(0.95,0.75,0.55),vec3(0.0,0.9,1.0),uHover)*a,a); }` });
      const rmsh = new THREE.Mesh(rg, rm); rmsh.rotation.x = -1.2; rmsh.rotation.y = 0.3; g.add(rmsh); g.userData.ringMat = rm;
    }
    g.userData = { ...g.userData, name, mat, mesh: m, home: pos.clone(), spin: 0.1 + Math.random() * 0.15, hover: 0, kick: 0, phase: Math.random() * 6.28, r };
    planets.push(g); return g;
  };
  addPlanet('KEPLER-9 // GAS GIANT', 1.5, new THREE.Vector3(1.6, 1.6, -16), planetMat(0x3a2a7a, 0xff8a4a, 0xffc79a, true, 3.0), true);
  addPlanet('NEREID // ICE MOON', 0.55, new THREE.Vector3(8.2, 2.0, -8), planetMat(0x0b3a5a, 0x7fe6ff, 0xd8fbff, false, 5.0));
  addPlanet('VULCAN-X // LAVA WORLD', 0.8, new THREE.Vector3(-8.6, -7.6, -10), planetMat(0x1a0604, 0xff5a1a, 0xffb347, false, 4.0));
  addPlanet('ORBITAL-7 // STATION ROCK', 0.35, new THREE.Vector3(-1.2, -5.6, -6), planetMat(0x2a2f3a, 0x8a94a8, 0xcfe0ff, false, 7.0));
  const planetMeshes = planets.map(p => p.userData.mesh);

  // catch ring
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x00e5ff).multiplyScalar(3), transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 96), ringMat); ring.rotation.x = Math.PI / 2; rig.add(ring);
  // post
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c=texture2D(tDiffuse,vUv); if(c.r!=c.r||c.g!=c.g||c.b!=c.b) c=vec4(0.0,0.0,0.0,1.0); gl_FragColor=clamp(c,0.0,30.0); }',
  }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.4, 1.4);
  composer.addPass(bloom); composer.addPass(new OutputPass());

  let W = 1, H = 1, mobile = false;
  const resize = () => {
    W = container.clientWidth || 1; H = container.clientHeight || 1; mobile = W < 760;
    renderer.setSize(W, H, false); composer.setSize(W, H); bloom.resolution.set(isPhone ? W / 2 : W, isPhone ? H / 2 : H);
    camera.aspect = W / H; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // load model
  const applyOrient = () => {
    if (!model) return;
    if (model.parent) model.parent.remove(model);
    orient.rotation.set(0, 0, 0); orient.position.set(0, 0, 0); model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.scale.setScalar(1);
    model.updateMatrixWorld(true);
    let b = new THREE.Box3().setFromObject(model), s = b.getSize(new THREE.Vector3());
    const ax = ['x', 'y', 'z'].sort((a, c) => s[a] - s[c]);
    if (ax[0] === 'z') model.rotation.x = -Math.PI / 2;
    else if (ax[0] === 'x') model.rotation.z = Math.PI / 2;
    model.updateMatrixWorld(true);
    b = new THREE.Box3().setFromObject(model); s = b.getSize(new THREE.Vector3());
    if (s.z > s.x) { model.rotation.y += Math.PI / 2; model.updateMatrixWorld(true); b = new THREE.Box3().setFromObject(model); s = b.getSize(new THREE.Vector3()); }
    const k = 3.2 / s.x; model.scale.setScalar(k);
    model.updateMatrixWorld(true);
    b = new THREE.Box3().setFromObject(model);
    const c = b.getCenter(new THREE.Vector3()); model.position.sub(c);
    halfT = (b.max.y - b.min.y) / 2; halfD = (b.max.z - b.min.z) / 2; halfX = (b.max.x - b.min.x) / 2;
    orient.add(model);
    orient.rotation.x = o.flip ? Math.PI : 0;
    orient.rotation.y = o.turn ? 0 : Math.PI;
    orient.scale.set(o.mirror === false ? 1 : -1, 1, 1);
  };
  // The shipped model is meshopt-compressed (12 MB → ~2 MB); plain .glb files load too.
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(modelUrl, g => {
    model = g.scene;
    model.traverse(m => { if (m.isMesh && m.material) { m.material.envMapIntensity = 0.45; } });
    applyOrient();
    t = 0; loaded = true; onReady && onReady();
  }, e => { if (e.total) onProgress && onProgress(e.loaded / e.total); }, err => { console.error(err); onReady && onReady(err); });

  // interaction
  const ray = new THREE.Raycaster(); let hoverPlanet = null, scrollV = 0, lastS = 0;
  const mouse = new THREE.Vector2(); let pointerIn = false, dragging = false, lastX = 0, spin = 0, spinV = 0;
  const el = renderer.domElement;
  const onMove = e => {
    const r = el.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); pointerIn = true;
    if (dragging) { spinV = (e.clientX - lastX) * 0.01; spin += spinV; lastX = e.clientX; }
  };
  const onDown = e => {
    if (hoverPlanet) { const u = hoverPlanet.userData; u.kick = 1; for (let q = 0; q < 3; q++) spawnShooter(hoverPlanet.position.clone().add(new THREE.Vector3(Math.random() * 2, Math.random() * 2, 0))); return; }
    dragging = true; lastX = e.clientX; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; };
  const onUp = () => { dragging = false; el.style.cursor = 'grab'; };
  const onLeave = () => { pointerIn = false; };
  const onClickSpace = () => {};
  el.style.cursor = 'grab';
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp); el.addEventListener('pointerleave', onLeave);

  const handPose = (g, tt, base) => {
    const rise = eOut(seg(tt, 0, 1.3)), out = eIn(seg(tt, 3.2, 4.4));
    const shake = Math.sin(seg(tt, 1.3, 2.05) * Math.PI) * Math.sin(tt * 38) * 0.035;
    const tilt = eInOut(seg(tt, 2.1, 2.6));
    g.position.set(base.x + shake * 0.6, lerp(-8, base.y, rise) - out * 9 + Math.sin(tt * 1.6) * 0.05 * (1 - out), 0);
    g.rotation.set(-0.08 * tilt + shake * 0.5, YAW, 0.5 * tilt * (1 - seg(tt, 3.2, 4.0)) + shake, 'YXZ');
    g.scale.setScalar(base.k);
  };

  let t = 0, loaded = false, raf = 0;
  let aBlend = 0, lastAn = null, flyT = 9, pulseT = 9;
  const aPos = new THREE.Vector3(), aDir = new THREE.Vector3(), aW = new THREE.Vector3(), qAn = new THREE.Quaternion();
  const clock = new THREE.Clock();
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), vA = new THREE.Vector3(), vB = new THREE.Vector3(), eul = new THREE.Euler(), tmpQ = new THREE.Quaternion();
  const sm = { x: 0, y: 0 };

  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (loaded) t += reduced ? 10 : dt * o.speed;
    const s = clamp(getScroll ? getScroll() : 0, 0, 2);
    sm.x += ((pointerIn ? mouse.x : 0) - sm.x) * Math.min(1, dt * 3); sm.y += ((pointerIn ? mouse.y : 0) - sm.y) * Math.min(1, dt * 3);
    if (!dragging) { spinV *= 0.94; spin += spinV; spin *= 1 - Math.min(1, dt * 0.8); }

    const mk = mobile ? 1 : clamp(W / 1400, 0.52, 1), shift = mobile ? 0 : (1 - mk) * 5;
    const base = mobile ? { x: 0.35, y: 1.25, k: 0.7 } : { x: 3.6 + shift * 0.2, y: -1.1 - shift * 0.25, k: 1.5 * mk };
    handPose(hand, t, base);
    socket.position.set(0, halfT + 0.02, -1.25 + halfX * 0.92); socket.rotation.set(0, -YAW, 0);
    // grip → release
    const g0 = seg(t, 2.0, 2.35), grip = 1 - eOut(g0), strain = Math.sin(seg(t, 1.3, 2.0) * Math.PI) * 0.08;
    const cl = [[0.38, 1.35, 0.95], [-0.05, 0.12, 0.08]];
    joints.forEach((fj, fi) => fj.forEach((j, k) => { if (k < 3) j.rotation.x = lerp(cl[1][k], cl[0][k] + strain, grip) - fi * 0.02 * (1 - grip) * k; }));
    thumb[0].rotation.x = lerp(0.1, 0.75, grip); thumb[0].rotation.y = lerp(-1.25, -0.85, grip);
    thumb[1].rotation.x = lerp(0.05, 0.7, grip); thumb[2].rotation.x = lerp(0.05, 0.55, grip);
    rig.updateMatrixWorld(true);

    // held pose
    const heldPose = (tt, pos, quat) => {
      handPose(ghost.hand, tt, base); ghost.socket.position.copy(socket.position);
      ghost.hand.updateMatrixWorld(true);
      ghost.socket.getWorldPosition(pos); ghost.socket.getWorldQuaternion(quat);
      rig.worldToLocal(pos); quat.premultiply(tmpQ.copy(rig.quaternion).invert());
    };
    const slipPose = (u, pos, quat) => {
      heldPose(Math.min(t, 2.6), pos, quat);
      const k = base.k;
      pos.x -= 1.4 * k * eIn(u); pos.y -= 5.2 * k * Math.pow(Math.max(0, u - 0.25) / 0.75, 2);
      pos.z += 0.6 * u;
      quat.multiply(tmpQ.setFromEuler(eul.set(0.9 * eIn(u), 0.3 * u, 1.9 * eIn(u))));
    };

    // float pose
    const fx = mobile ? [0, 0, 0] : [2.7 + shift * 0.35, -2.6, 0];
    const fy = mobile ? [-0.4, 1.9, 1.4] : [0.2, 0.5, 1.4];
    const fz = mobile ? [0, 0, 0] : [0.6, 1.8, 0.4];
    const fk = mobile ? [0.93, 0.93, 1.05] : [1.35 * mk, 1.6 * mk, 1.3 * mk];
    const fyaw = [-0.35, 0.55, 0];
    const sp = o.exit ? 0 : s;
    const i = Math.min(1, Math.floor(sp)), f = eInOut(sp - i);
    const spinS = sp > 1 ? eInOut(sp - 1) * Math.PI * 2 : 0;
    const floatPos = vB.set(lerp(fx[i], fx[i + 1], f), lerp(fy[i], fy[i + 1], f) + Math.sin(t * 1.3) * 0.12, lerp(fz[i], fz[i + 1], f));
    const floatK = lerp(fk[i], fk[i + 1], f);
    qB.setFromEuler(eul.set(0.95 - sm.y * 0.25, lerp(fyaw[i], fyaw[i + 1], f) + sm.x * 0.45 + spin + spinS, 0.06 + Math.sin(t * 0.8) * 0.04, 'YXZ'));

    let k = base.k;
    if (t < 2.3) { heldPose(t, vA, qA); pad.position.copy(vA); pad.quaternion.copy(qA); }
    else if (t < 3.2) { slipPose(seg(t, 2.3, 3.2), vA, qA); pad.position.copy(vA); pad.quaternion.copy(qA); }
    else {
      slipPose(1, vA, qA);
      const c = seg(t, 3.2, 4.6), e = eBack(c);
      pad.position.lerpVectors(vA, floatPos, e);
      pad.quaternion.slerpQuaternions(qA, qB, clamp(eOut(c)));
      pad.rotateY(Math.sin(seg(t, 3.2, 4.2) * Math.PI) * -1.2);
      k = lerp(base.k, floatK, eOut(c));
    }
    pad.scale.setScalar(k);
    if (o.exit) { const ex = eIn(clamp(s * 1.2)); pad.position.y += ex * 7; pad.rotateY(ex * 2.5); }
    // DOM anchor (claim section / booking dock)
    flyT += dt; pulseT += dt;
    const an = getAnchor && t > 3.2 ? getAnchor() : null;
    const prevBlend = aBlend;
    aBlend += ((an ? 1 : 0) - aBlend) * Math.min(1, dt * 3.2);
    if (an) lastAn = an;
    if (aBlend > 0.002 && lastAn) {
      camera.updateMatrixWorld();
      aDir.set((lastAn.x / W) * 2 - 1, -(lastAn.y / H) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
      const d = -camera.position.z / aDir.z;
      aW.copy(camera.position).addScaledVector(aDir, d);
      const visH = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const ak = (lastAn.w * visH / H) / 3.2;
      rig.worldToLocal(aW); aW.y += Math.sin(t * 1.3) * 0.08 * ak;
      if (prevBlend < 0.01) aPos.copy(pad.position);
      aPos.lerp(aW, Math.min(1, dt * (flyT < 3 ? 4 : 7)));
      const flySpin = eInOut(seg(flyT, 0, 1.5)) * Math.PI * 2;
      qAn.setFromEuler(eul.set(0.95 - sm.y * 0.2 - Math.sin(seg(flyT, 0, 1.5) * Math.PI) * 0.5, sm.x * 0.4 + spin + flySpin, Math.sin(t * 0.8) * 0.04, 'YXZ'));
      pad.position.lerp(aPos, aBlend);
      pad.quaternion.slerp(qAn, aBlend);
      pad.scale.setScalar(lerp(pad.scale.x, ak, aBlend));
    }

    const rc = seg(t, 3.15, 4.1);
    ring.position.set(vA.x, vA.y - 0.2, vA.z);
    ring.scale.setScalar(0.5 + eOut(rc) * 4.5);
    ringMat.opacity = rc > 0 && rc < 1 ? (1 - rc) * o.glow : 0;
    const flash = rc > 0 ? Math.max(0, 1 - rc * 1.4) : 0;
    rimC.intensity = 4 + flash * 10;
    bloom.strength = (0.3 + flash * 0.7) * o.glow;
    if (pulseT < 0.9) { const r2 = pulseT / 0.9; ring.position.copy(pad.position); ring.position.y -= 0.3 * pad.scale.x; ring.scale.setScalar(pad.scale.x * (0.6 + eOut(r2) * 3)); ringMat.opacity = (1 - r2) * o.glow; rimC.intensity = 4 + (1 - r2) * 9; bloom.strength = (0.3 + (1 - r2) * 0.6) * o.glow; }
    

    skyMat.uniforms.uTime.value = t; skyMat.uniforms.uGlow.value = o.glow;
    const now = clock.elapsedTime;
    starLayers.forEach(L => { L.material.uniforms.uTime.value = now; L.material.uniforms.uWarp.value = flash + Math.min(1, Math.abs(scrollV) * 3);
      L.position.x += (-sm.x * L.userData.par * 20 - L.position.x) * Math.min(1, dt * 3);
      L.position.y += (-sm.y * L.userData.par * 12 + s * L.userData.par * 18 - L.position.y) * Math.min(1, dt * 3);
      L.rotation.y += dt * 0.004; });
    // planets: parallax drift, hover glow, click kick
    ray.setFromCamera(mouse, camera);
    const hit = pointerIn && !dragging ? ray.intersectObjects(planetMeshes, false)[0] : null;
    const hovered = hit ? hit.object.userData.planet : null;
    if (hovered !== hoverPlanet) { hoverPlanet = hovered; el.style.cursor = hovered ? 'pointer' : (dragging ? 'grabbing' : 'grab'); onPlanet && onPlanet(hovered ? hovered.userData.name : null); }
    planets.forEach((p, pi) => { const u = p.userData;
      u.hover += ((p === hoverPlanet ? 1 : 0) - u.hover) * Math.min(1, dt * 6); u.kick = Math.max(0, u.kick - dt * 0.8);
      u.mat.uniforms.uHover.value = Math.max(u.hover, u.kick);
      if (u.ringMat) u.ringMat.uniforms.uHover.value = Math.max(u.hover, u.kick);
      u.mesh.rotation.y += dt * (u.spin + u.kick * 8);
      const depth = -u.home.z;
      p.position.set(u.home.x - sm.x * 6 / depth * 4 + Math.sin(now * 0.2 + u.phase) * 0.3, u.home.y - sm.y * 3 / depth * 4 + s * 12 / depth * 2 + Math.cos(now * 0.25 + u.phase) * 0.25, u.home.z);
      p.scale.setScalar(1 + u.hover * 0.12 + Math.sin(u.kick * Math.PI) * 0.2);
    });
    for (let q = shooters.length - 1; q >= 0; q--) { const sh = shooters[q]; sh.t += dt; sh.p.addScaledVector(sh.v, dt);
      const a = sh.l.geometry.attributes.position.array; a[0] = sh.p.x; a[1] = sh.p.y; a[2] = sh.p.z; a[3] = sh.p.x - sh.v.x * 0.12; a[4] = sh.p.y - sh.v.y * 0.12; a[5] = sh.p.z;
      sh.l.geometry.attributes.position.needsUpdate = true; sh.l.material.opacity = Math.sin(Math.min(1, sh.t / 1.2) * Math.PI);
      if (sh.t > 1.2) { scene.remove(sh.l); sh.l.geometry.dispose(); sh.l.material.dispose(); shooters.splice(q, 1); } }
    if (!reduced && Math.random() < dt * 0.35) spawnShooter();
    scrollV *= 0.9; const ds = s - lastS; lastS = s; scrollV += ds;

    camera.position.x += (sm.x * 0.5 - camera.position.x) * Math.min(1, dt * 2);
    camera.lookAt(0, 0.2, 0);
    composer.render();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    replay() { t = 0; spin = 0; spinV = 0; },
    fly() { flyT = 0; },
    pulse() { pulseT = 0; },
    set(next) { const prev = o; o = { ...o, ...next }; if (prev.flip !== o.flip || prev.turn !== o.turn || prev.mirror !== o.mirror) applyOrient(); },
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect();
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointerleave', onLeave);
      scene.traverse(ob => { ob.geometry && ob.geometry.dispose(); });
      pmrem.dispose(); renderer.dispose(); el.remove();
    },
  };
}

