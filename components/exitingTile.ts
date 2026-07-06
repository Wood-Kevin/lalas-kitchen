import { Piece } from '../engine/matrix';
import { Position } from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { getSpriteForPiece } from './spriteMap';

// One exiting/clearing tile — a piece from diffBoards' `cleared` list that
// Board.tsx animates out of the grid (see Tile.tsx's ExitingTile). Kept in its
// own module, alongside the two functions that build and resolve it, so the
// real data flow the sprite fix depends on is unit-testable without mounting a
// React component (there's no component-render harness in this repo).
export interface ExitingEntry {
  key: string;
  pieceId: string;
  matchType: string | undefined;
  // The cleared piece's full engine type, carried so the exit animation
  // resolves its sprite the same way a live tile does — via getSpriteForPiece,
  // not matchType alone. A color bomb has no matchType, so a matchType-only
  // lookup rendered its detonation frame as the "?" placeholder; a striped
  // piece keeps its base matchType but a matchType-only lookup dropped its
  // stripe overlay. Both need the type to resolve correctly (see
  // exitingTileSprite below and DECISIONS.md's two-sprite-path rendering note).
  pieceType: Piece['type'];
  row: number;
  col: number;
  // From diff.cleared's own piece.type — a blocker cleared by adjacent
  // damage rather than a direct match gets its own highlight beat (see
  // Tile.tsx's ExitingTile). Reusing data diffBoards already computes, not
  // a new engine field.
  isBlockerClear: boolean;
  // Set only on a tile swept by a striped piece's line clear — how long it
  // waits before it brightens and pops, so the glow travels down the line
  // instead of the whole row/column flashing at once. Derived purely from the
  // pass's diff (see sweepAnimation.ts), no new engine data. Undefined for an
  // ordinary match cell. Also reused, with a UNIFORM value across every
  // converted piece, as the supercombo's synchronized beat-2 delay (see
  // specialEffectAnimation.ts's buildPassAnimation) — the same "pop after this
  // delay" contract, just fed a fixed value instead of a distance-based one.
  sweepDelayMs?: number;
  // Set only on a color bomb detonation's cleared tiles — how long this tile
  // waits before its radial ripple pop, staggered by real distance from the
  // swapped bomb so the wave visibly reaches across the whole board rather
  // than the board-spanning clear reading as one flat vanish (see
  // specialEffectAnimation.ts's radialDelaysForClears). Undefined for every
  // other clear, including a color bomb reached via chaining (not this
  // effect's own swap-triggered origin) — see DEFERRED_COMPLEXITY.md.
  radialDelayMs?: number;
  // Set only on the supercombo's own converted pieces (never the bomb cell
  // itself) — plays a brief "this just became a special" flicker BEFORE the
  // synchronized sweepDelayMs pop begins, so the two real beats (convert, then
  // sweep together) both read on screen instead of collapsing into one
  // instant (see specialEffectAnimation.ts's supercomboConvertedIds and
  // engine/DECISIONS.md's now-resolved convert-to-striped-flash entry).
  convertedFlash?: boolean;
}

// Builds one exiting-tile entry from a cleared piece. The crux for the sprite
// fix is that it threads the piece's full `type` through as `pieceType` (not
// just its matchType), so the exit animation can resolve the same sprite a live
// tile shows. `moveId` keys the entry uniquely across moves (a piece clears at
// most once per move); `sweepDelayMs` is the pass's per-tile sweep stagger, or
// undefined for an ordinary match cell.
export function buildExitingEntry(
  piece: Piece,
  from: Position,
  moveId: number,
  sweepDelayMs: number | undefined,
  radialDelayMs?: number,
  convertedFlash?: boolean
): ExitingEntry {
  return {
    key: `${piece.id}-${moveId}`,
    pieceId: piece.id,
    matchType: piece.matchType,
    pieceType: piece.type,
    row: from.row,
    col: from.col,
    isBlockerClear: piece.type === 'blocker',
    sweepDelayMs,
    radialDelayMs,
    convertedFlash,
  };
}

// Resolves the sprite for an exiting tile through getSpriteForPiece — the exact
// same lookup a live board tile uses — passing the piece's full type, not its
// matchType alone. This is the fix for the "a color bomb's icon turns into a ?
// as it detonates" bug: a bomb carries no matchType, so a matchType-only lookup
// resolved to undefined -> the "?" placeholder; a swept striped piece kept its
// base matchType but a matchType-only lookup dropped its stripe. See
// DECISIONS.md's two-sprite-path rendering note.
export function exitingTileSprite(entry: ExitingEntry, config: SkinConfig): string | undefined {
  return getSpriteForPiece({ type: entry.pieceType, matchType: entry.matchType }, config);
}
