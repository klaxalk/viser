/** ModelForge's additions to viser's client (src/mf/; see README.md there).
 *
 * The viewer context, for the page-level code outside React: App.tsx hands it over on every render. Its stores and
 * `mutable` (the message sender, the canvas, camera-controls, requestRender) stay the same objects across renders. */
import type { ViewerContextContents, ViewerMutable } from "../ViewerContext";
import type { Message } from "../WebsocketMessages";

let viewer: ViewerContextContents | null = null;

export function setMfViewer(v: ViewerContextContents) {
  viewer = v;
}

export function mfViewer(): ViewerContextContents | null {
  return viewer;
}

export function mfMutable(): ViewerMutable | null {
  return viewer ? viewer.mutable.current : null;
}

export function mfRequestRender() {
  mfMutable()?.requestRender();
}

/** Send a message to the server through viser's websocket; false when not connected. */
export function mfSend(message: Message): boolean {
  const m = mfMutable();
  // Before the connection (or while it is down) viser's sender only logs the message.
  if (!m || viewer!.useGui.get().websocketState !== "connected") return false;
  try {
    m.sendMessage(message);
    return true;
  } catch {
    return false;
  }
}

/** A value for the hidden text input `uuid` (the server's on_update gets it): the page-to-server channel. */
export function mfSendValue(uuid: string, value: string): boolean {
  return mfSend({
    type: "GuiUpdateMessage",
    uuid,
    updates: { value },
  } as Message);
}
