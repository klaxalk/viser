/** WebGL diagnostics to the GUI log (gui/app.py `_page_diag`, through the hidden input #mf-move-speed data-diag
 * names): the GPU and its limits, the SH texture's shape, GL errors (polled each second), lost contexts, three.js
 * errors and warnings. Each distinct line is sent once. */
import { mfControls } from "./el";
import { mfSendValue } from "./viewer";

const queue: string[] = [];
const seen = new Set<string>();
let sent = 0;
let gl: WebGL2RenderingContext | null = null;
let lost = 0;

/** The SH texture's shape, for GL error lines (set by splatUniforms). */
export const diagState = { shInfo: "" };

export function mfDiag(line: unknown) {
  const s = String(line).slice(0, 400);
  if (!seen.has(s) && seen.size < 200) {
    seen.add(s);
    queue.push(s);
  }
}

/** A numbered line for the page-diagnostics input; "0 …" lines are status reports (notifications) sent at once. */
export function mfDiagSend(line: string): boolean {
  const u = mfControls()?.diag;
  return !!u && mfSendValue(u, line);
}

function poll() {
  const c = document.querySelector("canvas");
  if (!gl && c) {
    gl = c.getContext("webgl2");
    if (gl) {
      const x = gl.getExtension("WEBGL_debug_renderer_info");
      mfDiag(
        "gpu " +
          (x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) +
          " | max texture " +
          gl.getParameter(gl.MAX_TEXTURE_SIZE) +
          " | vertex texture units " +
          gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) +
          " | " +
          navigator.userAgent,
      );
      c.addEventListener("webglcontextlost", () => {
        lost++;
        mfDiag("WebGL context lost (" + lost + ")");
      });
      c.addEventListener("webglcontextrestored", () => mfDiag("WebGL context restored"));
    }
  }
  if (gl) {
    const e = gl.getError();
    if (e) mfDiag("GL error 0x" + e.toString(16) + (diagState.shInfo ? " (sh " + diagState.shInfo + ")" : ""));
  }
}

/** One queued line per call: the GUI's handler reads the input's value when it runs, so two lines sent at once
 * arrived as the second one twice. */
function flush() {
  if (queue.length && sent < 300 && mfDiagSend(sent + 1 + " " + queue[0])) {
    sent++;
    queue.shift();
  }
}

export function startDiag() {
  for (const k of ["error", "warn"] as const) {
    const f = console[k].bind(console);
    console[k] = (...a: unknown[]) => {
      f(...a);
      try {
        const s = a.map(String).join(" ");
        if (/THREE|WebGL|shader|GL_|context|program/i.test(s) && !/computeBoundingSphere|reversed depth|Clock/.test(s))
          mfDiag(k + ": " + s);
      } catch {
        /* never let a diagnostic break the page */
      }
    };
  }
  addEventListener("error", (e) => mfDiag("page error: " + e.message + " (" + e.filename + ":" + e.lineno + ")"));
  addEventListener("unhandledrejection", (e) => mfDiag("page error (promise): " + e.reason));
  setInterval(poll, 1000);
  setInterval(flush, 250);
}
