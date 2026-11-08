/** Edit → Lights → Preview in the browser (modelforge/gui/lights.py): #mf-light (data-light, LightData), #mf-shadow and
 * #mf-lshadow (data-id, data-meta: JSON {res, w, h, u, v, p, n}, data-map: the zlib-compressed uint16 depths, base64)
 * into litState, then every splat material's uniforms and a redraw.
 *
 * Unlit GLB materials (View → Surroundings, modelforge/surroundings.unlit_glb; drawn without tone mapping, as the
 * splat) get one brightness for flat ground lit as the splat is (relight.factor with the normal up: daylight + sun
 * strength x its elevation term; lamps and shadows light only the splat), 1 while the preview is off: their colour
 * multiplies the texture in linear light. */
import type * as THREE from "three";
import { mfEl } from "./el";
import { mfDiag } from "./diag";
import { mfRequestRender } from "./viewer";
import { litState, type ShadowMap } from "./lightState";
import { applyAllSplatMaterials } from "./splatUniforms";

const unlitMaterials = new Set<THREE.MeshBasicMaterial>();

function unlitBrightness(): number {
  const d = litState.light;
  if (!d || !d.on) return 1;
  const s = d.sun;
  return Math.min(16, d.day + (s ? s[3] * Math.max(0, s[2]) : 0));
}

/** A GLB's MeshBasicMaterial (KHR_materials_unlit): no tone mapping, the preview's brightness (SingleGlbAsset.tsx). */
export function mfUnlitMaterial(m: THREE.MeshBasicMaterial) {
  m.toneMapped = false;
  if (!unlitMaterials.has(m)) {
    unlitMaterials.add(m);
    m.addEventListener("dispose", () => unlitMaterials.delete(m));
  }
  m.color.setScalar(unlitBrightness());
}

export function applyLights() {
  applyAllSplatMaterials();
  const k = unlitBrightness();
  for (const m of unlitMaterials) m.color.setScalar(k);
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
