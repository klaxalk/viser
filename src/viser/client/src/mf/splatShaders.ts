/** ModelForge's chunks of the splat vertex shader (GaussianSplatsHelpers.ts puts them in):
 * - SH: view-dependent colour from the SH texture (mfShTex, splatMerge.ts), as gsplat evaluates it;
 * - LIT: Edit → Lights → Preview, the shading of modelforge/relight.py (the Unreal plugin's) per Gaussian: daylight,
 *   the sun with its shadow map, up to MAX_LAMPS lamps with their shadow cubes;
 * - GLOW: Edit → Lights' glowing windows;
 * - WIND: View → Wind, the breeze of the Unreal plugin (MFSplat.usf WindOffset).
 *
 * No dynamically indexed local arrays and no loops in GLSL: every coefficient byte, lamp and shadow tap is unrolled
 * here with constant indices. The first SH shader unpacked bytes into dynamically indexed arrays: fine in software
 * WebGL, nothing drawn on the user's AMD GPU (Firefox, Linux), with no error anywhere. highp throughout the lighting
 * (viser's shader is mediump).
 *
 * Checked against relight.py / gsplat / a numpy port in Firefox's WebGL: build/sh_webgl_test.py,
 * build/lit_webgl_test.py, build/lamp_shadow_webgl_test.py, build/wind_webgl_test.py. */

export const MAX_LAMPS = 16; // = modelforge/relight.py MAX_LAMPS

/** Coefficient k (0..14) of a Gaussian's SH texels as r, g, b: byte 2 + 3k + ch of its words (2 bytes of scale). */
function coef(k: number): string {
  const parts: string[] = [];
  for (let ch = 0; ch < 3; ch++) {
    const b = 2 + 3 * k + ch;
    const w = Math.floor(b / 4);
    parts.push(`mfB(w${Math.floor(w / 4)}.${"xyzw"[w % 4]}, ${8 * (b % 4)}u)`);
  }
  return `vec3(${parts.join(", ")})`;
}

const fetchSh = (o: number) =>
  `texelFetch(mfShTex, ivec2((b + ${o}u) % uint(ts.x), (b + ${o}u) / uint(ts.x)), 0)`;

const SH = `
// One signed coefficient byte of an SH word.
float mfB(uint w, uint s) {
  float v = float((w >> s) & 255u);
  return v > 127.0 ? v - 256.0 : v;
}
// The SH bands 1..mfDeg for direction d (camera -> Gaussian, in the object's frame); the coefficients scaled by the
// Gaussian's float16 scale / 127. Only the texels a degree needs are fetched.
vec3 mfSh(uint idx, vec3 d) {
  ivec2 ts = textureSize(mfShTex, 0);
  uint b = idx * mfShT;
  uvec4 w0 = ${fetchSh(0)};
  float x = d.x, y = d.y, z = d.z;
  vec3 r = 0.4886025119029199 * (-y * ${coef(0)} + z * ${coef(1)} - x * ${coef(2)});
  if (mfDeg > 1) {
    uvec4 w1 = ${fetchSh(1)};
    float xx = x * x, yy = y * y, zz = z * z;
    r += 1.0925484305920792 * x * y * ${coef(3)}
      - 1.0925484305920792 * y * z * ${coef(4)}
      + 0.31539156525252005 * (2.0 * zz - xx - yy) * ${coef(5)}
      - 1.0925484305920792 * x * z * ${coef(6)}
      + 0.5462742152960396 * (xx - yy) * ${coef(7)};
    if (mfDeg > 2) {
      uvec4 w2 = ${fetchSh(2)};
      r += -0.5900435899266435 * y * (3.0 * xx - yy) * ${coef(8)}
        + 2.890611442640554 * x * y * z * ${coef(9)}
        - 0.4570457994644658 * y * (4.0 * zz - xx - yy) * ${coef(10)}
        + 0.3731763325901154 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * ${coef(11)}
        - 0.4570457994644658 * x * (4.0 * zz - xx - yy) * ${coef(12)}
        + 1.445305721320277 * z * (xx - yy) * ${coef(13)}
        - 0.5900435899266435 * x * (xx - 3.0 * yy) * ${coef(14)};
    }
  }
  return r * (unpackHalf2x16(w0.x).x / 127.0);
}
`;

/** Lamp k's light at p (mfLitA.z: the number of lamps): mfLamps holds 4 vec4 per lamp (position + 1 / radius; linear colour x cd + type 0 point /
 * 1 spot / 2 rect; direction; cos outer + 1 / cone range + shadow slot + 1). */
function lamp(k: number): string {
  const [a, b, c, d] = [4 * k, 4 * k + 1, 4 * k + 2, 4 * k + 3];
  return `
  if (mfLitA.z > ${k}.5) {
    highp vec4 r0 = mfLamps[${a}], r1 = mfLamps[${b}], r2 = mfLamps[${c}], r3 = mfLamps[${d}];
    highp vec3 toL = r0.xyz - p;
    highp float d2 = dot(toL, toL);
    highp float kk = d2 * r0.w * r0.w;
    highp float m = clamp(1.0 - kk * kk, 0.0, 1.0);
    m = m * m / max(d2, 1e-4);
    highp vec3 L = toL * inversesqrt(max(d2, 1e-12));
    highp float al = dot(L, -r2.xyz);
    if (r1.w > 0.5 && r1.w < 1.5) { highp float c = clamp((al - r3.x) * r3.y, 0.0, 1.0); m *= c * c; }
    if (r1.w > 1.5) m *= clamp(al, 0.0, 1.0);
    if (r3.z > 0.5 && mfLsP.y > 0.5 && m > 0.0) m *= mfLampVis(r3.z, r0.xyz, 1.0 / r0.w, p, n, C);
    lamps += r1.rgb * (m * ((1.0 - w) * 0.5 + w * abs(dot(n, L))));
  }`;
}

const taps3x3 = (f: (dx: number, dy: number) => string) => {
  let s = "";
  for (const dy of [-1, 0, 1])
    for (const dx of [-1, 0, 1]) s += "\n  " + f(dx, dy);
  return s;
};

const LIT = `
highp vec3 mfLin(highp vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
highp vec3 mfSrgb(highp vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
// The covariance's shortest axis and its flatness (MFSplat.usf ShortestAxis), on the covariance / its trace.
highp vec3 mfAxis(highp mat3 S0, out highp float fl) {
  fl = 0.0;
  highp float tr = S0[0][0] + S0[1][1] + S0[2][2];
  if (!(tr > 0.0)) return vec3(0.0, 0.0, 1.0);
  highp mat3 S = S0 / tr;
  highp float p1 = S[0][1] * S[0][1] + S[0][2] * S[0][2] + S[1][2] * S[1][2];
  highp float q = (S[0][0] + S[1][1] + S[2][2]) / 3.0;
  highp float p2 = (S[0][0] - q) * (S[0][0] - q) + (S[1][1] - q) * (S[1][1] - q) + (S[2][2] - q) * (S[2][2] - q)
    + 2.0 * p1;
  highp float pp = sqrt(p2 / 6.0);
  if (pp <= 1e-7) return vec3(0.0, 0.0, 1.0);
  highp mat3 Bm = (S - q * mat3(1.0)) / pp;
  highp float r = clamp(0.5 * determinant(Bm), -1.0, 1.0);
  highp float phi = acos(r) / 3.0;
  highp float e1 = q + 2.0 * pp * cos(phi);
  highp float e3 = q + 2.0 * pp * cos(phi + 2.0943951);
  highp float e2 = 3.0 * q - e1 - e3;
  highp mat3 M = S - e3 * mat3(1.0);
  highp vec3 c0 = cross(M[0], M[1]), c1 = cross(M[0], M[2]), c2 = cross(M[1], M[2]);
  highp float d0 = dot(c0, c0), d1 = dot(c1, c1), d2 = dot(c2, c2);
  highp vec3 nn = d0 >= d1 && d0 >= d2 ? c0 : (d1 >= d2 ? c1 : c2);
  highp float dn = max(d0, max(d1, d2));
  if (dn <= 0.0) return vec3(0.0, 0.0, 1.0);
  fl = clamp(1.0 - sqrt(max(e3, 0.0) / max(e2, 1e-30)), 0.0, 1.0);
  return nn * inversesqrt(dn);
}
// One sun shadow-map depth: uint16 halves of the texel's words, 8 per RGBA32UI texel; -1e30 = nothing there.
highp float mfShD(int x, int y) {
  int res = int(mfShP.y);
  x = clamp(x, 0, res - 1);
  y = clamp(y, 0, res - 1);
  int i = y * res + x;
  int k = i / 8;
  int r = i - k * 8;
  int c = r / 2;
  ivec2 ts = textureSize(mfShadowTex, 0);
  uvec4 w = texelFetch(mfShadowTex, ivec2(k % ts.x, k / ts.x), 0);
  uint v = c == 0 ? w.x : (c == 1 ? w.y : (c == 2 ? w.z : w.w));
  uint qv = (r - c * 2) == 0 ? (v & 65535u) : (v >> 16u);
  return qv == 0u ? -1e30 : mfShP.z + float(qv - 1u) * mfShP.w;
}
// The share of the sun reaching the Gaussian (relight.SunShadow.visibility): 3 x 3 taps.
highp float mfSunVis(highp vec3 p0, highp vec3 n, highp mat3 C, highp vec3 l) {
  highp vec3 p = p0 + n * mfShP.x;
  highp float a = dot(p, mfShU.xyz) - mfShU.w;
  highp float b = dot(p, mfShV.xyz) - mfShV.w;
  int x = int(floor(a / mfShP.x));
  int y = int(floor(b / mfShP.x));
  int res = int(mfShP.y);
  if (x < 0 || y < 0 || x >= res || y >= res) return 1.0;
  highp float sl = sqrt(max(dot(l, C * l), 0.0));
  highp float ndl = max(abs(dot(n, l)), 0.2);
  highp float slope = min(sqrt(1.0 - ndl * ndl) / ndl, 3.0);
  highp float h = dot(p, l) + 2.5 * sl + 2.0 * mfShP.x * slope + 0.5 * mfShP.x + mfShP.w;
  highp float lit = 0.0;${taps3x3((dx, dy) => `lit += mfShD(x + ${dx}, y + ${dy}) <= h ? 1.0 : 0.0;`)}
  return lit / 9.0;
}
// One lamp shadow depth (relight.lamp_shadow_payload: faces of mfLsP.x texels, distance / radius as uint16).
highp float mfLsD(int base, int x, int y, highp float rad) {
  int R = int(mfLsP.x);
  x = clamp(x, 0, R - 1);
  y = clamp(y, 0, R - 1);
  int i = (base * R + y) * R + x;
  int k = i / 8;
  int r = i - k * 8;
  int c = r / 2;
  ivec2 ts = textureSize(mfLampShTex, 0);
  uvec4 w = texelFetch(mfLampShTex, ivec2(k % ts.x, k / ts.x), 0);
  uint v = c == 0 ? w.x : (c == 1 ? w.y : (c == 2 ? w.z : w.w));
  uint qv = (r - c * 2) == 0 ? (v & 65535u) : (v >> 16u);
  return qv == 0u ? 1e30 : float(qv - 1u) / 65533.0 * rad;
}
// The share of a lamp's light reaching the Gaussian (relight.LampShadow.visibility): its cube face, 3 x 3 taps.
highp float mfLampVis(highp float slot, highp vec3 lp, highp float rad, highp vec3 p0, highp vec3 n, highp mat3 C) {
  int R = int(mfLsP.x);
  highp float texel = length(p0 - lp) * 2.0 / float(R);
  highp vec3 p = p0 + n * texel;
  highp vec3 dv = p - lp;
  highp float dist = max(length(dv), 1e-9);
  highp vec3 a = abs(dv);
  int ax;
  highp float mm, sg, u, v;
  if (a.x >= a.y && a.x >= a.z) { ax = 0; mm = a.x; sg = dv.x; u = dv.y; v = dv.z; }
  else if (a.y >= a.z) { ax = 1; mm = a.y; sg = dv.y; u = dv.z; v = dv.x; }
  else { ax = 2; mm = a.z; sg = dv.z; u = dv.x; v = dv.y; }
  mm = max(mm, 1e-12);
  int base = (int(slot + 0.5) - 1) * 6 + 2 * ax + (sg < 0.0 ? 1 : 0);
  int x = int(floor((u / mm + 1.0) * 0.5 * float(R)));
  int y = int(floor((v / mm + 1.0) * 0.5 * float(R)));
  highp vec3 L = -dv / dist;
  highp float sl = sqrt(max(dot(L, C * L), 0.0));
  highp float ndl = max(abs(dot(n, L)), 0.2);
  highp float slope = min(sqrt(1.0 - ndl * ndl) / ndl, 3.0);
  highp float h = dist - 2.5 * sl - 2.0 * texel * slope - 0.5 * texel;
  highp float lit = 0.0;${taps3x3((dx, dy) => `lit += mfLsD(base, x + ${dx}, y + ${dy}, rad) >= h ? 1.0 : 0.0;`)}
  return lit / 9.0;
}
// The light factor (relight.factor) applied to the colour: daylight, the sun (disc + sphere shading by the
// Gaussian's flatness, optional shadow map), the lamps, against the capture light (cap1), in linear light.
vec3 mfRelight(vec3 rgb, highp vec3 p, highp mat3 C, highp mat4 T) {
  highp mat3 R = mat3(T);
  highp vec3 cam = -(transpose(R) * T[3].xyz);
  highp vec3 v = normalize(cam - p);
  highp float fl;
  highp vec3 n = mfAxis(C, fl);
  highp float w = fl * fl * mfLitB.x;
  if (dot(n, v) < 0.0) n = -n;
  highp float cap1 = (1.0 - w) * 0.6 + w * (0.6 + 0.4 * abs(n.z));
  highp vec3 f = vec3(mfLitA.x);
  if (mfSun.w > 0.0) {
    highp vec3 l = mfSun.xyz;
    highp float shade = (1.0 - w) * (1.0 + dot(v, l)) / 3.0 + w * clamp(dot(n, l), 0.0, 1.0);
    if (mfLitA.w > 0.5) shade *= mfSunVis(p, n, C, l);
    f += vec3(mfSun.w * shade / cap1);
  }
  highp vec3 lamps = vec3(0.0);${Array.from({ length: MAX_LAMPS }, (_, k) => lamp(k)).join("")}
  f += lamps / (max(mfLitA.y, 1e-6) * cap1);
  f = min(f, vec3(16.0));
  return vec3(mfSrgb(mfLin(rgb) * f));
}
`;

/** A glow code (the upper half of the Gaussian's reserved word, bit 15 clear: strength in its low byte, the window's
 * tint in the next 7 bits) adds mfGlowA.y x a tint between mfGlowC1 and mfGlowC2 (linear light), after the lighting. */
const GLOW = `
vec3 mfGlowAdd(vec3 rgb, uint code) {
  highp float s = float(code & 255u) / 255.0;
  highp float t = float((code >> 8u) & 127u) / 127.0;
  highp vec3 c = mix(mfGlowC1.rgb, mfGlowC2.rgb, t);
  return vec3(mfSrgb(mfLin(rgb) + c * (s * mfGlowA.y)));
}
`;

/** A swaying Gaussian's code: bit 15 set, its height above the ground in 0.1 m in bits 7-14, its sway 0-127 in bits
 * 0-6 (modelforge/gui/data.py WindField). The amplitude by class from the height as the Unreal export gives it (grass
 * below 0.6 m, bush below 3 m, else tree), but one sway frequency and phase per 3 m cell (0.8-1.2x by cell; an integer
 * hash, the same on every GPU): the plugin's frequency per Gaussian let one plant's heights drift apart, a trunk
 * bending into a zigzag after ~20 s. mfWind: on, strength, sway frequency, gustiness; mfWindB: where the wind blows to
 * (x, y in the splat's frame), flutter, time in s; mfWindS: sway of grass at its tips, a bush at 2 m, a tree at 10 m. */
const WIND = `
highp float mfHash2(highp vec2 c) {
  uvec2 q = uvec2(ivec2(c) + 32768);
  uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u);
  h ^= h >> 16u;
  h *= 2246822519u;
  h ^= h >> 13u;
  return float(h >> 8u) / 16777216.0;
}
highp vec3 mfWindOffset(highp vec3 p, uint code, uint gid) {
  highp float sway = float(code & 127u) / 127.0;
  highp float h = float((code >> 7u) & 255u) * 0.1;
  highp float amp;
  if (h < 0.6) amp = mfWindS.x * clamp(h / 0.5 + 0.3, 0.0, 1.0);
  else if (h < 3.0) amp = mfWindS.y * clamp(h / 2.0, 0.0, 1.0);
  else amp = mfWindS.z * pow(min(h, 30.0) / 10.0, 1.5);
  amp *= sway * mfWind.y;
  highp vec2 wd = mfWindB.xy;
  highp float t = mfWindB.w;
  highp float TAU = 6.2831853;
  highp float along = dot(p.xy, wd);
  highp vec2 cell = floor(p.xy / 3.0);
  highp float ph = mfHash2(cell) * TAU;
  highp float freq = mfWind.z * (0.8 + 0.4 * mfHash2(cell + vec2(17.0, 31.0)));
  highp float g = 0.5 + 0.5 * sin(TAU * 0.11 * t - along * 0.045) * sin(TAU * 0.067 * t - along * 0.019 + 1.3);
  highp float gust = 1.0 - mfWind.w + mfWind.w * 2.0 * g;
  highp float s = 0.75 * sin(TAU * freq * t + ph - along * 0.15) + 0.25 * sin(TAU * freq * 2.13 * t + ph * 1.7);
  highp float side = 0.25 * sin(TAU * freq * 1.37 * t + ph * 2.3);
  highp vec2 d = (wd * (0.5 + s) + vec2(-wd.y, wd.x) * side) * amp * gust;
  highp float fl = mfWindB.z * amp * 0.2 * sin(TAU * freq * 5.0 * t + fract(float(gid) * 0.6180339) * TAU);
  return vec3(d + fl * vec2(0.7, -0.5), -0.5 * dot(d, d) / max(h, 0.3) + fl * 0.5);
}
`;

/** Uniform declarations (values set by splatUniforms.ts). */
export const MF_UNIFORMS = `
  uniform usampler2D mfShTex;
  uniform uint mfShT;
  uniform int mfDeg;
  uniform int mfLit;
  uniform highp vec4 mfLitA;
  uniform highp vec4 mfLitB;
  uniform highp vec4 mfSun;
  uniform highp vec4 mfLamps[${4 * MAX_LAMPS}];
  uniform usampler2D mfShadowTex;
  uniform highp vec4 mfShU;
  uniform highp vec4 mfShV;
  uniform highp vec4 mfShP;
  uniform usampler2D mfLampShTex;
  uniform highp vec4 mfLsP;
  uniform highp vec4 mfGlowA;
  uniform highp vec4 mfGlowC1;
  uniform highp vec4 mfGlowC2;
  uniform highp vec4 mfWind;
  uniform highp vec4 mfWindB;
  uniform highp vec4 mfWindS;
`;

/** Functions, before main(). */
export const MF_FUNCTIONS = SH + LIT + GLOW + WIND;
