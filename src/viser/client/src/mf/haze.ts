/** View → Surroundings → Haze with distance (modelforge/haze.py): #mf-haze data-haze (HazeData) into litState; the
 * splat's vertex shader (splatShaders.ts HAZE) and the unlit GLB materials (lights.ts) blend each colour towards the
 * airlight by T = exp(-k d) per channel in linear light, d the distance from the camera. The airlight follows
 * Edit → Lights → Preview as the sky box does (modelforge/lights.py sky_brightness). A missing element keeps the
 * last state. */
import { mfEl } from "./el";
import { litState } from "./lightState";
import { applyLights } from "./lights";

let hazeKey: string | null = null;

/** [k_r, k_g, k_b, on] and [airlight r, g, b, 0] as the shaders take them. */
export function hazeUniforms(): [number[], number[]] {
  const h = litState.haze;
  if (!h || !h.on || !h.k || !h.c) return [[0, 0, 0, 0], [0, 0, 0, 0]];
  const d = litState.light;
  let b = 1;
  if (d && d.on) {
    const sun = d.sun ? Math.min(d.sun[3], 1) : 0;
    b = Math.max(0.03, Math.min(1, d.day + 0.6 * sun));
  }
  return [
    [h.k[0], h.k[1], h.k[2], 1],
    [h.c[0] * b, h.c[1] * b, h.c[2] * b, 0],
  ];
}

function read() {
  const e = mfEl("mf-haze");
  if (!e) return;
  const v = e.dataset.haze || "";
  if (v === hazeKey) return;
  hazeKey = v;
  try {
    litState.haze = v ? JSON.parse(v) : null;
  } catch {
    litState.haze = null;
  }
  applyLights();
}

export function startHaze() {
  new MutationObserver(read).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-haze"],
  });
  setInterval(read, 1000);
}
