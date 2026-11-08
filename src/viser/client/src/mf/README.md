# ModelForge's additions to viser's client

This branch (`modelforge` of github.com/klaxalk/viser, ModelForge's submodule `third_party/viser`) is viser 1.1.1
(github.com/nerfstudio-project/viser, tag v1.1.1, MIT) with ModelForge's browser features built in. They used to be search-and-replace patches on viser's minified bundle (`docker/patch_viser_camera.py`,
`docker/patch_viser_page.py`, removed 2026-11-08). The plan and what is left: `docs/todo_viser_fork.md`.

Build: `scripts/install_viser_fork` (or the image's `viser-client` stage). Node ≥ 24.

## Our files (src/mf/)

| File                                    | What                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `index.ts`                              | starts everything below once, when the page loads (imported by `src/index.tsx`)                                  |
| `viewer.ts`                             | the viewer context for page-level code; `mfSend`, `mfSendValue` (the page-to-server channel: hidden text inputs) |
| `el.ts`                                 | `mfEl`: the GUI's hidden state elements, also while the right panel is closed                                    |
| `page.ts`                               | tab title and icon by job state, system notifications, server-selected tabs, photo clicks                        |
| `upload.ts`                             | streaming, resumable uploads (`modelforge/gui/upload.py`)                                                        |
| `diag.ts`                               | WebGL diagnostics and page errors to the GUI log                                                                 |
| `fly.ts`                                | View → Fly in the page                                                                                           |
| `splatMerge.ts`                         | merging splat objects, with the SH words (node-tested: `tests/test_splat_sh.py`)                                 |
| `splatShaders.ts`                       | GLSL: SH bands, lighting preview (`modelforge/relight.py`), window glow, wind                                    |
| `splatUniforms.ts`                      | those shaders' uniforms and textures per splat material                                                          |
| `lightState.ts`, `lights.ts`, `wind.ts` | Edit → Lights → Preview and View → Wind state from the GUI; unlit GLB materials                                  |
| `lasso.ts`                              | Edit → Floaters' lasso                                                                                           |
| `version.ts`                            | the "page out of date" bar (`__MF_PAGE_VERSION__`, `build/mf_version.txt` from `vite.config.mts`)                |
| `favicon.svg`                           | our icon (a copy of `docker/favicon.svg`)                                                                        |

## Hooks in viser's own files (each marked "ModelForge")

| File                                     | Change                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `index.html`                             | title ModelForge                                                                  |
| `vite.config.mts`                        | the page version (`__MF_PAGE_VERSION__`, `build/mf_version.txt`)                  |
| `src/index.tsx`                          | `import "./mf"`                                                                   |
| `src/App.tsx`                            | `setMfViewer(viewer)`                                                             |
| `src/MessageHandler.tsx`                 | `FileTransferPartAck` goes to `mfUploadAck` first                                 |
| `src/CameraControls.tsx`                 | F / R instead of Q / E, the move speed, Orbit, Fly                                |
| `src/Splatting/GaussianSplats.tsx`       | `mergeSplats`; buffer updates staged until sorted (generations)                   |
| `src/Splatting/SplatSortWorker.ts`       | the buffer generation in every sort result                                        |
| `src/Splatting/GaussianSplatsHelpers.ts` | our shader chunks and uniforms; the group index in the reserved word's lower half |
| `src/mesh/SingleGlbAsset.tsx`            | unlit materials via `mfUnlitMaterial`                                             |

To move to a newer viser: rebase this branch onto the new upstream tag, keep the hooks above. Before committing client
code, viser's gates (its CLAUDE.md): `npx tsc --noEmit`, `npx eslint src/`, `npx prettier --check src/`,
`npx vitest run src`.
