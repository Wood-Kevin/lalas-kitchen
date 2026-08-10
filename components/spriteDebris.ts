// Pure geometry/pool-building for the sprite-crop debris particle burst —
// tiny crops of the clearing piece's own sprite that fly outward on a
// drag+gravity trajectory (Tile.tsx's SpriteCropDebrisParticle), replacing
// the old flat-colored spark burst now that per-mechanism color washes are
// gone entirely (see engine/DECISIONS.md's colors-removed rework entry,
// decision #2: "tiny crops of the piece's own sprite," extending
// BlockerShatterFragment's crop-and-fly technique to a finer, more numerous
// grid). Kept in its own module, alongside Tile.tsx's existing
// sweepAnimation.ts-style convention, so this is unit-testable without a
// component-render harness (there isn't one in this repo).

export interface DebrisParticleSpec {
  // Which crop cell of the sprite this shard shows — fractional (0..1)
  // origin within the tile, same coordinate contract Tile.tsx's
  // SpriteCropWindow already takes for the blocker shatter's coarser 2×2
  // grid, just at a finer subdivision here.
  originXFrac: number;
  originYFrac: number;
  // Launch jitter, same shape the old EXPERIMENTAL_BURST_POOL used — an
  // angle offset and a per-particle speed multiplier, so a burst looks
  // organic rather than a perfect uniform starburst.
  angleRad: number;
  speedMultiplier: number;
}

// Builds a full gridSize×gridSize set of crop-cell origins, shuffles it
// (Fisher-Yates — Math.random is fine here, plain JS at call scope, never
// inside a worklet, the same "computed once, not per-frame" convention the
// old EXPERIMENTAL_BURST_POOL comment already established), then takes the
// first maxCount — so a clear's debris samples a genuinely scattered subset
// of the sprite's own crop cells rather than always the same top-left
// corner. Never returns more entries than the grid actually has (a maxCount
// larger than gridSize² would mean re-showing the same crop cell twice,
// which reads as a duplicate shard rather than more debris).
export function buildDebrisParticlePool(gridSize: number, maxCount: number): DebrisParticleSpec[] {
  const cells: { originXFrac: number; originYFrac: number }[] = [];
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      cells.push({ originXFrac: gx / gridSize, originYFrac: gy / gridSize });
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const count = Math.min(maxCount, cells.length);
  return cells.slice(0, count).map((cell, i) => ({
    ...cell,
    angleRad: (i / count) * 2 * Math.PI + (Math.random() - 0.5) * 0.4,
    speedMultiplier: 0.75 + Math.random() * 0.5,
  }));
}

// How many debris particles a clear throws, scaled by how rewarding it
// feels (0..1, see cascadeTiming.ts's passRewardIntensity) — a plain 3-match
// gets `baseCount`, a big cascade pass gets visibly more, up to
// `baseCount + maxExtra`. Extracted from what used to be an inline
// expression in ExitingTile (EXPERIMENTAL_BURST_BASE_PARTICLE_COUNT +
// Math.round(rewardIntensity * EXPERIMENTAL_BURST_MAX_EXTRA_PARTICLES)),
// now genuinely reusable logic rather than a one-off.
export function debrisParticleCount(rewardIntensity: number, baseCount: number, maxExtra: number): number {
  return baseCount + Math.round(rewardIntensity * maxExtra);
}
