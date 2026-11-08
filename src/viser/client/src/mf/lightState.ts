/** The page's light and wind state (lights.ts and wind.ts read it from the GUI's hidden elements; splatUniforms.ts and
 * the unlit GLB materials use it). */

/** #mf-light data-light (modelforge/gui/lights.py `publish_light`). */
export type LightData = {
  on: number | boolean;
  day: number;
  ref: number;
  n: number; // lamps
  sun?: [number, number, number, number] | null; // towards the sun, strength
  lamps?: number[]; // 16 floats per lamp
  shadows?: number;
  lsid?: number; // the lamp shadow map the lamps' slots refer to
  nw?: number | null; // normal detail
  glow?: number[] | null; // strength, colour 1, colour 2 (also while `on` is 0)
};

/** A shadow map: uint16 depths, 8 per RGBA32UI texel (relight.shadow_payload / lamp_shadow_payload). */
export type ShadowMap = {
  id: number;
  res: number;
  w: number;
  h: number;
  n?: number; // lamps in a lamp shadow map
  u?: number[];
  v?: number[];
  p?: number[];
  data: Uint32Array;
};

/** #mf-wind data-wind (modelforge/gui/wind.py). */
export type WindData = {
  on: boolean;
  strength: number;
  freq: number;
  gust: number;
  dx: number;
  dy: number;
  flutter: number;
  grass: number;
  bush: number;
  tree: number;
};

export const litState: {
  light: LightData | null;
  sunShadow: ShadowMap | null;
  lampShadow: ShadowMap | null;
  wind: WindData | null;
  windTime: number;
} = { light: null, sunShadow: null, lampShadow: null, wind: null, windTime: 0 };
