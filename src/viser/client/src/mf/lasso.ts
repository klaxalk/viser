/** Edit → Floaters' lasso (modelforge/gui/floaters_edit.py): while #mf-move-speed carries data-lasso (the uuid of a
 * hidden text input), a left-button drag on the 3D view draws a loop instead of turning the camera (window capture
 * listeners stop the event before camera-controls and viser see it; Ctrl + drag and the other buttons are left to
 * them). Its release sends {n, sub (Shift held: take away), w, h (the view's size), p: the loop in 0-1 of the view};
 * the server projects with its own copy of the camera (floater_cut.in_lasso). */
import { mfControls } from "./el";
import { mfMutable, mfSendValue } from "./viewer";

let loop: [number, number][] | null = null;
let overlay: HTMLCanvasElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let subtract = false;
let count = 0;

const uuid = () => mfControls()?.lasso || "";
const at = (e: PointerEvent, r: DOMRect): [number, number] => [
  (e.clientX - r.left) / r.width,
  (e.clientY - r.top) / r.height,
];
const stop = (e: Event) => {
  e.preventDefault();
  e.stopImmediatePropagation();
};

function draw() {
  if (!overlay || !loop) return;
  const c = overlay.getContext("2d")!;
  const w = overlay.width;
  const h = overlay.height;
  c.clearRect(0, 0, w, h);
  c.beginPath();
  loop.forEach((q, i) => (i ? c.lineTo(q[0] * w, q[1] * h) : c.moveTo(q[0] * w, q[1] * h)));
  c.closePath();
  const col = subtract ? "255,200,0" : "230,0,230";
  c.fillStyle = "rgba(" + col + ",0.15)";
  c.fill();
  c.strokeStyle = "rgb(" + col + ")";
  c.lineWidth = 2;
  c.setLineDash([6, 4]);
  c.stroke();
}

function down(e: PointerEvent) {
  const m = mfMutable();
  if (!uuid() || !m || !m.canvas || e.target !== m.canvas || e.button !== 0 || e.ctrlKey || e.metaKey) return;
  canvas = m.canvas;
  const r = canvas.getBoundingClientRect();
  loop = [at(e, r)];
  subtract = e.shiftKey;
  stop(e);
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* capture is optional */
  }
  if (!overlay) {
    overlay = document.createElement("canvas");
    overlay.style.cssText = "position:fixed;pointer-events:none;z-index:9999";
  }
  Object.assign(overlay.style, {
    left: r.left + "px",
    top: r.top + "px",
    width: r.width + "px",
    height: r.height + "px",
  });
  overlay.width = Math.round(r.width);
  overlay.height = Math.round(r.height);
  document.body.appendChild(overlay);
  draw();
}

function move(e: PointerEvent) {
  if (!loop) return;
  stop(e);
  const r = canvas!.getBoundingClientRect();
  const p = at(e, r);
  const q = loop[loop.length - 1];
  subtract = e.shiftKey;
  if (Math.hypot((p[0] - q[0]) * r.width, (p[1] - q[1]) * r.height) >= 3) {
    loop.push(p);
    draw();
  }
}

function end(e: PointerEvent) {
  if (!loop) return;
  stop(e);
  const r = canvas!.getBoundingClientRect();
  const L = loop;
  const u = uuid();
  loop = null;
  overlay?.remove();
  try {
    canvas!.releasePointerCapture(e.pointerId);
  } catch {
    /* capture is optional */
  }
  if (e.type === "pointerup" && L.length >= 3 && u)
    mfSendValue(
      u,
      JSON.stringify({
        n: ++count,
        sub: e.shiftKey ? 1 : 0,
        w: Math.round(r.width),
        h: Math.round(r.height),
        p: L.map((q) => [+q[0].toFixed(4), +q[1].toFixed(4)]),
      }),
    );
}

export function startLasso() {
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
  window.addEventListener(
    "click",
    (e) => {
      const m = mfMutable();
      if (uuid() && m && e.target === m.canvas && !e.ctrlKey && !e.metaKey) stop(e);
    },
    true,
  );
}
