import { ClearedPiece } from './boardDiff';
import { StripeDirection } from '../engine/matrix';
import { Position } from '../engine/gameState';

// One cleared tile's sweep timing AND shape: how long it waits before it
// pops (delayMs, unchanged from this module's original contract) plus which
// axis the beam that caught it actually travelled along (axis) — the
// geometry Tile.tsx's ExitingTile needs to stretch a swept tile along the
// beam's real direction instead of a generic uniform pop (see
// engine/DECISIONS.md's colors-removed rework entry: motion/shape now
// carries effect identity where a color wash used to). `axis` is optional
// only for callers that stage a UNIFORM delay with no real travel direction
// of its own (see specialEffectAnimation.ts's supercombo branch).
export interface SweepDelay {
  delayMs: number;
  axis?: StripeDirection;
}

interface SweepOrigin {
  direction: StripeDirection;
  from: Position;
}

// The shared "which beam reaches this tile first, and along which axis"
// scan — factored out so sweepDelaysForClears and any other caller (see
// specialEffectAnimation.ts's crossOriginDelays) can never disagree about
// which origin wins a tile that lies on more than one beam. Returns the
// winning origin's direction alongside the distance, since the distance
// alone (the original contract) can't tell a caller which way to stretch.
export function nearestSweepOrigin(
  from: Position,
  origins: SweepOrigin[]
): { distance: number; axis: StripeDirection } | undefined {
  let best: { distance: number; axis: StripeDirection } | undefined;
  for (const o of origins) {
    let dist: number | undefined;
    if (o.direction === 'row' && from.row === o.from.row) {
      dist = Math.abs(from.col - o.from.col);
    } else if (o.direction === 'col' && from.col === o.from.col) {
      dist = Math.abs(from.row - o.from.row);
    }
    if (dist !== undefined && (best === undefined || dist < best.distance)) {
      best = { distance: dist, axis: o.direction };
    }
  }
  return best;
}

// Given the pieces that cleared in one cascade pass, work out which of them
// were swept by a striped piece and how long each should wait before it pops —
// so the row/column clear reads as a pop travelling outward from the striped
// piece rather than the whole line vanishing at once (see Tile.tsx's ExitingTile
// sweep branch and components/NOTES.md).
//
// This is deliberately a *presentation-layer derivation*, not new engine data:
// a matched striped piece survives into diffBoards' `cleared` list still
// carrying its `type: 'striped'` and `direction`, so its position is the beam's
// origin and every other cleared cell on that same row/column is a tile the
// beam passes through. Distance from the origin along the sweep axis (in tiles)
// times the per-tile stagger gives the delay. The engine stays untouched — it
// still just clears a set of cells; only the order (and now shape) we *animate*
// them with changes.
export function sweepDelaysForClears(
  cleared: ClearedPiece[],
  perTileStaggerMs: number
): Map<string, SweepDelay> {
  const delays = new Map<string, SweepDelay>();

  // Every striped piece in this pass is a beam origin. Its `direction` is the
  // axis it sweeps ('row' = horizontal beam, 'col' = vertical beam); `from` is
  // where the beam starts.
  const origins: SweepOrigin[] = cleared
    .filter((c) => c.piece.type === 'striped' && c.piece.direction !== undefined)
    .map((c) => ({ direction: c.piece.direction as StripeDirection, from: c.from }));

  if (origins.length === 0) return delays;

  for (const { piece, from } of cleared) {
    // A blocker cleared alongside a sweep keeps its own highlight beat (see
    // ExitingTile's isBlockerClear branch) rather than joining the beam, so it
    // never gets a sweep delay even when it sits on the swept line.
    if (piece.type === 'blocker') continue;

    // A tile can lie on more than one beam this pass (two striped pieces
    // crossing); the nearest origin reaches it first — see nearestSweepOrigin
    // above. Cells that lie on no beam — e.g. the off-axis cells of the
    // match that triggered the striped piece — get no entry and clear on the
    // normal immediate schedule.
    const nearest = nearestSweepOrigin(from, origins);
    if (nearest !== undefined) {
      delays.set(piece.id, { delayMs: nearest.distance * perTileStaggerMs, axis: nearest.axis });
    }
  }

  return delays;
}
