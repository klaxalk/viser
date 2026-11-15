/** Edit → Lights → Preview in the browser (modelforge/gui/lights.py): #mf-light (data-light, LightData), #mf-shadow and
 * #mf-lshadow (data-id, data-meta: JSON {res, w, h, u, v, p, n}, data-map: the zlib-compressed uint16 depths, base64)
 * into litState, then every splat material's uniforms and a redraw.
 *
 * Unlit GLB materials (View → Surroundings, modelforge/surroundings.unlit_glb; drawn without tone mapping, as the
 * splat) get one colour for flat ground lit as the splat is (relight.factor with the normal up: daylight + sun
 * strength x its elevation term x the sun's colour; lamps and shadows light only the splat), white while the preview
 * is off: it multiplies the texture in linear light. They also take View → Surroundings → Haze with distance (haze.ts): the
 * fragment's colour blended towards the airlight by its distance from the camera (shared uniforms). */
import * as THREE from "three";
import { mfEl } from "./el";
import { mfDiag } from "./diag";
import { mfRequestRender } from "./viewer";
import { litState, type ShadowMap } from "./lightState";
import { applyAllSplatMaterials } from "./splatUniforms";
import { hazeUniforms } from "./haze";

const unlitMaterials = new Set<THREE.MeshBasicMaterial>();

function unlitBrightness(): [number, number, number] {
  const d = litState.light;
  if (!d || !d.on) return [1, 1, 1];
  const s = d.sun;
  const k = s ? s[3] * Math.max(0, s[2]) : 0;
  const c = d.sunc || [1, 1, 1];
  return [0, 1, 2].map((i) => Math.min(16, d.day + k * c[i])) as [
    number,
    number,
    number,
  ];
}

const hazeK = { value: new THREE.Vector4(0, 0, 0, 0) };
const hazeC = { value: new THREE.Vector4(0, 0, 0, 0) };

function setHaze() {
  const [k, c] = hazeUniforms();
  hazeK.value.fromArray(k);
  hazeC.value.fromArray(c);
}

/** The haze in MeshBasicMaterial's shader: the view-space distance per vertex, the blend before the output. */
function hazeShader(s: THREE.WebGLProgramParametersWithUniforms) {
  s.uniforms.mfHazeK = hazeK;
  s.uniforms.mfHazeC = hazeC;
  s.vertexShader = s.vertexShader
    .replace("void main() {", "varying float vMfDist;\nvoid main() {")
    .replace(
      "#include <project_vertex>",
      "#include <project_vertex>\n  vMfDist = length(mvPosition.xyz);",
    );
  s.fragmentShader = s.fragmentShader
    .replace(
      "void main() {",
      "uniform vec4 mfHazeK;\nuniform vec4 mfHazeC;\nvarying float vMfDist;\nvoid main() {",
    )
    .replace(
      "#include <opaque_fragment>",
      "if (mfHazeK.w > 0.5) { vec3 mfT = exp(-mfHazeK.xyz * vMfDist); " +
        "outgoingLight = outgoingLight * mfT + mfHazeC.rgb * (1.0 - mfT); }\n#include <opaque_fragment>",
    );
}

/** A GLB's MeshBasicMaterial (KHR_materials_unlit): no tone mapping, the preview's brightness and the haze
 * (SingleGlbAsset.tsx). */
export function mfUnlitMaterial(m: THREE.MeshBasicMaterial) {
  m.toneMapped = false;
  if (!unlitMaterials.has(m)) {
    unlitMaterials.add(m);
    m.addEventListener("dispose", () => unlitMaterials.delete(m));
    m.onBeforeCompile = hazeShader;
    m.customProgramCacheKey = () => "mfHaze";
    m.needsUpdate = true;
  }
  m.color.fromArray(unlitBrightness());
}

export function applyLights() {
  applyAllSplatMaterials();
  setHaze();
  const k = unlitBrightness();
  for (const m of unlitMaterials) m.color.fromArray(k);
  mfRequestRender();
}

const shownIds: { [el: string]: string } = {};

function readShadow(
  el: string,
  key: "sunShadow" | "lampShadow",
  label: string,
) {
  const s = mfEl(el);
  if (!s) return;
  const id = s.dataset.id || "";
  if (id === shownIds[el]) return;
  shownIds[el] = id;
  if (!id || !s.dataset.map) {
    litState[key] = null;
    applyLights();
    return;
  }
  const meta = JSON.parse(s.dataset.meta!);
  const b = Uint8Array.from(atob(s.dataset.map), (c) => c.charCodeAt(0));
  new Response(
    new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate")),
  )
    .arrayBuffer()
    .then((buf) => {
      if (shownIds[el] !== id) return;
      const d = new Uint32Array(meta.w * meta.h * 4);
      d.set(new Uint32Array(buf).subarray(0, d.length));
      litState[key] = { ...meta, id: +id, data: d } as ShadowMap;
      mfDiag(
        label +
          " " +
          meta.res +
          "x" +
          meta.res +
          (meta.n ? " x " + meta.n + " lamps" : "") +
          " (" +
          meta.w +
          "x" +
          meta.h +
          " texels)",
      );
      applyLights();
    })
    .catch((x) => mfDiag(label + " failed: " + x));
}

let lightKey: string | null = null;

/** A missing element (the right panel closed and not in viser's store either) keeps the last state. */
function read() {
  const e = mfEl("mf-light");
  if (!e) return;
  const l = e.dataset.light || "";
  if (l !== lightKey) {
    lightKey = l;
    try {
      litState.light = l ? JSON.parse(l) : null;
    } catch (x) {
      litState.light = null;
      mfDiag("lights: unreadable state (" + x + "): " + l.slice(0, 80));
    }
    applyLights();
  }
  readShadow("mf-shadow", "sunShadow", "sun shadow map");
  readShadow("mf-lshadow", "lampShadow", "lamp shadow map");
}

export function startLights() {
  new MutationObserver(read).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-light", "data-id"],
  });
  setInterval(read, 1000);
}
