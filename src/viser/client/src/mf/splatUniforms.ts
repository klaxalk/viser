/** ModelForge's uniforms of a splat material (GaussianSplatsHelpers.ts creates them with the material): the SH texture
 * and the lighting / glow / wind state of lights.ts and wind.ts. Every live material is kept, so a state change
 * reaches all of them (applyAll). */
import * as THREE from "three";
import type { MergedSh } from "./splatMerge";
import { MAX_LAMPS } from "./splatShaders";
import { diagState, mfDiag } from "./diag";
import { litState, type ShadowMap } from "./lightState";

const materials = new Set<THREE.ShaderMaterial>();

function setUniform(m: THREE.ShaderMaterial, k: string, v: unknown) {
  if (m.uniforms[k]) m.uniforms[k].value = v;
  else m.uniforms[k] = { value: v };
}

/** An RGBA32UI texture of w x h texels (a 1 x 1 dummy without data: an integer sampler must be bound to an integer
 * texture), disposed with the material. */
function uintTexture(
  data: Uint32Array | null,
  w: number,
  h: number,
): THREE.DataTexture {
  const D = new Uint32Array(w * h * 4);
  if (data) D.set(data.subarray(0, Math.min(data.length, D.length)));
  const t = new THREE.DataTexture(
    D,
    w,
    h,
    THREE.RGBAIntegerFormat,
    THREE.UnsignedIntType,
  );
  t.internalFormat = "RGBA32UI";
  t.needsUpdate = true;
  return t;
}

function setTexture(m: THREE.ShaderMaterial, k: string, t: THREE.DataTexture) {
  const old = m.uniforms[k]?.value as THREE.DataTexture | undefined;
  if (old) old.dispose();
  if (m.uniforms[k]) m.uniforms[k].value = t;
  else {
    m.uniforms[k] = { value: t };
    m.addEventListener("dispose", () =>
      (m.uniforms[k].value as THREE.DataTexture).dispose(),
    );
  }
}

/** The SH texture of a material: created, resized or refilled (ceil(K / 4) texels per Gaussian). */
export function mfShTexture(
  m: THREE.ShaderMaterial,
  sh: MergedSh | null,
  numGaussians: number,
  maxTextureSize: number,
) {
  const T = sh ? sh.texels : 1;
  const w = sh ? Math.max(1, Math.min(numGaussians * T, maxTextureSize)) : 1;
  const h = sh ? Math.max(1, Math.ceil((numGaussians * T) / w)) : 1;
  const old = m.uniforms.mfShTex?.value as THREE.DataTexture | undefined;
  if (old && old.image.width === w && old.image.height === h) {
    const D = old.image.data as Uint32Array;
    D.fill(0);
    if (sh) D.set(sh.data);
    old.needsUpdate = true;
  } else {
    diagState.shInfo = `${w}x${h} texels, ${T} per Gaussian, degree ${sh ? sh.degree : 0}, ${numGaussians} Gaussians`;
    if (sh) mfDiag(`sh texture ${diagState.shInfo}`);
    setTexture(m, "mfShTex", uintTexture(sh ? sh.data : null, w, h));
  }
  setUniform(m, "mfShT", T);
  setUniform(m, "mfDeg", sh ? sh.degree : 0);
  m.uniformsNeedUpdate = true;
}

/** A shadow map's texture, replaced only when the map changed (its id). */
function shadowTexture(
  m: THREE.ShaderMaterial,
  k: string,
  s: ShadowMap | null,
) {
  const t = m.uniforms[k]?.value as
    (THREE.DataTexture & { mfId?: number }) | undefined;
  const id = s ? s.id : 0;
  if (t && t.mfId === id) return;
  const X = uintTexture(
    s ? s.data : null,
    s ? s.w : 1,
    s ? s.h : 1,
  ) as THREE.DataTexture & { mfId?: number };
  X.mfId = id;
  setTexture(m, k, X);
}

/** The lighting, glow and wind uniforms of a material, from the page's state; registers the material. */
export function mfLitApply(m: THREE.ShaderMaterial) {
  const d = litState.light;
  const s = litState.sunShadow;
  const q = litState.lampShadow;
  const on = !!(d && d.on);
  const lamps = new Float32Array(16 * MAX_LAMPS);
  if (on && d!.lamps) lamps.set(d!.lamps.slice(0, 16 * MAX_LAMPS));
  setUniform(m, "mfLit", on ? 1 : 0);
  setUniform(
    m,
    "mfLitA",
    on ? [d!.day, d!.ref, d!.n, s && d!.shadows ? 1 : 0] : [0, 0, 0, 0],
  );
  setUniform(m, "mfSun", on && d!.sun ? d!.sun : [0, 0, 1, 0]);
  setUniform(m, "mfLamps", lamps);
  shadowTexture(m, "mfShadowTex", s);
  shadowTexture(m, "mfLampShTex", q);
  setUniform(
    m,
    "mfLsP",
    on && q && d!.lsid === q.id ? [q.res, q.n || 0, 0, 0] : [1, 0, 0, 0],
  );
  setUniform(m, "mfLitB", [on && d!.nw != null ? d!.nw : 1, 0, 0, 0]);
  const G = d && d.glow;
  setUniform(m, "mfGlowA", G ? [1, G[0], 0, 0] : [0, 0, 0, 0]);
  setUniform(m, "mfGlowC1", G ? [G[1], G[2], G[3], 0] : [0, 0, 0, 0]);
  setUniform(m, "mfGlowC2", G ? [G[4], G[5], G[6], 0] : [0, 0, 0, 0]);
  const W = litState.wind;
  const wo = !!(W && W.on);
  setUniform(
    m,
    "mfWind",
    wo ? [1, W!.strength, W!.freq, W!.gust] : [0, 0, 0, 0],
  );
  setUniform(
    m,
    "mfWindB",
    wo ? [W!.dx, W!.dy, W!.flutter, litState.windTime] : [1, 0, 0, 0],
  );
  setUniform(m, "mfWindS", wo ? [W!.grass, W!.bush, W!.tree, 0] : [0, 0, 0, 0]);
  setUniform(m, "mfShU", s ? s.u : [1, 0, 0, 0]);
  setUniform(m, "mfShV", s ? s.v : [0, 1, 0, 0]);
  setUniform(m, "mfShP", s ? s.p : [1, 1, 0, 1]);
  m.uniformsNeedUpdate = true;
  if (!materials.has(m)) {
    materials.add(m);
    m.addEventListener("dispose", () => materials.delete(m));
  }
}

/** A new splat material: its SH texture and the current lighting. */
export function mfSplatMaterial(
  m: THREE.ShaderMaterial,
  sh: MergedSh | null,
  numGaussians: number,
  maxTextureSize: number,
) {
  mfShTexture(m, sh, numGaussians, maxTextureSize);
  mfLitApply(m);
}

export function applyAllSplatMaterials() {
  for (const m of materials) mfLitApply(m);
}

/** The wind's clock in every material (every frame while the wind is on). */
export function setWindTime(t: number) {
  for (const m of materials) {
    const u = m.uniforms.mfWindB;
    if (u) {
      const v = u.value as number[];
      u.value = [v[0], v[1], v[2], t];
      m.uniformsNeedUpdate = true;
    }
  }
}
