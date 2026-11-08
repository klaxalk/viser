/** The browser tab and page-level helpers, following the GUI's hidden #mf-status element (gui/app.py
 * `_status_html`, kept by `_watch_status`):
 * - data-title becomes the tab title; data-state (idle / running / failed) picks the icon (running: a green dot,
 *   failed: a red one) on our icon (favicon.svg);
 * - a change of data-notice ("<n>|<text>", `App._notice`: a job or queue entry ended) shows a system notification while
 *   the page is in the background (permission asked at a click; needs https or localhost; the GUI shows an in-page
 *   notice in every case). The permission is reported through the page-diagnostics input (`App._page_diag` →
 *   Settings → Notifications);
 * - a change of data-tab ("<n>|<label>", `App.show_tab`) clicks the tab of that label (the Photo window's tabs);
 * - clicks on an img[data-mf-click="<uuid>"] (gui/tiepoints.py, gui/map.py) go to that hidden text input as
 *   "fx,fy,time" (fractions of the image's width / height). */
import faviconSvg from "./favicon.svg?raw";
import { mfDiagSend } from "./diag";
import { mfControls } from "./el";
import { mfSendValue } from "./viewer";

const BADGES: { [state: string]: string } = { idle: "", running: "#2ecc71", failed: "#ff4d4f" };

function icon(colour: string): string {
  let svg = faviconSvg;
  if (colour)
    svg = svg.replace(
      "</svg>",
      `<circle cx="50" cy="50" r="11" fill="${colour}" stroke="#17212d" stroke-width="4"/></svg>`,
    );
  return "data:image/svg+xml," + encodeURIComponent(svg.replace(/\s+/g, " ").trim());
}

const ICONS: { [state: string]: string } = Object.fromEntries(
  Object.entries(BADGES).map(([k, c]) => [k, icon(c)]),
);

let shownState = "";
let notice: string | null = null;
let tab: string | null = null;
let reportedPermission = "";
let reportedTo: string | undefined = "";

function iconLink(): HTMLLinkElement {
  let l = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!l) {
    l = document.createElement("link");
    l.rel = "icon";
    document.head.appendChild(l);
  }
  return l;
}

function follow() {
  const e = document.getElementById("mf-status");
  if (!e) return;
  const title = e.dataset.title || "ModelForge";
  if (document.title !== title) document.title = title;
  const s = e.dataset.state || "idle";
  if (s !== shownState) {
    shownState = s;
    iconLink().href = ICONS[s] || ICONS.idle;
  }
  const n = e.dataset.notice || "";
  if (notice === null) notice = n;
  else if (n !== notice) {
    notice = n;
    const k = n.indexOf("|");
    if (
      k >= 0 &&
      window.Notification &&
      Notification.permission === "granted" &&
      (document.hidden || !document.hasFocus())
    ) {
      try {
        new Notification("ModelForge", { body: n.slice(k + 1), icon: ICONS.idle });
      } catch {
        /* some browsers refuse page notifications */
      }
    }
  }
  const p = !window.isSecureContext ? "insecure" : !window.Notification ? "unsupported" : Notification.permission;
  const u = mfControls()?.diag;
  if (u && (p !== reportedPermission || u !== reportedTo) && mfDiagSend("0 notifications: " + p)) {
    reportedPermission = p;
    reportedTo = u;
  }
  const tb = e.dataset.tab || "";
  if (tab === null) tab = tb;
  else if (tb !== tab) {
    tab = tb;
    const label = tb.slice(tb.indexOf("|") + 1);
    for (const b of document.querySelectorAll('[role="tab"]')) {
      if (b.textContent?.trim() === label) {
        (b as HTMLElement).click();
        break;
      }
    }
  }
}

export function startPage() {
  document.title = "ModelForge";
  iconLink().href = ICONS.idle;
  document.addEventListener("click", () => {
    if (window.isSecureContext && window.Notification && Notification.permission === "default")
      Notification.requestPermission().then(follow);
  });
  new MutationObserver(follow).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-title", "data-state", "data-notice", "data-tab"],
  });
  setInterval(follow, 2000);
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.matches || !t.matches("img[data-mf-click]")) return;
      const r = t.getBoundingClientRect();
      if (!r.width) return;
      mfSendValue(
        t.dataset.mfClick!,
        ((e.clientX - r.left) / r.width).toFixed(6) + "," + ((e.clientY - r.top) / r.height).toFixed(6) + "," + Date.now(),
      );
    },
    true,
  );
}
