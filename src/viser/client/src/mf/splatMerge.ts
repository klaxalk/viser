/** The merge of all splat objects into one buffer (replaces viser's mergeGaussianGroups), with ModelForge's
 * view-dependent colours (View → Splat colours, modelforge/gui/data.py `pack_splats`).
 *
 * viser draws one RGB per Gaussian (band 0). A splat buffer may carry spherical-harmonic coefficients after its 8 words
 * per Gaussian: the first Gaussian's reserved word (3, which the merge overwrites with the group index) holds
 * 0x4D46 << 16 | degree << 8 | K, then K words per Gaussian follow the N x 8 block (a float16 scale, then int8
 * coefficients, coefficient-major with interleaved channels). The merge keeps the 8-word layout for the sorter and the
 * main texture and gathers the coefficients into `sh` (ceil(K / 4) RGBA32UI texels per Gaussian, zeros for objects
 * without them). Buffers without the tag merge as viser's do.
 *
 * The upper half of every other Gaussian's reserved word (the glow / wind code, modelforge/gui/data.py) is kept under
 * the group index. The first Gaussian of each object loses it (it held the tag).
 *
 * Dependency-free: tests/test_splat_sh.py runs it in node. */

export type MergedSh = { data: Uint32Array; texels: number; degree: number };
export type MergedSplats = {
  numGaussians: number;
  gaussianBuffer: Uint32Array;
  numGroups: number;
  groupIndices: Uint32Array;
  sh: MergedSh | null;
};

export const SH_TAG = 0x4d46;

export function mergeSplats(groupBufferFromName: {
  [name: string]: Uint32Array;
}): MergedSplats {
  const buffers = Object.values(groupBufferFromName);
  let n = 0;
  let texels = 0;
  let degree = 0;
  const parts: [Uint32Array, number, number][] = [];
  for (const b of buffers) {
    const head = b.length >= 8 ? b[3] >>> 0 : 0;
    let K = 0;
    let d = 0;
    if (head >>> 16 === SH_TAG) {
      K = head & 255;
      d = (head >>> 8) & 255;
    }
    const g = b.length / (8 + K);
    parts.push([b, g, K]);
    n += g;
    if (K) {
      texels = Math.max(texels, Math.ceil(K / 4));
      degree = Math.max(degree, d);
    }
  }
  const r = new Uint32Array(n * 8);
  const groupIndices = new Uint32Array(n);
  const sh = texels ? new Uint32Array(n * texels * 4) : null;
  let a = 0;
  parts.forEach(([b, g, K], t) => {
    groupIndices.fill(t, a, a + g);
    r.set(b.subarray(0, g * 8), a * 8);
    for (let k = 0; k < g; k++)
      r[(a + k) * 8 + 3] =
        (t | (k === 0 ? 0 : b[k * 8 + 3] & 0xffff0000)) >>> 0;
    if (K) {
      const s = b.subarray(g * 8);
      if (K === 4 * texels) sh!.set(s, a * 4 * texels);
      else
        for (let k = 0; k < g; k++)
          sh!.set(s.subarray(k * K, k * K + K), (a + k) * 4 * texels);
    }
    a += g;
  });
  return {
    numGaussians: n,
    gaussianBuffer: r,
    numGroups: buffers.length,
    groupIndices,
    sh: sh ? { data: sh, texels, degree } : null,
  };
}
