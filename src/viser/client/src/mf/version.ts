/** A bar asking to reload a page whose code is older than the server's: viser reconnects a tab left open across a GUI
 * restart with its old code (the user moved the Normal detail slider in such a tab and nothing changed). The GUI
 * publishes the version of the client it serves (#mf-pagever data-v, gui/app.py `_page_version`: build/mf_version.txt,
 * written by vite.config.mts with the hash of src/). */
declare const __MF_PAGE_VERSION__: string;

export const PAGE_VERSION = __MF_PAGE_VERSION__;

export function startVersionBar() {
  let bar: HTMLDivElement | null = null;
  setInterval(() => {
    const e = document.getElementById("mf-pagever");
    const want = e ? e.dataset.v || "" : "";
    if (want && want !== PAGE_VERSION) {
      if (!bar) {
        bar = document.createElement("div");
        bar.style.cssText =
          "position:fixed;top:0;left:0;right:0;z-index:100000;background:#d9480f;color:#fff;" +
          "font:600 15px sans-serif;padding:8px 14px;text-align:center;cursor:pointer";
        bar.textContent =
          "ModelForge was updated: this page is out of date. Click here or press Ctrl + Shift + R to reload it.";
        bar.onclick = () => location.reload();
        document.body.appendChild(bar);
      }
    } else if (bar) {
      bar.remove();
      bar = null;
    }
  }, 2000);
}
