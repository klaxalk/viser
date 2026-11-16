/** View → Rain in the browser (modelforge/gui/rain.py): falling streaks in a box that follows the camera, all in the
 * vertex shader (no per-frame work on the CPU but the clock).
 *
 * #mf-rain data-rain (RainData) switches it and sets the look; #mf-rain-top (data-id, data-meta: JSON {x0, y0, cell,
 * w, h, z0, dz}, data-map: uint16 heights, base64) is the scene's top surface (roofs, crowns, ground: the SfM points'
 * floaters.Surface), below which no drop is drawn: the splat writes no depth, so without it rain would show through
 * the ground and the roofs. Meshes (the surroundings, COLMAP's) write depth and hide the drops behind them.
 *
 * Each drop is an instance with a random seed in the unit cube: its position = seed x box + velocity x time, wrapped
 * into the box around the camera (so drops stay fixed in the world while the camera moves: parallax), drawn as a
 * camera-facing quad from its head back along the velocity. Drops narrower than a pixel are widened to one and made
 * fainter by as much, so distant rain neither flickers nor brightens. Faded near the camera and towards the box's
 * sides. The colour follows Edit → Lights → Preview's daylight as the haze's airlight does. */
import * as THREE from "three";
import { mfEl } from "./el";
import { mfMutable, mfRequestRender, mfViewer } from "./viewer";
import { litState } from "./lightState";
import { SPLAT_RENDER_ORDER } from "../renderOrders";

/** #mf-rain data-rain. */
export type RainData = {
  on: boolean;
  rate: number; // 0-1: the share of MAX_DROPS
  speed: number; // m/s, falling
  len: number; // m, a streak
  box: number; // m, the box's side
  wx: number; // m/s, drift east
  wy: number; // m/s, drift north
  alpha: number; // a streak's opacity
};

const MAX_DROPS = 200_000;
const DROP_WIDTH = 0.004; // m

const VERT = `
attribute vec4 seed;
uniform float uTime;
uniform vec3 uCam;
uniform float uBox;
uniform vec3 uVel;
uniform float uLen;
uniform float uPix;
uniform sampler2D uTop;
uniform vec4 uTopGeo;  // x0, y0, 1 / (cell w), 1 / (cell h)
uniform vec2 uTopZ;    // z0, dz per unit (0: no surface)
varying float vAlpha;
varying vec2 vUv;
void main() {
  vec3 v = uVel * (0.85 + 0.3 * seed.w);
  vec3 p = seed.xyz * uBox + v * uTime;
  p = uCam + mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 dir = normalize(v);
  vec3 tail = p - dir * uLen * (0.7 + 0.6 * fract(seed.w * 7.31));
  float a = 1.0;
  if (uTopZ.y > 0.0) {
    vec2 st = (p.xy - uTopGeo.xy) * uTopGeo.zw;
    if (all(greaterThanEqual(st, vec2(0.0))) && all(lessThanEqual(st, vec2(1.0)))) {
      float top = uTopZ.x + texture2D(uTop, st).r * 65535.0 * uTopZ.y;
      if (p.z < top) a = 0.0;
    }
  }
  vec3 mid = 0.5 * (p + tail);
  float d = length(mid - uCam);
  vec3 side = cross(p - tail, uCam - mid);
  float sl = length(side);
  side = sl > 1e-6 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = max(${DROP_WIDTH.toFixed(4)}, d * uPix);
  a *= ${DROP_WIDTH.toFixed(4)} / w;
  a *= smoothstep(0.3, 1.5, d);
  vec3 o = abs(p - uCam) / (0.5 * uBox);
  a *= 1.0 - smoothstep(0.6, 1.0, max(max(o.x, o.y), o.z));
  vAlpha = a;
  vUv = vec2(position.x, position.y);
  vec3 q = mix(tail, p, position.y) + side * w * position.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
}
`;

const FRAG = `
uniform vec4 uColour;
varying float vAlpha;
varying vec2 vUv;
void main() {
  float a = vAlpha * (1.0 - vUv.x * vUv.x) * smoothstep(0.0, 0.35, vUv.y);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColour.rgb, uColour.a * a);
}
`;

let rain: RainData | null = null;
let rainKey: string | null = null;
let topId: string | null = null;
let mesh: THREE.Mesh | null = null;
let geom: THREE.InstancedBufferGeometry | null = null;
let running = false;
const t0 = performance.now();

const uniforms = {
  uTime: { value: 0 },
  uCam: { value: new THREE.Vector3() },
  uBox: { value: 40 },
  uVel: { value: new THREE.Vector3(0, 0, -7) },
  uLen: { value: 0.6 },
  uPix: { value: 0.001 },
  uTop: { value: null as THREE.Texture | null },
  uTopGeo: { value: new THREE.Vector4(0, 0, 0, 0) },
  uTopZ: { value: new THREE.Vector2(0, 0) },
  uColour: { value: new THREE.Vector4(0.8, 0.82, 0.86, 0.35) },
};

function build(): THREE.Mesh {
  geom = new THREE.InstancedBufferGeometry();
  // a quad: x across (-1, 1), y along (0 tail, 1 head)
  geom.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]),
      3,
    ),
  );
  geom.setIndex([0, 1, 2, 0, 2, 3]);
  const s = new Float32Array(MAX_DROPS * 4);
  let r = 12345;
  for (let i = 0; i < s.length; i++) {
    r = (Math.imul(r, 1103515245) + 12345) >>> 0;
    s[i] = (r >>> 8) / 16777216;
  }
  geom.setAttribute("seed", new THREE.InstancedBufferAttribute(s, 4));
  geom.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const m = new THREE.Mesh(geom, mat);
  m.frustumCulled = false;
  m.renderOrder = SPLAT_RENDER_ORDER + 1; // over the splat (it writes no depth), with the labels' tier
  m.name = "mf-rain";
  const inv = new THREE.Matrix4();
  const cam = new THREE.Vector3();
  m.onBeforeRender = (renderer, _scene, camera) => {
    // the camera in the root's frame (ENU), the drops' frame
    inv.copy(m.matrixWorld).invert();
    cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv);
    uniforms.uCam.value.copy(cam);
    const c = camera as THREE.PerspectiveCamera;
    const h = renderer.domElement.height || 1;
    uniforms.uPix.value = (2 * Math.tan(((c.fov || 50) * Math.PI) / 360)) / h;
  };
  return m;
}

/** The root scene node: the drops live in its frame (ENU, z up). */
function root(): THREE.Object3D | null {
  const v = mfViewer();
  if (!v) return null;
  return v.mutable.current.nodeRefFromName[""] || mfMutable()?.scene || null;
}

function brightness(): number {
  const d = litState.light;
  if (!d || !d.on) return 1;
  const sun = d.sun ? Math.min(d.sun[3], 1) : 0;
  return Math.max(0.03, Math.min(1, d.day + 0.6 * sun));
}

function apply() {
  const on = !!(rain && rain.on);
  if (on) {
    const r = root();
    if (!r) return; // the viewer is not up yet: read() tries again
    if (!mesh) mesh = build();
    if (mesh.parent !== r) {
      mesh.removeFromParent();
      r.add(mesh);
    }
    const R = rain!;
    geom!.instanceCount = Math.round(
      Math.max(0, Math.min(1, R.rate)) * MAX_DROPS,
    );
    uniforms.uBox.value = R.box;
    uniforms.uVel.value.set(R.wx, R.wy, -R.speed);
    uniforms.uLen.value = R.len;
    const b = brightness();
    uniforms.uColour.value.set(0.8 * b, 0.82 * b, 0.86 * b, R.alpha);
    mesh.visible = true;
    if (!running) {
      running = true;
      requestAnimationFrame(tick);
    }
  } else {
    running = false;
    if (mesh) mesh.visible = false;
  }
  mfRequestRender();
}

function tick() {
  if (!running) return;
  uniforms.uTime.value = ((performance.now() - t0) / 1000) % 3600;
  mfRequestRender();
  requestAnimationFrame(tick);
}

function readTop() {
  const e = mfEl("mf-rain-top");
  if (!e) return;
  const id = e.dataset.id || "";
  if (id === topId) return;
  topId = id;
  const old = uniforms.uTop.value;
  uniforms.uTop.value = null;
  uniforms.uTopZ.value.set(0, 0);
  if (old) old.dispose();
  if (!id || !e.dataset.map || !e.dataset.meta) return;
  try {
    const m = JSON.parse(e.dataset.meta);
    const bin = atob(e.dataset.map);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const u16 = new Uint16Array(u8.buffer, 0, m.w * m.h);
    // as floats 0-1 (R16 normalized textures need WebGL extensions): the shader scales back by 65535
    const f = new Float32Array(m.w * m.h);
    for (let i = 0; i < f.length; i++) f[i] = u16[i] / 65535;
    const t = new THREE.DataTexture(
      f,
      m.w,
      m.h,
      THREE.RedFormat,
      THREE.FloatType,
    );
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    uniforms.uTop.value = t;
    uniforms.uTopGeo.value.set(
      m.x0,
      m.y0,
      1 / (m.cell * m.w),
      1 / (m.cell * m.h),
    );
    uniforms.uTopZ.value.set(m.z0, m.dz);
  } catch {
    uniforms.uTop.value = null;
    uniforms.uTopZ.value.set(0, 0);
  }
  mfRequestRender();
}

function read() {
  readTop();
  const e = mfEl("mf-rain");
  if (!e) return;
  const v = e.dataset.rain || "";
  // the light preview changes the colour: applied with every read
  if (v !== rainKey) {
    rainKey = v;
    try {
      rain = v ? (JSON.parse(v) as RainData) : null;
    } catch {
      rain = null;
    }
  }
  apply();
}

export function startRain() {
  new MutationObserver(read).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-rain", "data-id"],
  });
  setInterval(read, 1000);
}
