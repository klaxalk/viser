/** Streaming, resumable uploads (modelforge/gui/upload.py has the protocol and the server side).
 *
 * A file picked in an input[data-mf-upload="<target>"] (gui/upload.widget) is sent in 1 MiB parts with at most 32 MiB
 * beyond the server's acknowledgement, through viser's own message sender; the acknowledgements come back as
 * FileTransferPartAck messages, which MessageHandler.tsx passes to mfUploadAck first. A stalled transfer (a dropped
 * connection) starts again and the server answers how much it has, so it resumes; picking the same file after a
 * reload resumes too. ■ Stop keeps what arrived. */
import { mfSend } from "./viewer";
import type { Message } from "../WebsocketMessages";

const CHUNK = 1048576;
const WINDOW = 32 * CHUNK;

type Upload = {
  tid?: string;
  acked: number;
  sent: number;
  last: number;
  started?: number;
  wake: (() => void) | null;
  err: boolean;
  onAck: (bytes: number) => void;
};
const uploads: { [transfer: string]: Upload } = {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2);
const send = (m: object) => mfSend(m as Message);
const mb = (b: number) => (b / 1e6).toFixed(b < 1e8 ? 1 : 0);

/** A FileTransferPartAck: true when it belongs to one of these uploads. */
export function mfUploadAck(n: { transfer_uuid: string; transferred_bytes: number }): boolean {
  const u = uploads[n.transfer_uuid];
  if (!u) return false;
  u.onAck(n.transferred_bytes);
  return true;
}

type Box = HTMLElement & { __mfStop?: boolean };

async function one(file: File, target: string, show: (s: string) => void, box: Box | null): Promise<boolean> {
  const parts = Math.ceil(file.size / CHUNK);
  const src = "mf-upload|" + target + "|" + file.lastModified;
  const t0 = Date.now();
  let t1 = 0;
  const u: Upload = { acked: -1, sent: 0, last: Date.now(), wake: null, err: false, onAck: () => {} };
  const start = () => {
    if (u.tid) delete uploads[u.tid];
    u.tid = newId();
    uploads[u.tid] = u;
    u.acked = -1;
    u.started = Date.now();
    send({
      type: "FileTransferStartUpload",
      source_component_uuid: src,
      transfer_uuid: u.tid,
      filename: file.name,
      mime_type: file.type || "",
      part_count: parts,
      size_bytes: file.size,
    });
  };
  u.onAck = (b) => {
    u.last = Date.now();
    if (b < 0) u.err = true;
    else {
      if (u.acked < 0) {
        u.sent = b; // the server's answer to a start: how much it already has
        if (b > 0 && !t1) t1 = b;
      }
      u.acked = Math.max(u.acked, b);
    }
    if (u.wake) {
      const w = u.wake;
      u.wake = null;
      w();
    }
  };
  const waitAck = (ms: number) =>
    new Promise<void>((r) => {
      u.wake = r;
      setTimeout(() => {
        if (u.wake === r) {
          u.wake = null;
          r();
        }
      }, ms);
    });
  const status = () => {
    const s = (Date.now() - t0) / 1000;
    const done = Math.max(u.acked, 0);
    const rate = (done - t1) / Math.max(s, 0.1);
    show(
      file.name + ": " + mb(done) + " / " + mb(file.size) + " MB (" +
        ((100 * done) / Math.max(file.size, 1)).toFixed(0) + " %)" +
        (rate > 0 ? ", " + mb(rate) + " MB/s" : "") +
        (t1 ? " · resumed at " + mb(t1) + " MB" : ""),
    );
  };
  start();
  while (!u.err && u.acked < file.size) {
    if (box && box.__mfStop) {
      if (u.acked >= 0)
        send({
          type: "FileTransferPart",
          source_component_uuid: "mf-upload",
          transfer_uuid: u.tid,
          part_index: -1,
          content: new Uint8Array(0),
        });
      delete uploads[u.tid!];
      show(
        file.name + ": stopped at " + mb(Math.max(u.acked, 0)) + " / " + mb(file.size) +
          " MB (kept: pick it again to resume)",
      );
      return false;
    }
    if (u.acked < 0) {
      await waitAck(1000);
      if (u.acked < 0 && Date.now() - u.started! > 5000) {
        show(file.name + ": waiting for the server …");
        start();
      }
      continue;
    }
    if (u.sent < file.size && u.sent - u.acked < WINDOW) {
      const i = Math.floor(u.sent / CHUNK);
      const buf = await file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK)).arrayBuffer();
      if (
        !send({
          type: "FileTransferPart",
          source_component_uuid: "mf-upload",
          transfer_uuid: u.tid,
          part_index: i,
          content: new Uint8Array(buf),
        })
      ) {
        await sleep(1000);
        continue;
      }
      u.sent = Math.min(file.size, (i + 1) * CHUNK);
      if (i % 8 === 0) status();
      continue;
    }
    await waitAck(1000);
    status();
    if (Date.now() - u.last > 8000) {
      show(file.name + ": no answer, resuming …");
      start();
    }
  }
  delete uploads[u.tid!];
  show(
    u.err
      ? file.name + ": refused or failed (see the message in the tab)"
      : file.name + ": uploaded (" + mb(file.size) + " MB in " + ((Date.now() - t0) / 1000).toFixed(0) + " s)",
  );
  return !u.err;
}

export function startUploads() {
  let busy: Promise<unknown> = Promise.resolve();
  document.addEventListener(
    "change",
    (e) => {
      const t = e.target as HTMLInputElement | null;
      if (!t || !t.matches || !t.matches("input[data-mf-upload]")) return;
      const box = t.closest("[data-mf-upload-box]") as Box | null;
      const out = box && box.querySelector(".mf-upload-status");
      const target = t.dataset.mfUpload!;
      const show = (s: string) => {
        if (out) out.textContent = s;
      };
      const stop = box && (box.querySelector(".mf-upload-stop") as HTMLElement | null);
      if (box) box.__mfStop = false;
      if (stop) stop.style.display = "";
      for (const f of Array.from(t.files || []))
        busy = busy.then(() => (box && box.__mfStop ? false : one(f, target, show, box))).catch((x) => show(String(x)));
      busy = busy.then(() => {
        if (stop && !Object.keys(uploads).length) stop.style.display = "none";
      });
      t.value = "";
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest) return;
      const b = t.closest(".mf-upload-stop") as HTMLElement | null;
      if (!b) return;
      const box = b.closest("[data-mf-upload-box]") as Box | null;
      if (box) box.__mfStop = true;
      b.style.display = "none";
    },
    true,
  );
  window.addEventListener("beforeunload", (e) => {
    if (Object.keys(uploads).length) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
