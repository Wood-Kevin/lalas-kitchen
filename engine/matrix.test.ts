import {
  checkMatches,
  checkSquares,
  swapPieces,
  calculateCascades,
  shuffle,
  hasLegalMoves,
  applyAdjacentDamage,
  Board,
  Piece,
} from './matrix';

function piece(matchType: string, id: string): Piece {
  return { id, type: 'normal', matchType };
}

function blockerPiece(matchType: string, id: string, hitsRemaining: number): Piece {
  return { id, type: 'blocker', matchType, hitsRemaining };
}

function colorBombPiece(id: string): Piece {
  return { id, type: 'color_bomb' };
}

function buildBoard(letters: string[][]): Board {
  return letters.map((row, r) => row.map((matchType, c) => piece(matchType, `${r}-${c}`)));
}

// Deterministic LCG so shuffle's rng-dependent behavior is reproducible across runs.
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function sortPositions(match: { positions: { row: number; col: number }[] }) {
  return [...match.positions].sort((a, b) => a.row - b.row || a.col - b.col);
}

describe('checkMatches', () => {
  test('board with zero matches returns no matches', () => {
    const board = buildBoard([
      ['A', 'B', 'A', 'B'],
      ['B', 'A', 'B', 'A'],
      ['A', 'B', 'A', 'B'],
      ['B', 'A', 'B', 'A'],
    ]);

    expect(checkMatches(board)).toEqual([]);
  });

  test('board with one obvious three-in-a-row is detected', () => {
    const board = buildBoard([
      ['A', 'A', 'A'],
      ['B', 'C', 'B'],
      ['C', 'B', 'C'],
    ]);

    const matches = checkMatches(board);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchType).toBe('A');
    expect(sortPositions(matches[0])).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
    ]);
  });

  test('detects a vertical run', () => {
    const board = buildBoard([
      ['X', 'P', 'Q'],
      ['A', 'Q', 'P'],
      ['A', 'P', 'Q'],
      ['A', 'Q', 'P'],
      ['Y', 'P', 'Q'],
    ]);

    const matches = checkMatches(board);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchType).toBe('A');
    expect(sortPositions(matches[0])).toEqual([
      { row: 1, col: 0 },
      { row: 2, col: 0 },
      { row: 3, col: 0 },
    ]);
  });

  test('distinguishes a 4-match from a 3-match by run length, and reports orientation', () => {
    // A striped piece is spawned off a run of exactly 4 (see gameState.ts),
    // and its clear direction comes from the run's axis — so checkMatches has
    // to carry both the length (via positions) and the orientation.
    const horizontal = buildBoard([
      ['A', 'A', 'A', 'A'],
      ['B', 'C', 'B', 'C'],
      ['C', 'B', 'C', 'B'],
    ]);
    const hMatches = checkMatches(horizontal);
    expect(hMatches).toHaveLength(1);
    expect(hMatches[0].positions).toHaveLength(4);
    expect(hMatches[0].orientation).toBe('row');

    const vertical = buildBoard([
      ['A', 'P', 'Q'],
      ['A', 'Q', 'P'],
      ['A', 'P', 'Q'],
      ['B', 'Q', 'P'],
    ]);
    const vMatches = checkMatches(vertical);
    expect(vMatches).toHaveLength(1);
    expect(vMatches[0].positions).toHaveLength(3);
    expect(vMatches[0].orientation).toBe('col');
  });
});

describe('swapPieces', () => {
  test('returns a new board with two adjacent tiles swapped, without mutating the input', () => {
    const board = buildBoard([
      ['A', 'A', 'B'],
      ['B', 'C', 'A'],
    ]);
    const original = JSON.parse(JSON.stringify(board));

    const result = swapPieces(board, { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(board).toEqual(original);
    expect(result[0][2].matchType).toBe('A');
    expect(result[1][2].matchType).toBe('B');
    expect(result[0][0].matchType).toBe('A');
    expect(result[0][1].matchType).toBe('A');
  });
});

describe('calculateCascades', () => {
  test('drops surviving pieces down and spawns new pieces at the top to fill gaps', () => {
    const survivorX = piece('X', 'survivor-x');
    const survivorY = piece('Y', 'survivor-y');
    const board: Array<Array<Piece | null>> = [[null], [survivorX], [null], [survivorY]];

    const spawnQueue = [piece('S1', 'spawn-1'), piece('S2', 'spawn-2')];
    const spawnPiece = () => {
      const next = spawnQueue.shift();
      if (!next) throw new Error('spawnPiece called more times than expected');
      return next;
    };

    const result = calculateCascades(board, spawnPiece);

    expect(result[0][0].id).toBe('spawn-1');
    expect(result[1][0].id).toBe('spawn-2');
    expect(result[2][0].id).toBe('survivor-x');
    expect(result[3][0].id).toBe('survivor-y');
  });
});

describe('checkMatches + calculateCascades cascade chain', () => {
  test('a cleared match can expose a second match that clears on the next pass', () => {
    // Columns 0 and 2 are filler that never matches, so all match activity is isolated to column 1.
    const initialBoard = buildBoard([
      ['P', 'X', 'Q'],
      ['Q', 'A', 'P'],
      ['P', 'A', 'Q'],
      ['Q', 'A', 'P'],
      ['P', 'Y', 'Q'],
    ]);

    const firstPassMatches = checkMatches(initialBoard);
    expect(firstPassMatches).toHaveLength(1);
    expect(firstPassMatches[0].matchType).toBe('A');

    const clearedAfterFirstMatch: Array<Array<Piece | null>> = initialBoard.map((row) =>
      row.slice()
    );
    for (const pos of firstPassMatches[0].positions) {
      clearedAfterFirstMatch[pos.row][pos.col] = null;
    }

    const spawnQueueOne = [piece('B', 'spawn-b1'), piece('B', 'spawn-b2'), piece('B', 'spawn-b3')];
    const boardAfterFirstCascade = calculateCascades(clearedAfterFirstMatch, () => {
      const next = spawnQueueOne.shift();
      if (!next) throw new Error('spawnPiece called more times than expected');
      return next;
    });

    const secondPassMatches = checkMatches(boardAfterFirstCascade);
    expect(secondPassMatches).toHaveLength(1);
    expect(secondPassMatches[0].matchType).toBe('B');

    const clearedAfterSecondMatch: Array<Array<Piece | null>> = boardAfterFirstCascade.map((row) =>
      row.slice()
    );
    for (const pos of secondPassMatches[0].positions) {
      clearedAfterSecondMatch[pos.row][pos.col] = null;
    }

    const spawnQueueTwo = [piece('C', 'spawn-c1'), piece('D', 'spawn-c2'), piece('E', 'spawn-c3')];
    const boardAfterSecondCascade = calculateCascades(clearedAfterSecondMatch, () => {
      const next = spawnQueueTwo.shift();
      if (!next) throw new Error('spawnPiece called more times than expected');
      return next;
    });

    expect(checkMatches(boardAfterSecondCascade)).toEqual([]);
  });
});

describe('hasLegalMoves', () => {
  test('returns true when an adjacent swap would create a match', () => {
    const board = buildBoard([
      ['A', 'A', 'B'],
      ['B', 'C', 'A'],
    ]);

    expect(hasLegalMoves(board)).toBe(true);
  });

  test('returns false when the board is too small for any run of 3 to ever exist', () => {
    const board = buildBoard([
      ['A', 'B'],
      ['B', 'A'],
    ]);

    expect(hasLegalMoves(board)).toBe(false);
  });
});

describe('shuffle', () => {
  test('rearranges pieces into a board with no immediate matches and at least one legal move, preserving piece counts', () => {
    const board = buildBoard([
      ['A', 'B', 'C'],
      ['C', 'A', 'B'],
      ['B', 'C', 'A'],
    ]);

    expect(hasLegalMoves(board)).toBe(false);

    const rng = seededRng(42);
    const result = shuffle(board, rng);

    const originalIds = board.flat().map((p) => p.id).sort();
    const resultIds = result.flat().map((p) => p.id).sort();
    expect(resultIds).toEqual(originalIds);

    const originalCounts = board
      .flat()
      .map((p) => p.matchType)
      .sort();
    const resultCounts = result
      .flat()
      .map((p) => p.matchType)
      .sort();
    expect(resultCounts).toEqual(originalCounts);

    expect(checkMatches(result)).toEqual([]);
    expect(hasLegalMoves(result)).toBe(true);
  });
});

describe('blockers — checkMatches skips them entirely', () => {
  test('a blocker sitting between two equal-matchType runs breaks the run instead of joining it', () => {
    // If the blocker weren't excluded, this would read as a 4-in-a-row of
    // 'A'. Since it is, each side is only length 2 — no match at all.
    const board: Board = [
      [piece('A', 'a0'), piece('A', 'a1'), blockerPiece('A', 'blk', 1), piece('A', 'a2')],
    ];

    expect(checkMatches(board)).toEqual([]);
  });
});

describe('blockers — hasLegalMoves excludes them as swap candidates', () => {
  test('a board whose only "matching" swap requires moving a blocker reports no legal moves', () => {
    // col 1 is A / BLK / A. If the blocker could be swapped out of (1,1)
    // with either of its horizontal neighbors (both 'A'), the vacated cell
    // would complete a pure-normal-piece A,A,A run in col 1 — but blockers
    // aren't swappable, so neither candidate pair may count. No other
    // adjacent pair on this board produces a match either.
    const board: Board = [
      [piece('X', 'x'), piece('A', 'a0'), piece('Y', 'y')],
      [piece('A', 'a1'), blockerPiece('A', 'blk', 1), piece('A', 'a2')],
      [piece('Z', 'z'), piece('A', 'a3'), piece('W', 'w')],
    ];

    expect(hasLegalMoves(board)).toBe(false);
  });

  test('a real legal move elsewhere is still found on a board that also contains a blocker', () => {
    const board: Board = [
      [piece('A', 'a0'), piece('A', 'a1'), piece('B', 'b0')],
      [piece('B', 'b1'), piece('C', 'c0'), piece('A', 'a2')],
      [blockerPiece('Z', 'blk', 1), piece('D', 'd0'), piece('E', 'e0')],
    ];

    expect(hasLegalMoves(board)).toBe(true);
  });
});

describe('color bombs — excluded from runs, always a legal move', () => {
  test('a color bomb sitting between two equal-matchType runs breaks the run instead of joining it', () => {
    // Same exclusion a blocker gets: without it this would read as a 4-run of
    // 'A'. A color bomb is colorless and never participates in an ordinary run.
    const board: Board = [
      [piece('A', 'a0'), piece('A', 'a1'), colorBombPiece('cb'), piece('A', 'a2')],
    ];

    expect(checkMatches(board)).toEqual([]);
  });

  test('a color bomb makes an otherwise-stuck board report a legal move', () => {
    // This 3x3 Latin square has no ordinary matching swap anywhere (it's the
    // exact stuck board the shuffle test uses).
    const board = buildBoard([
      ['A', 'B', 'C'],
      ['C', 'A', 'B'],
      ['B', 'C', 'A'],
    ]);
    expect(hasLegalMoves(board)).toBe(false);

    // Swapping the center for a color bomb changes only one thing: a bomb swap
    // is always legal (it activates on the swap, not by forming a run), so the
    // board is no longer stuck — proving the color bomb, not some incidental
    // new run, is what makes the move legal.
    board[1][1] = colorBombPiece('cb');
    expect(hasLegalMoves(board)).toBe(true);
  });

  test('a live area bomb is colorless too — it never joins a run', () => {
    // Since the passive->active reversal, a live area bomb is colorless (drops
    // its matchType), exactly like a color bomb: if it weren't excluded, this
    // would read as a 4-run of 'A'.
    const board: Board = [
      [piece('A', 'a0'), piece('A', 'a1'), { id: 'ab', type: 'area_bomb' }, piece('A', 'a2')],
    ];
    expect(checkMatches(board)).toEqual([]);
  });

  test('an area bomb makes an otherwise-stuck board report a legal move (with an ordinary neighbour)', () => {
    const board = buildBoard([
      ['A', 'B', 'C'],
      ['C', 'A', 'B'],
      ['B', 'C', 'A'],
    ]);
    expect(hasLegalMoves(board)).toBe(false);

    // A colorless area bomb in the center is swap-activated: swapping it with any
    // ordinary neighbour fires its 3x3 blast, always a legal move.
    board[1][1] = { id: 'ab', type: 'area_bomb' };
    expect(hasLegalMoves(board)).toBe(true);
  });
});

describe('applyAdjacentDamage', () => {
  function boardWithBlockerAt(hitsRemaining: number): Board {
    return [
      [piece('P', 'p0'), piece('Q', 'q0'), piece('R', 'r0')],
      [piece('S', 's0'), blockerPiece('K', 'blk', hitsRemaining), piece('T', 't0')],
      [piece('U', 'u0'), piece('V', 'v0'), piece('W', 'w0')],
    ];
  }

  test('a hit that does not exhaust hitsRemaining decrements it without clearing', () => {
    const board = boardWithBlockerAt(2);
    const result = applyAdjacentDamage(board, [{ row: 0, col: 1 }]);

    expect(result.board[1][1]).toEqual(
      expect.objectContaining({ type: 'blocker', hitsRemaining: 1 })
    );
    expect(result.newlyClearedBlockers).toEqual([]);
  });

  test('a hit that exhausts hitsRemaining reports the cell as newly cleared', () => {
    const board = boardWithBlockerAt(1);
    const result = applyAdjacentDamage(board, [{ row: 0, col: 1 }]);

    expect(result.board[1][1]).toEqual(
      expect.objectContaining({ type: 'blocker', hitsRemaining: 0 })
    );
    expect(result.newlyClearedBlockers).toEqual([{ row: 1, col: 1 }]);
  });

  test('a blocker adjacent to several simultaneously-cleared cells takes exactly one hit', () => {
    const board = boardWithBlockerAt(3);
    // All four neighbors of the blocker cleared by the same match.
    const result = applyAdjacentDamage(board, [
      { row: 0, col: 1 },
      { row: 2, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 2 },
    ]);

    expect(result.board[1][1]).toEqual(
      expect.objectContaining({ type: 'blocker', hitsRemaining: 2 })
    );
    expect(result.newlyClearedBlockers).toEqual([]);
  });

  test('a blocker with no adjacent cleared cells is left untouched', () => {
    const board = boardWithBlockerAt(1);
    const result = applyAdjacentDamage(board, [{ row: 0, col: 0 }]);

    expect(result.board[1][1]).toEqual(
      expect.objectContaining({ type: 'blocker', hitsRemaining: 1 })
    );
    expect(result.newlyClearedBlockers).toEqual([]);
  });

  // hitsToClear: 2 (pot_lid's config value) genuinely needs two separate
  // match events, not one — the first pass only decrements, and the second
  // pass must be applied against the board the first pass actually
  // returned (not the original board) for the clear to be genuine rather
  // than an artifact of re-damaging the same starting hitsRemaining twice.
  test('a hitsToClear:2 blocker survives one adjacent match and only clears on a second, separate one', () => {
    const board = boardWithBlockerAt(2);

    const firstHit = applyAdjacentDamage(board, [{ row: 0, col: 1 }]);
    expect(firstHit.board[1][1]).toEqual(
      expect.objectContaining({ type: 'blocker', hitsRemaining: 1 })
    );
    expect(firstHit.newlyClearedBlockers).toEqual([]);

    // A second match, elsewhere adjacent to the same blocker, applied
    // against firstHit.board (the post-first-hit state) — not the original.
    const secondHit = applyAdjacentDamage(firstHit.board, [{ row: 1, col: 2 }]);
    expect(secondHit.board[1][1]).toEqual(
      expect.objectContaining({ type: 'blocker', hitsRemaining: 0 })
    );
    expect(secondHit.newlyClearedBlockers).toEqual([{ row: 1, col: 1 }]);
  });
});

describe('checkSquares — 2x2 block detection', () => {
  test('finds a 2x2 block of one matchType and returns its four cells top-left first', () => {
    // A B A       A pure 2x2 of 'A' at the top-left corner, and NO 3-in-a-row of
    // A B A       A anywhere (column 0/1 are broken up), so this is the shape the
    // C C D       run scanner alone would miss entirely.
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['A', 'A', 'Y'],
      ['C', 'D', 'E'],
    ]);
    // Sanity: no straight run exists, only the square.
    expect(checkMatches(board)).toHaveLength(0);

    const squares = checkSquares(board);
    expect(squares).toHaveLength(1);
    expect(squares[0].matchType).toBe('A');
    // positions[0] is the top-left anchor (the cell that becomes the area bomb).
    expect(squares[0].positions[0]).toEqual({ row: 0, col: 0 });
    expect(sortPositions(squares[0])).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  test('a 2x2 that includes a non-normal piece (blocker/special) is not a square', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['A', 'A', 'Y'],
      ['C', 'D', 'E'],
    ]);
    // Turn one of the four into a blocker of the same matchType — piecesMatch
    // would still reject it, but checkSquares also requires all four to be plain
    // 'normal' cells, so a special/blocker in a 2x2 never seeds an area bomb.
    board[1][1] = blockerPiece('A', '1-1', 2);
    expect(checkSquares(board)).toHaveLength(0);

    board[1][1] = { id: '1-1', type: 'striped', matchType: 'A', direction: 'row' };
    expect(checkSquares(board)).toHaveLength(0);
  });

  test('four cells of one type in an L (not a filled square) are not a square', () => {
    // (0,0)(0,1)(1,0) are A but (1,1) is not — three of a 2x2, not four.
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['A', 'B', 'Y'],
      ['C', 'D', 'E'],
    ]);
    expect(checkSquares(board)).toHaveLength(0);
  });

  test('hasLegalMoves treats a square-forming swap as legal even when no run would result', () => {
    // A distinct board is otherwise stuck, but one swap makes a pure 2x2 of A.
    const board = buildBoard([
      ['A', 'A', 'p'],
      ['A', 'z', 'A'],
      ['q', 'r', 's'],
    ]);
    // Swapping (1,1)<->(1,2) puts A at (1,1), completing the 2x2 at the corner —
    // and forms no 3-in-a-row. Without square-awareness this board reads stuck.
    expect(hasLegalMoves(board)).toBe(true);
    const swapped = swapPieces(board, { row: 1, col: 1 }, { row: 1, col: 2 });
    expect(checkMatches(swapped)).toHaveLength(0);
    expect(checkSquares(swapped)).toHaveLength(1);
  });

  test('shuffle returns a board free of both runs and 2x2 squares', () => {
    // A board saturated with one type would trivially form squares if shuffled
    // carelessly; assert the settled result is clean on both axes.
    const board = buildBoard([
      ['A', 'A', 'B', 'B'],
      ['A', 'A', 'B', 'C'],
      ['B', 'C', 'A', 'A'],
      ['C', 'B', 'A', 'C'],
    ]);
    const shuffled = shuffle(board, seededRng(7));
    expect(checkMatches(shuffled)).toHaveLength(0);
    expect(checkSquares(shuffled)).toHaveLength(0);
  });
});
