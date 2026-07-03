export type PieceType = 'normal' | 'row_clearer' | 'blocker';

export interface Piece {
  id: string;
  type: PieceType;
  matchType?: string;
}

export type Board = Piece[][];

export interface Position {
  row: number;
  col: number;
}

export interface Match {
  matchType: string | undefined;
  positions: Position[];
}

// Two pieces only match if both carry a matchType and it's equal. A piece
// with no matchType (e.g. a future blocker) can never form a run.
function piecesMatch(a: Piece, b: Piece): boolean {
  return a.matchType !== undefined && a.matchType === b.matchType;
}

function runsInLine(line: Piece[]): Array<{ start: number; length: number }> {
  const runs: Array<{ start: number; length: number }> = [];
  let runStart = 0;
  for (let i = 1; i <= line.length; i++) {
    const continuesRun = i < line.length && piecesMatch(line[i], line[i - 1]);
    if (!continuesRun) {
      const length = i - runStart;
      if (length >= 3) {
        runs.push({ start: runStart, length });
      }
      runStart = i;
    }
  }
  return runs;
}

export function checkMatches(board: Board): Match[] {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const matches: Match[] = [];

  for (let r = 0; r < rows; r++) {
    const row = board[r];
    for (const run of runsInLine(row)) {
      matches.push({
        matchType: row[run.start].matchType,
        positions: Array.from({ length: run.length }, (_, i) => ({ row: r, col: run.start + i })),
      });
    }
  }

  for (let c = 0; c < cols; c++) {
    const column = board.map((row) => row[c]);
    for (const run of runsInLine(column)) {
      matches.push({
        matchType: column[run.start].matchType,
        positions: Array.from({ length: run.length }, (_, i) => ({ row: run.start + i, col: c })),
      });
    }
  }

  return matches;
}

export function swapPieces(board: Board, posA: Position, posB: Position): Board {
  const newBoard = board.map((row) => row.slice());
  const temp = newBoard[posA.row][posA.col];
  newBoard[posA.row][posA.col] = newBoard[posB.row][posB.col];
  newBoard[posB.row][posB.col] = temp;
  return newBoard;
}

// Board carries nulls for cells already cleared by the caller (gameState's
// applyMove nulls out checkMatches positions before calling this). New
// pieces come from an injected spawnPiece callback rather than Math.random
// directly, so matrix.ts stays free of any RNG dependency — Phase 2's
// seeded generator supplies a deterministic spawnPiece when it lands.
export function calculateCascades(
  board: Array<Array<Piece | null>>,
  spawnPiece: () => Piece
): Board {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const result: Board = Array.from({ length: rows }, () => new Array(cols));

  for (let c = 0; c < cols; c++) {
    const surviving: Piece[] = [];
    for (let r = 0; r < rows; r++) {
      const cell = board[r][c];
      if (cell !== null) surviving.push(cell);
    }

    const missing = rows - surviving.length;
    const spawned: Piece[] = [];
    for (let i = 0; i < missing; i++) spawned.push(spawnPiece());

    const fullColumn = [...spawned, ...surviving];
    for (let r = 0; r < rows; r++) {
      result[r][c] = fullColumn[r];
    }
  }

  return result;
}

function fisherYates<T>(items: T[], rng: () => number): T[] {
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// rng is injected (defaulting to Math.random) so tests can pass a fixed
// sequence and get a deterministic result. Bounded retry avoids handing back
// a board that's already matched or that still has zero legal moves — the
// whole point of shuffling — while guaranteeing termination.
export function shuffle(board: Board, rng: () => number = Math.random): Board {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const flatPieces = board.flat();
  const maxAttempts = 100;

  let candidate: Board = board;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shuffledPieces = fisherYates(flatPieces, rng);
    candidate = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => shuffledPieces[r * cols + c])
    );
    if (checkMatches(candidate).length === 0 && hasLegalMoves(candidate)) {
      return candidate;
    }
  }
  return candidate;
}

export function hasLegalMoves(board: Board): boolean {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) {
        const swapped = swapPieces(board, { row: r, col: c }, { row: r, col: c + 1 });
        if (checkMatches(swapped).length > 0) return true;
      }
      if (r + 1 < rows) {
        const swapped = swapPieces(board, { row: r, col: c }, { row: r + 1, col: c });
        if (checkMatches(swapped).length > 0) return true;
      }
    }
  }

  return false;
}
