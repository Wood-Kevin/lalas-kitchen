import { Board, Piece } from '../engine/matrix';
import { Position } from '../engine/gameState';

export interface ClearedPiece {
  piece: Piece;
  from: Position;
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
