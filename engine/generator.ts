import { Board, Position, checkMatches, checkSquares, hasLegalMoves, shuffle } from './matrix';

export interface GeneratorConfig {
  rows: number;
  cols: number;
  pieceTypeIds: string[];
  // Optional board-shape holes — the cells that make a level non-rectangular
  // (a plus, a ring, an irregular outline). Each listed position becomes a
  // fixed 'void' piece: never filled with content, never matched, never moved
  // (see matrix.ts's Piece doc). Omitted/empty means a plain full rectangle,
  // identical to every board generated before board-shape support. Positions
  // outside the rows×cols bounds are ignored.
  voidCells?: Position[];
  // Optional blocker placement. Omitted or 0 means no blockers — identical
  // output to every board this generator produced before blockers existed
  // (no extra rng calls happen in that case, so existing seeded-determinism
  // tests are unaffected). The generator has no opinion on what a blocker
  // "is" (its id or hit count) — that's skin data flowing in from the
  // caller, same as pieceTypeIds; blockerMatchType is required whenever
  // blockerCount is truthy.
  blockerCount?: number;
  blockerMatchType?: string;
  blockerHitsToClear?: number;
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
//
// It also eliminates accidental 2x2 SQUARES (checkSquares): the fill loop's
// forbiddenTypesAt only blocks 3-in-a-line, so a random fill routinely leaves a
// bare 2x2 of one type — which is now a real match shape that would auto-spawn
// an area bomb on the player's first move (see gameState.ts's checkSquares
// integration). Breaking one corner of each square to a different type removes
// it; the outer loop re-validates against both scans until the board is clean.
function repairAccidentalMatches(board: Board, pieceTypeIds: string[], rng: () => number): void {
  const maxPasses = board.length * (board[0]?.length ?? 1) * pieceTypeIds.length + 20;

  const recolor = (pos: Position, avoidType: string | undefined): void => {
    const alternatives = pieceTypeIds.filter((t) => t !== avoidType);
    const candidates = alternatives.length > 0 ? fisherYates(alternatives, rng) : pieceTypeIds;
    const cell = board[pos.row][pos.col];
    board[pos.row][pos.col] = { ...cell, matchType: candidates[0] };
  };

  for (let pass = 0; pass < maxPasses; pass++) {
    const matches = checkMatches(board);
    const squares = checkSquares(board);
    if (matches.length === 0 && squares.length === 0) return;

    for (const match of matches) {
      const mid = match.positions[Math.floor(match.positions.length / 2)];
      recolor(mid, match.matchType);
    }
    // After line matches, break each square by recoloring its top-left corner.
    // A corner that a line-match recolor already changed this pass may no longer
    // be part of a square, but recoloring it again is harmless — the next pass's
    // checkSquares is the ground truth that decides when we're done.
    for (const square of squares) {
      recolor(square.positions[0], square.matchType);
    }
  }

  throw new Error(
    `generateLevel: could not eliminate accidental matches within ${maxPasses} repair passes — ` +
      'pieceTypeIds needs at least 2 distinct values for a board this size.'
  );
}

// Placed after the board is already fully filled and match-free. Converting
// an existing cell to a blocker can only ever remove a matchType from play
// at that position, never introduce a new run — a blocker is excluded from
// matching outright (see matrix.ts's piecesMatch) — so this step never needs
// to re-run repairAccidentalMatches. Positions are chosen via a fisherYates
// shuffle of every board cell rather than picking `blockerCount` independent
// random cells, so there's no risk of the same cell being chosen twice.
function placeBlockers(
  board: Board,
  blockerCount: number,
  blockerMatchType: string | undefined,
  blockerHitsToClear: number | undefined,
  rng: () => number
): void {
  if (blockerMatchType === undefined) {
    throw new Error('generateLevel: blockerCount > 0 requires blockerMatchType.');
  }

  const rows = board.length;
  const cols = board[0]?.length ?? 0;
  const hitsToClear = blockerHitsToClear ?? 1;

  const allPositions: Position[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // A void is a hole in the board shape, not a placeable cell — a blocker
      // must never land on one (it would resurrect a cell the level meant to
      // remove), so voids are excluded from the candidate pool.
      if (board[r][c].type === 'void') continue;
      allPositions.push({ row: r, col: c });
    }
  }

  const chosen = fisherYates(allPositions, rng).slice(0, Math.min(blockerCount, allPositions.length));
  for (const pos of chosen) {
    board[pos.row][pos.col] = {
      id: `blocker-${pos.row}-${pos.col}`,
      type: 'blocker',
      matchType: blockerMatchType,
      hitsRemaining: hitsToClear,
    };
  }
}

export function generateLevel(seed: number, config: GeneratorConfig): Board {
  const { rows, cols, pieceTypeIds, blockerCount, blockerMatchType, blockerHitsToClear, voidCells } = config;

  if (pieceTypeIds.length < 2) {
    throw new Error('generateLevel: pieceTypeIds must contain at least 2 distinct types.');
  }

  const rng = mulberry32(seed);
  const board: Board = Array.from({ length: rows }, () => new Array(cols));

  const voidSet = new Set<string>();
  for (const pos of voidCells ?? []) {
    if (pos.row >= 0 && pos.row < rows && pos.col >= 0 && pos.col < cols) {
      voidSet.add(`${pos.row},${pos.col}`);
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Void cells are carved first and skipped by the fill: they hold a fixed
      // 'void' piece, not content. forbiddenTypesAt reads neighbours, but a
      // void carries no matchType so its `matchType !== undefined` guard means
      // a void neighbour never contributes a forbidden type — the run-avoidance
      // heuristic simply doesn't see it, which is correct (a void breaks runs).
      if (voidSet.has(`${r},${c}`)) {
        board[r][c] = { id: `void-${r}-${c}`, type: 'void' };
        continue;
      }
      const forbidden = forbiddenTypesAt(board, r, c);
      const allowed = pieceTypeIds.filter((t) => !forbidden.has(t));
      const pool = allowed.length > 0 ? allowed : pieceTypeIds;
      const chosen = pool[Math.floor(rng() * pool.length)];
      board[r][c] = { id: `${r}-${c}`, type: 'normal', matchType: chosen };
    }
  }

  repairAccidentalMatches(board, pieceTypeIds, rng);

  if (blockerCount) {
    placeBlockers(board, blockerCount, blockerMatchType, blockerHitsToClear, rng);
  }

  if (!hasLegalMoves(board)) {
    return shuffle(board, rng);
  }

  return board;
}
