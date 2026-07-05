import { ClearedPiece } from './boardDiff';

// Given the pieces that cleared in one cascade pass, work out which of them
// were swept by a striped piece and how long each should wait before it pops —
// so the row/column clear reads as a glow travelling outward from the striped
// piece rather than the whole line vanishing at once (see Tile.tsx's ExitingTile
// sweep branch and components/NOTES.md).
//
// This is deliberately a *presentation-layer derivation*, not new engine data:
// a matched striped piece survives into diffBoards' `cleared` list still
// carrying its `type: 'striped'` and `direction`, so its position is the beam's
// origin and every other cleared cell on that same row/column is a tile the
// beam passes through. Distance from the origin along the sweep axis (in tiles)
// times the per-tile stagger gives the delay. The engine stays untouched — it
// still just clears a set of cells; only the order we *animate* them changes.
export function sweepDelaysForClears(
  cleared: ClearedPiece[],
  perTileStaggerMs: number
): Map<string, number> {
  const delays = new Map<string, number>();

  // Every striped piece in this pass is a beam origin. Its `direction` is the
  // axis it sweeps ('row' = horizontal beam, 'col' = vertical beam); `from` is
  // where the beam starts.
  const origins = cleared
    .filter((c) => c.piece.type === 'striped' && c.piece.direction !== undefined)
    .map((c) => ({ direction: c.piece.direction as 'row' | 'col', from: c.from }));

  if (origins.length === 0) return delays;

  for (const { piece, from } of cleared) {
    // A blocker cleared alongside a sweep keeps its own highlight beat (see
    // ExitingTile's isBlockerClear branch) rather than joining the beam, so it
    // never gets a sweep delay even when it sits on the swept line.
    if (piece.type === 'blocker') continue;

    // A tile can lie on more than one beam this pass (two striped pieces
    // crossing); the nearest origin reaches it first, so take the smallest
    // distance. Cells that lie on no beam — e.g. the off-axis cells of the
    // match that triggered the striped piece — get no entry and clear on the
    // normal immediate schedule.
    let best: number | undefined;
    for (const o of origins) {
      let dist: number | undefined;
      if (o.direction === 'row' && from.row === o.from.row) {
        dist = Math.abs(from.col - o.from.col);
      } else if (o.direction === 'col' && from.col === o.from.col) {
        dist = Math.abs(from.row - o.from.row);
      }
      if (dist !== undefined && (best === undefined || dist < best)) best = dist;
    }

    if (best !== undefined) delays.set(piece.id, best * perTileStaggerMs);
  }

  return delays;
}
