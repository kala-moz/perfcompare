/**
 * Shared KDE + mode-fitting pipeline used by CommonGraph (chart overlays) and
 * KdeModesPanel (per-mode blurb). Lifting this out of CommonGraph keeps both
 * consumers working on the same grid and the same detected modes, so labels
 * and narrative can't drift.
 */
import {
  areaFracs,
  assignLetters,
  fftkde,
  fitModesFromKde,
} from './kde.js';

const KDE_GRID_POINTS = 1024;

export type KdeCurve = {
  x: ArrayLike<number>;
  y: number[] | Float64Array;
  bandwidth: number;
};

export type ModeInfo = {
  peakLocs: number[];
  boundaries: number[];
  fracs: number[];
  letters: string[];
};

export type KdeAnalysis = {
  // Native KDE outputs (used by callers that need raw bandwidth or axis bounds).
  bKde: KdeCurve | null;
  nKde: KdeCurve | null;
  // Shared evaluation grid spanning the union of both KDEs' x-ranges.
  sharedX: number[];
  // Per-series density resampled onto sharedX. Empty when that side has no KDE.
  baseY: number[];
  newY: number[];
  // Mode info derived from the shared-grid curves.
  baseModes: ModeInfo;
  newModes: ModeInfo;
};

const EMPTY_MODE: ModeInfo = {
  peakLocs: [],
  boundaries: [],
  fracs: [],
  letters: [],
};

function quantileSorted(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

// Silverman-Jones bandwidth approximation — produces a wider (smoother) kernel
// than ISJ, which works better for the small sample counts typical of top-level
// aggregated results.
export function approximateSJBandwidth(sorted: number[]): number {
  const n = sorted.length;
  if (n < 2) return sorted[0] * 0.0015;
  const q25 = quantileSorted(sorted, 0.25);
  const q75 = quantileSorted(sorted, 0.75);
  const iqr = q75 - q25;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(
    sorted.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / n,
  );
  const sigma = Math.min(std, iqr / 1.34);
  return 0.9 * sigma * Math.pow(n, -1 / 5);
}

// ISJ bandwidth selection can fail to converge on tiny or degenerate samples
// (few unique values, near-identical numbers). Fall back to Silverman's rule
// in that case — coarser, but it never fails.
export function safeKde(values: number[], bw?: number): KdeCurve | null {
  if (values.length < 2) return null;
  try {
    return fftkde(values, bw ?? 'ISJ', undefined, KDE_GRID_POINTS);
  } catch {
    return fftkde(values, 'silverman', undefined, KDE_GRID_POINTS);
  }
}

// Linearly resample a uniform-grid KDE curve onto an arbitrary target x array.
// Outside the source range we return 0: each KDE's grid is padded so its
// density has already tapered to ≈0 at the edges.
export function resampleOnto(
  srcX: ArrayLike<number>,
  srcY: ArrayLike<number>,
  targetX: number[],
): number[] {
  const n = srcX.length;
  const lo = srcX[0];
  const hi = srcX[n - 1];
  const step = (hi - lo) / (n - 1);
  const out = new Array<number>(targetX.length);
  for (let i = 0; i < targetX.length; i++) {
    const x = targetX[i];
    if (x < lo || x > hi) {
      out[i] = 0;
      continue;
    }
    // Clamp the lower index so x === hi lands on j = n-2 with frac = 1.
    const t = (x - lo) / step;
    const j = Math.min(Math.floor(t), n - 2);
    const frac = t - j;
    out[i] = srcY[j] * (1 - frac) + srcY[j + 1] * frac;
  }
  return out;
}

function computeModeInfo(x: number[], y: number[], vt: number): ModeInfo {
  if (!x.length || !y.length) return EMPTY_MODE;
  const { peakLocs, boundaries } = fitModesFromKde(x, y, vt);
  if (!peakLocs.length) return EMPTY_MODE;
  return {
    peakLocs,
    boundaries,
    fracs: areaFracs(x, y, boundaries),
    letters: assignLetters(peakLocs),
  };
}

/**
 * Run the full pipeline: KDE for each side → shared grid → resample → fit modes.
 *
 * `isSubtest` controls the bandwidth: top-level results use the wider SJ
 * approximation (small samples), subtest results use ISJ (more data, tighter
 * bandwidth).
 */
export function computeKdeAnalysis(
  baseValues: number[],
  newValues: number[],
  vt: number,
  isSubtest: boolean,
): KdeAnalysis {
  let baseBw: number | undefined;
  let newBw: number | undefined;
  if (!isSubtest) {
    const baseSorted = [...baseValues].sort((a, b) => a - b);
    const newSorted = [...newValues].sort((a, b) => a - b);
    baseBw =
      baseSorted.length >= 2 ? approximateSJBandwidth(baseSorted) : undefined;
    newBw =
      newSorted.length >= 2 ? approximateSJBandwidth(newSorted) : undefined;
  }

  const bKde = safeKde(baseValues, baseBw);
  const nKde = safeKde(newValues, newBw);

  const xs: number[] = [];
  if (bKde) xs.push(bKde.x[0], bKde.x[bKde.x.length - 1]);
  if (nKde) xs.push(nKde.x[0], nKde.x[nKde.x.length - 1]);
  const sharedX: number[] = [];
  if (xs.length) {
    const xStart = Math.min(...xs);
    const xEnd = Math.max(...xs);
    if (Number.isFinite(xStart) && Number.isFinite(xEnd) && xEnd > xStart) {
      for (let i = 0; i < KDE_GRID_POINTS; i++) {
        sharedX.push(xStart + ((xEnd - xStart) * i) / (KDE_GRID_POINTS - 1));
      }
    }
  }

  const baseY = bKde ? resampleOnto(bKde.x, bKde.y, sharedX) : [];
  const newY = nKde ? resampleOnto(nKde.x, nKde.y, sharedX) : [];

  return {
    bKde,
    nKde,
    sharedX,
    baseY,
    newY,
    baseModes: bKde ? computeModeInfo(sharedX, baseY, vt) : EMPTY_MODE,
    newModes: nKde ? computeModeInfo(sharedX, newY, vt) : EMPTY_MODE,
  };
}
