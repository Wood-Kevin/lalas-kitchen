import { Board, Piece } from '../engine/matrix';
import { Position } from '../engine/gameState';

export interface ClearedPiece {
  piece: Piece;
  // Where this tile plays its exit — its resting cell. For a swapped-and-
  // cleared piece that's the cell the player moved it TO (see
  // relocateSwappedClears), which is also where its effect is anchored.
  from: Position;
  // Where this tile starts, when it has somewhere to travel from. Set only by
  // relocateSwappedClears, only for a swapped cell whose piece cleared on the
  // same move — the one case where a cleared piece genuinely moved before it
  // died and should be seen doing it. Undefined everywhere else: a piece that
  // clears where it stood has no travel, and Tile.tsx's ExitingTile renders it
  // exactly as it always did.
  travelFrom?: Position;
}

export interface MovedPiece {
  piece: Piece;
  from: Position;
  to: Position;
}

export interface SpawnedPiece {
  piece: Piece;
  to: Position;
}

export interface BoardDiff {
  cleared: ClearedPiece[];
  moved: MovedPiece[];
  spawned: SpawnedPiece[];
}

function positionsById(board: Board): Map<string, Position> {
  const map = new Map<string, Position>();
  board.forEach((row, r) => {
    row.forEach((piece, c) => {
      map.set(piece.id, { row: r, col: c });
    });
  });
  return map;
}

function piecesById(board: Board): Map<string, Piece> {
  const map = new Map<string, Piece>();
  board.forEach((row) => row.forEach((piece) => map.set(piece.id, piece)));
  return map;
}

// Compares two board snapshots by piece id (not by position) to figure out
// what changed between them. Board.tsx applies this once per cascade pass —
// diffing each of applyMove's returned `steps` against the previously shown
// board — to animate each pass as its own beat (see engine/DECISIONS.md's
// cascade-steps entry). A piece id present in `before` but missing from
// `after` was cleared; one present in `after` but not `before` was spawned;
// one present in both at different coordinates fell/slid there.
export function diffBoards(before: Board, after: Board): BoardDiff {
  const beforePositions = positionsById(before);
  const afterPositions = positionsById(after);
  const beforePieces = piecesById(before);
  const afterPieces = piecesById(after);

  const cleared: ClearedPiece[] = [];
  for (const [id, piece] of beforePieces) {
    if (!afterPositions.has(id)) {
      cleared.push({ piece, from: beforePositions.get(id) as Position });
    }
  }

  const spawned: SpawnedPiece[] = [];
  const moved: MovedPiece[] = [];
  for (const [id, piece] of afterPieces) {
    const from = beforePositions.get(id);
    const to = afterPositions.get(id) as Position;
    if (from === undefined) {
      spawned.push({ piece, to });
    } else if (from.row !== to.row || from.col !== to.col) {
      moved.push({ piece, from, to });
    }
  }

  return { cleared, moved, spawned };
}

function samePosition(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

// Corrects where a swapped-then-immediately-cleared tile plays its exit
// animation. The first cascade pass is diffed against the PRE-move board, so a
// cleared piece's `from` is the cell it occupied before the swap — but the
// engine may have exchanged the two cells before resolving (see
// ApplyMoveResult.swapCommitted), and the player's finger left the dragged tile
// at the OTHER cell. Without this the tile visibly snaps back to the cell it
// came from and then exits there, which reads as the effect firing in the wrong
// place — the presentation-layer half of the same swap-anchor bug the engine's
// anchor rule fixes (see engine/DECISIONS.md's swap-anchor entry).
//
// Only `cleared` is remapped, and only for the two swapped cells. `moved` and
// `spawned` must keep diffing against the pre-move board: a swapped piece that
// SURVIVES (the displaced ordinary piece of a non-matching swap, or a dropdown
// relocation) genuinely travelled from its old cell to its new one, and
// rewriting its origin would make it teleport instead of slide.
//
// A no-op when the engine didn't swap (the position-independent detonations) or
// when neither swapped cell cleared, so every other move is untouched.
export function relocateSwappedClears(
  cleared: ClearedPiece[],
  posA: Position,
  posB: Position,
  swapCommitted: boolean
): ClearedPiece[] {
  if (!swapCommitted) return cleared;
  return cleared.map((entry) => {
    // travelFrom keeps the pre-swap cell the diff reported, so the tile can
    // SLIDE from there to its resting cell instead of being remounted at the
    // destination — the difference between the swap being animated and the
    // tile jumping a full cell in one frame. Both ends come from here because
    // both are known here; nothing downstream has to re-derive either.
    if (samePosition(entry.from, posA)) return { ...entry, from: posB, travelFrom: posA };
    if (samePosition(entry.from, posB)) return { ...entry, from: posA, travelFrom: posB };
    return entry;
  });
}

// Which of the two tapped piece ids should render with the SWAP feel (a
// short, deliberately bouncy spring tuned for exactly one tile of travel) —
// as opposed to the FALL feel (firm, column-staggered, no assumption about
// distance).
//
// A single cascade pass is match-clear AND gravity-settle computed together
// (see engine/gameState.ts's resolveCascades), so a tapped piece that
// survives the match can legitimately travel more than one cell within that
// SAME pass — whenever the match it helped form also clears something above
// it in its own column, gravity drops it further before the pass ever
// reaches the presentation layer. Piece id alone (was this one of the two
// tapped cells?) can't distinguish "a plain adjacent swap" from "a swap that
// also triggered a multi-row fall for this exact piece" — only its actual
// displacement can.
//
// This still matters even though tile position no longer overshoots at all
// (see Tile.tsx's TILE_MOVE_DAMPING_RATIO): the swap and fall durations are
// still different (a swap answers a gesture instantly; a fall runs on the
// cascade's own beat), and only a fall gets the column stagger. Giving a
// piece that actually travelled three or four gravity-driven rows the swap's
// fast, unstaggered duration would still look wrong — unnaturally quick for
// the distance, and landing in lockstep with every other cell in the pass
// instead of travelling like the rest of the refill. An earlier version of
// this fix was also written to protect against a spring-overshoot distinction
// that no longer exists (position never overshoots now); the duration/stagger
// distinction it was layered on top of is real on its own — this is the
// code-level mechanism, verified directly against resolveCascades rather than
// inferred from a trace.
//
// `moved` is the same-pass diff's own moved list (diffBoards' output against
// the pre-move board), so no new data is computed — only interpreted
// differently than piece identity alone would.
export function resolveSwapMotionIds(tappedIds: Set<string>, moved: MovedPiece[]): Set<string> {
  return new Set(
    [...tappedIds].filter((id) => {
      const entry = moved.find((m) => m.piece.id === id);
      // Not in `moved` means either this tapped piece cleared (irrelevant —
      // cleared pieces render via ExitingTile, never read this set) or it
      // never moved at all (impossible for a genuinely committed swap, but
      // defaulting to the swap feel here is the safe, previous behaviour).
      if (!entry) return true;
      return Math.abs(entry.to.row - entry.from.row) + Math.abs(entry.to.col - entry.from.col) <= 1;
    })
  );
}
