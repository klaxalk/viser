/** ModelForge's additions to viser's client, started once when the page loads (src/index.tsx imports this).
 *
 * The GUI (modelforge/gui/app.py) talks to them through hidden state elements (el.ts) and hidden text inputs
 * (viewer.ts mfSendValue). Inside viser's own files, the hooks are marked "ModelForge" (see README.md). */
import { startDiag } from "./diag";
import { startFly } from "./fly";
import { startLasso } from "./lasso";
import { startLights } from "./lights";
import { startPage } from "./page";
import { startUploads } from "./upload";
import { startVersionBar } from "./version";
import { startWind } from "./wind";

startPage();
startUploads();
startDiag();
startFly();
startLights();
startWind();
startLasso();
startVersionBar();
