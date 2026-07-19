// Seam-aware cut placement (Chopper-lite). Given the cross-section area sampled
// at candidate positions along one axis, choose where to cut so parts fit the
// printer while minimising total seam area (cut through narrow necks, not bulk).
// Axis-aligned only, so the connector engine's grid-cell adjacency still holds.

/** Minimum number of interior cuts so every slab of `span` fits `usable`. */
export function minCuts(span, usable) {
  if (!(usable > 0) || span <= usable) return 0;
  return Math.ceil(span / usable) - 1;
}

/** Equal-spacing offsets: the safe fallback, always feasible. */
function equalSpacing(lo, hi, nCuts) {
  const offsets = [];
  for (let i = 1; i <= nCuts; i++) offsets.push(lo + ((hi - lo) * i) / (nCuts + 1));
  return offsets;
}

/**
 * Choose cut offsets along one axis.
 *
 * @param {number} lo axis min (model bound)
 * @param {number} hi axis max
 * @param {number} usable max slab size that fits the printer (mm)
 * @param {Array<{pos:number, area:number}>} candidates interior positions with
 *   their cross-section area, sorted ascending by pos
 * @returns {number[]} chosen offsets (ascending). Empty if no cut is needed.
 */
export function optimalCutOffsets(lo, hi, usable, candidates) {
  const span = hi - lo;
  const n = minCuts(span, usable);
  if (n === 0) return [];
  if (!candidates || candidates.length < n) return equalSpacing(lo, hi, n);

  const C = candidates.filter((c) => c.pos > lo && c.pos < hi).sort((a, b) => a.pos - b.pos);
  if (C.length < n) return equalSpacing(lo, hi, n);

  const K = C.length;
  const INF = Infinity;
  // dp[j][k] = min total area placing j cuts with the last at candidate k, all
  // gaps so far (including lo -> first cut) <= usable. prev[j][k] for recon.
  const dp = Array.from({ length: n + 1 }, () => new Array(K).fill(INF));
  const prev = Array.from({ length: n + 1 }, () => new Array(K).fill(-1));

  for (let k = 0; k < K; k++) {
    if (C[k].pos - lo <= usable) dp[1][k] = C[k].area;
  }
  for (let j = 2; j <= n; j++) {
    for (let k = 0; k < K; k++) {
      let best = INF;
      let bi = -1;
      for (let i = 0; i < k; i++) {
        if (C[k].pos - C[i].pos <= usable && dp[j - 1][i] < best) {
          best = dp[j - 1][i];
          bi = i;
        }
      }
      if (best < INF) {
        dp[j][k] = best + C[k].area;
        prev[j][k] = bi;
      }
    }
  }

  // Final cut must reach hi within usable.
  let bestK = -1;
  let bestTotal = INF;
  for (let k = 0; k < K; k++) {
    if (dp[n][k] < INF && hi - C[k].pos <= usable && dp[n][k] < bestTotal) {
      bestTotal = dp[n][k];
      bestK = k;
    }
  }
  if (bestK === -1) return equalSpacing(lo, hi, n); // discrete grid left no feasible set

  const offsets = [];
  let j = n;
  let k = bestK;
  while (k !== -1 && j >= 1) {
    offsets.push(C[k].pos);
    k = prev[j][k];
    j--;
  }
  return offsets.reverse();
}
