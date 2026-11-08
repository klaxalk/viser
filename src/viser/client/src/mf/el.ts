/** The GUI's hidden state elements (#mf-move-speed, #mf-fly-path, #mf-light, #mf-shadow, #mf-lshadow, #mf-wind, …):
 * add_html spans in the right panel whose data attributes carry the state the page follows.
 *
 * viser leaves a closed panel's contents out of the page, which stopped the wind, the lighting preview, Orbit and Fly
 * while it was closed (the user, 2026-11-04). mfEl(id) gives the element, or, while it is not in the page, one parsed
 * from the HTML element's content in viser's GUI store (the store keeps a closed panel's elements and their updates,
 * so a change made meanwhile still arrives). */
import { mfViewer } from "./viewer";

const uuidOf: { [id: string]: string | null } = {};
const parsed: { [id: string]: { s: string; e: HTMLElement | null } } = {};
let order: unknown = null;
let missing: { [id: string]: boolean } = {};

function holds(c: any, id: string): boolean {
  return (
    c &&
    c.type === "GuiHtmlMessage" &&
    c.props &&
    typeof c.props.content === "string" &&
    c.props.content.includes('id="' + id + '"')
  );
}

export function mfEl(id: string): HTMLElement | null {
  const e = document.getElementById(id);
  if (e) return e;
  const v = mfViewer();
  if (!v) return null;
  const configs = v.useGuiConfig;
  const o = v.useGui.get().guiOrderFromUuid;
  let u = uuidOf[id];
  let c: any = u ? configs.get(u) : undefined;
  if (!holds(c, id)) {
    // Search the store again only when its elements changed since the last miss.
    if (o !== order) {
      order = o;
      missing = {};
    }
    if (missing[id]) return null;
    u = null;
    c = undefined;
    for (const k in o) {
      const x = configs.get(k);
      if (holds(x, id)) {
        u = k;
        c = x;
        break;
      }
    }
    uuidOf[id] = u;
    if (!u) {
      missing[id] = true;
      return null;
    }
  }
  const s: string = c.props.content;
  if (parsed[id] && parsed[id].s === s) return parsed[id].e;
  const d = document.createElement("div");
  d.innerHTML = s;
  const r = d.querySelector("#" + id) as HTMLElement | null;
  parsed[id] = { s, e: r };
  return r;
}

/** The #mf-move-speed element's data (the move speed, Orbit, Fly's clock, the report / diagnostics / lasso uuids). */
export function mfControls(): DOMStringMap | null {
  const e = mfEl("mf-move-speed");
  return e ? e.dataset : null;
}
