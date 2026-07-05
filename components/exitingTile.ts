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
  // ordinary match cell.
  sweepDelayMs?: number;
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
  sweepDelayMs: number | undefined
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
