import { Board, checkMatches, hasLegalMoves, shuffle } from './matrix';

export interface GeneratorConfig {
  rows: number;
  cols: number;
  pieceTypeIds: string[];
}

// mulberry32: a small, dependency-free seeded PRNG. See DECISIONS.md for why
// this one was picked over alternatives.
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fisherYates<T>(items: T[], rng: () => number): T[] {
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function forbiddenTypesAt(board: Board, row: number, col: number): Set<string> {
  const forbidden = new Set<string>();

  if (col >= 2) {
    const left1 = board[row][col - 1];
    const left2 = board[row][col - 2];
    if (left1.matchType !== undefined && left1.matchType === left2.matchType) {
      forbidden.add(left1.matchType);
    }
  }

  if (row >= 2) {
    const up1 = board[row - 1][col];
    const up2 = board[row - 2][col];
    if (up1.matchType !== undefined && up1.matchType === up2.matchType) {
      forbidden.add(up1.matchType);
    }
  }

  return forbidden;
}

// The left/above check below prevents the common case, but with only two
// piece types a cell can be boxed in by a horizontal constraint and a
// vertical constraint that together forbid every available type — see
// DECISIONS.md. This pass is the fallback that guarantees zero accidental
// matches even then, using full checkMatches (ground truth) rather than the
// 2-cell local heuristic, so it can always find a fix as long as
// pieceTypeIds has at least 2 distinct values.
function repairAccidentalMatches(board: Board, pieceTypeIds: string[], rng: () => number): void {
  const maxPasses = board.length * (board[0]?.length ?? 1) * pieceTypeIds.length + 20;

  for (let pass = 0; pass < maxPasses; pass++) {
    const matches = checkMatches(board);
    if (matches.length === 0) return;

    for (const match of matches) {
      const mid = match.positions[Math.floor(match.positions.length / 2)];
      const alternatives = pieceTypeIds.filter((t) => t !== match.matchType);
      const candidates = alternatives.length > 0 ? fisherYates(alternatives, rng) : pieceTypeIds;
      const cell = board[mid.row][mid.col];
      board[mid.row][mid.col] = { ...cell, matchType: candidates[0] };
    }
  }

  throw new Error(
    `generateLevel: could not eliminate accidental matches within ${maxPasses} repair passes — ` +
      'pieceTypeIds needs at least 2 distinct values for a board this size.'
  );
}

export function generateLevel(seed: number, config: GeneratorConfig): Board {
  const { rows, cols, pieceTypeIds } = config;

  if (pieceTypeIds.length < 2) {
    throw new Error('generateLevel: pieceTypeIds must contain at least 2 distinct types.');
  }

  const rng = mulberry32(seed);
  const board: Board = Array.from({ length: rows }, () => new Array(cols));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const forbidden = forbiddenTypesAt(board, r, c);
      const allowed = pieceTypeIds.filter((t) => !forbidden.has(t));
      const pool = allowed.length > 0 ? allowed : pieceTypeIds;
      const chosen = pool[Math.floor(rng() * pool.length)];
      board[r][c] = { id: `${r}-${c}`, type: 'normal', matchType: chosen };
    }
  }

  repairAccidentalMatches(board, pieceTypeIds, rng);

  if (!hasLegalMoves(board)) {
    return shuffle(board, rng);
  }

  return board;
}
