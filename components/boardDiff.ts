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

// Where each of a pass's spawned pieces should ENTER from — the presentation
// half of SPEC.md's spawn-streaming decision (game-feel overhaul, 2026-08-08).
//
// A spawn whose column segment touches the board's top edge streams in from
// ABOVE the edge, fully opaque, clipped by the board frame: the Nth-from-top
// spawn in that column starts N rows above its landing cell's segment, so a
// multi-spawn refill enters as one contiguous falling stack (every piece in
// the stack travels the same distance — the column's spawn count — which is
// what makes them fall together as a column rather than converging from
// scattered offsets). This replaces the old fixed `r - 2` entry + opacity
// fade, which materialized pieces mid-board out of thin air.
//
// A spawn refilling an ENCLOSED segment (one whose top row is not row 0 —
// e.g. the plus shape's interior pocket, which segmented gravity refills from
// its own local top) has no edge to stream from, and entering "above the
// segment" would visibly cross a void. That one case fades in at its landing
// cell instead (SPEC.md's resolved void-segment fork): rare by construction,
// disclosed in DEFERRED_COMPLEXITY.md.
export interface SpawnEntryPlan {
  // pieceId -> the row this spawn enters at (always negative: above the
  // board's top edge). Only edge-streamed spawns appear here.
  entryRowById: Map<string, number>;
  // Spawns landing in an enclosed segment: no travel, brief fade in place.
  fadeInPlaceIds: Set<string>;
}

export function planSpawnEntries(spawned: SpawnedPiece[], board: Board): SpawnEntryPlan {
  const entryRowById = new Map<string, number>();
  const fadeInPlaceIds = new Set<string>();

  // Group this pass's spawns by column, so each column's stack height (its
  // own spawn count) is known before any entry row is assigned.
  const byColumn = new Map<number, SpawnedPiece[]>();
  for (const spawn of spawned) {
    const list = byColumn.get(spawn.to.col) ?? [];
    list.push(spawn);
    byColumn.set(spawn.to.col, list);
  }

  for (const [col, columnSpawns] of byColumn) {
    // A column can hold spawns for more than one segment only on a shaped
    // board; split by each spawn's own segment top so an edge segment still
    // streams even when an enclosed pocket in the same column fades.
    const edgeSpawns: SpawnedPiece[] = [];
    for (const spawn of columnSpawns) {
      let segmentTop = spawn.to.row;
      while (segmentTop > 0 && board[segmentTop - 1][col].type !== 'void') {
        segmentTop -= 1;
      }
      if (segmentTop === 0) edgeSpawns.push(spawn);
      else fadeInPlaceIds.add(spawn.piece.id);
    }
    // Every edge spawn in a column falls the same distance — the stack's
    // height — so entryRow = landing row − stack size keeps the stack
    // contiguous and its internal order intact.
    for (const spawn of edgeSpawns) {
      entryRowById.set(spawn.piece.id, spawn.to.row - edgeSpawns.length);
    }
  }

  return { entryRowById, fadeInPlaceIds };
}

// The longest grid motion in one pass, in cells — the fall-side input to
// cascadeTiming.ts's passDurationMs. Chebyshev distance per moved piece (a
// gravity fall is pure-vertical, but a shuffle relocation can travel both
// axes), and each edge-streamed spawn contributes its real travel (landing
// row − entry row, i.e. its column's stack height); a fade-in-place spawn
// contributes nothing, having no travel.
export function maxMotionCells(moved: MovedPiece[], spawnPlan: SpawnEntryPlan, spawned: SpawnedPiece[]): number {
  let max = 0;
  for (const m of moved) {
    const cells = Math.max(Math.abs(m.to.row - m.from.row), Math.abs(m.to.col - m.from.col));
    if (cells > max) max = cells;
  }
  for (const s of spawned) {
    const entryRow = spawnPlan.entryRowById.get(s.piece.id);
    if (entryRow === undefined) continue;
    const cells = s.to.row - entryRow;
    if (cells > max) max = cells;
  }
  return max;
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
