/** View → Fly in the page: the browser flies the camera path itself, every frame (gui/app.py `_fly_*`).
 *
 * #mf-fly-path data-path: {id, t: path times, p: camera centres (3 per camera), q: wxyz quaternions of R_wc} in the
 * GUI's world, sent once per path. #mf-move-speed data-fly: the clock {path, epoch, t0, speed, loop, dist (look-at
 * distance), hold (s), paused, report (uuid of the hidden input for pause / resume reports)}.
 *
 * Positions follow the cubic Hermite curve with finite-difference tangents and orientations are slerped, as
 * gui.data.FlightPath does (checked in node: 0.1 mm, the sent rounding); viser's scene root transform maps them into
 * three.js. Look-at = ahead by `dist`; up = −y of the OpenCV camera (roll reproduced).
 *
 * A drag, wheel or held movement key on the 3D view hands the camera to the user until `hold` seconds after the last
 * one and pauses the flight: the page stops its clock at once and reports "pause:k:t", then "resume:k:t", so the
 * server pauses the clock (for every browser, the slider and the photo window) and continues it from t. Without an
 * answer within 3 s the page follows the server's clock again. */
import type { CameraControls } from "@react-three/drei";
import type * as THREE from "three";
import { mfEl, mfControls } from "./el";
import { mfSendValue } from "./viewer";

type Path = {
  id: number;
  t: number[];
  p: number[];
  q: number[];
  m: Float64Array;
};
type Clock = {
  path: number;
  t0: number;
  speed: number;
  loop: boolean;
  dist: number;
  hold: number;
  paused?: boolean;
  report?: string;
};

let path: Path | null = null;
let pathKey: string | null = null;
let clock: Clock | null = null;
let clockKey: string | null = null;
let clockStart = 0;
let touched = -1e9;
let holding = false;
let frozen: number | null = null;
let resumed = 0;
let seq = 0;

const now = () => performance.now();
const mark = () => {
  touched = now();
};
const on3d = (e: Event) =>
  (e.target as HTMLElement | null)?.tagName === "CANVAS";

export function startFly() {
  addEventListener("pointerdown", (e) => on3d(e) && mark(), true);
  addEventListener(
    "pointermove",
    (e) => (e as PointerEvent).buttons && on3d(e) && mark(),
    true,
  );
  addEventListener("wheel", (e) => on3d(e) && mark(), {
    capture: true,
    passive: true,
  });
}

function readPath(): Path | null {
  const el = mfEl("mf-fly-path");
  const s = el ? el.dataset.path || "" : "";
  if (s !== pathKey) {
    pathKey = s;
    path = null;
    if (s) {
      const d = JSON.parse(s);
      const n = d.t.length;
      const t: number[] = d.t;
      const p: number[] = d.p;
      const m = new Float64Array(3 * n);
      for (let k = 0; k < n; k++) {
        const a = k > 0 ? k - 1 : 0;
        const b = k < n - 1 ? k + 1 : n - 1;
        for (let j = 0; j < 3; j++)
          m[3 * k + j] = (p[3 * b + j] - p[3 * a + j]) / (t[b] - t[a]);
      }
      path = { id: d.id, t, p, q: d.q, m };
    }
  }
  return path;
}

/** Position, forward and up at path time t. */
function pose(P: Path, t: number): [number[], number[], number[]] {
  const T = P.t;
  const n = T.length;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const c = (lo + hi) >> 1;
    if (T[c] <= t) lo = c;
    else hi = c;
  }
  const k = lo;
  const h = T[k + 1] - T[k];
  const u = Math.min(1, Math.max(0, (t - T[k]) / h));
  const u2 = u * u;
  const u3 = u2 * u;
  const a = 2 * u3 - 3 * u2 + 1;
  const b = u3 - 2 * u2 + u;
  const c = -2 * u3 + 3 * u2;
  const d = u3 - u2;
  const p = P.p;
  const m = P.m;
  const x = [0, 0, 0];
  for (let j = 0; j < 3; j++)
    x[j] =
      a * p[3 * k + j] +
      b * h * m[3 * k + j] +
      c * p[3 * k + 3 + j] +
      d * h * m[3 * k + 3 + j];
  const q0 = P.q.slice(4 * k, 4 * k + 4);
  let q1 = P.q.slice(4 * k + 4, 4 * k + 8);
  let dt = q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3];
  if (dt < 0) {
    q1 = q1.map((v) => -v);
    dt = -dt;
  }
  let q: number[];
  if (dt > 0.9995) q = q0.map((v, i) => v + u * (q1[i] - v));
  else {
    const th = Math.acos(dt);
    const s = Math.sin(th);
    q = q0.map(
      (v, i) => (Math.sin((1 - u) * th) * v + Math.sin(u * th) * q1[i]) / s,
    );
  }
  const l = Math.hypot(...q);
  const w = q[0] / l;
  const X = q[1] / l;
  const Y = q[2] / l;
  const Z = q[3] / l;
  return [
    x,
    [2 * (X * Z + w * Y), 2 * (Y * Z - w * X), 1 - 2 * (X * X + Y * Y)],
    [-2 * (X * Y - w * Z), -(1 - 2 * (X * X + Z * Z)), -2 * (Y * Z + w * X)],
  ];
}

function report(kind: string, t: number) {
  if (clock?.report) mfSendValue(clock.report, kind + ":" + ++seq + ":" + t);
}

/** Called every frame from the camera controls' hook. True when the flight drove the camera this frame. */
export function mfFly(
  controls: CameraControls,
  root: () => THREE.Matrix4,
  keysHeld: boolean,
  requestRender: () => void,
): boolean {
  const s = mfControls()?.fly || "";
  if (!s) {
    clock = null;
    clockKey = null;
    holding = false;
    frozen = null;
    return false;
  }
  if (s !== clockKey) {
    clockKey = s;
    clock = JSON.parse(s) as Clock;
    clockStart = now();
    if (!clock.paused && !holding) frozen = null;
  }
  const C = clock!;
  const P = readPath();
  if (!P || P.id !== C.path) return false;
  if (keysHeld) mark();
  const D = P.t[P.t.length - 1];
  const clockNow = () => {
    const t = C.paused ? C.t0 : C.t0 + (C.speed * (now() - clockStart)) / 1000;
    return C.loop ? ((t % D) + D) % D : Math.min(t, D);
  };
  if (now() - touched < 1000 * C.hold) {
    if (!holding) {
      holding = true;
      frozen = clockNow();
      report("pause", frozen);
    }
    requestRender();
    return false;
  }
  if (holding) {
    holding = false;
    resumed = now();
    report("resume", frozen!);
  }
  if (frozen !== null && now() - resumed > 3000) frozen = null;
  const t = frozen !== null ? frozen : clockNow();
  const [x, f, up] = pose(P, t);
  const M = root().elements;
  const pt = (v: number[]) => [
    M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12],
    M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13],
    M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14],
  ];
  const dir = (v: number[]) => [
    M[0] * v[0] + M[4] * v[1] + M[8] * v[2],
    M[1] * v[0] + M[5] * v[1] + M[9] * v[2],
    M[2] * v[0] + M[6] * v[1] + M[10] * v[2],
  ];
  const p = pt(x);
  const g = pt([
    x[0] + f[0] * C.dist,
    x[1] + f[1] * C.dist,
    x[2] + f[2] * C.dist,
  ]);
  const u = dir(up);
  controls.camera.up.set(u[0], u[1], u[2]).normalize();
  controls.updateCameraUp();
  controls.setLookAt(p[0], p[1], p[2], g[0], g[1], g[2], false);
  requestRender();
  return true;
}
