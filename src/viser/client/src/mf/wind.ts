/** View → Wind in the browser (modelforge/gui/wind.py): #mf-wind data-wind (WindData) into litState and every splat
 * material's uniforms; while it is on, the wind's clock advances and the view redraws every frame (viser draws on
 * demand). A missing element keeps the last state. */
import { mfEl } from "./el";
import { mfRequestRender } from "./viewer";
import { litState } from "./lightState";
import { applyAllSplatMaterials, setWindTime } from "./splatUniforms";

let windKey: string | null = null;
let running = false;

function tick() {
  if (!running) return;
  litState.windTime = (performance.now() / 1000) % 3600;
  setWindTime(litState.windTime);
  mfRequestRender();
  requestAnimationFrame(tick);
}

function read() {
  const e = mfEl("mf-wind");
  if (!e) return;
  const w = e.dataset.wind || "";
  if (w === windKey) return;
  windKey = w;
  try {
    litState.wind = w ? JSON.parse(w) : null;
  } catch {
    litState.wind = null;
  }
  applyAllSplatMaterials();
  const on = !!(litState.wind && litState.wind.on);
  if (on && !running) {
    running = true;
    requestAnimationFrame(tick);
  } else if (!on) running = false;
  mfRequestRender();
}

export function startWind() {
  new MutationObserver(read).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-wind"],
  });
  setInterval(read, 1000);
}
