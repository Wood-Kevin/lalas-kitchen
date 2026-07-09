import {
  checkMatches,
  checkSquares,
  checkCrossShapes,
  swapPieces,
  calculateCascades,
  shuffle,
  hasLegalMoves,
  findAnyLegalMove,
  applyAdjacentDamage,
  findSpreadTarget,
  dropdownArrivals,
  Board,
  Piece,
  Position,
} from './matrix';
import { ringVoids } from './boardShapes';

function piece(matchType: string, id: string): Piece {
  return { id, type: 'normal', matchType };
}

function blockerPiece(matchType: string, id: string, hitsRemaining: number): Piece {
  return { id, type: 'blocker', matchType, hitsRemaining };
}

function colorBombPiece(id: string): Piece {
  return { id, type: 'color_bomb' };
}

function dropdownPiece(id: string): Piece {
  return { id, type: 'dropdown' };
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

describe('dropdown (escort) pieces — matching exclusion', () => {
  test('a row of dropdown pieces never itself forms a run, even directly below a real matching run', () => {
    const board: Board = [
      [piece('A', 'a0'), piece('A', 'a1'), piece('A', 'a2')],
      [dropdownPiece('d0'), dropdownPiece('d1'), dropdownPiece('d2')],
    ];
    const matches = checkMatches(board);
    // The top row's real 'A' run is still found (unrelated to the dropdown
    // row) — the actual claim is that the dropdown row below it contributes
    // no match of its own, despite being three "same type" dropdown pieces
    // in a row.
    expect(matches).toHaveLength(1);
    expect(matches[0].matchType).toBe('A');
    expect(sortPositions(matches[0]).map((p) => p.row)).toEqual([0, 0, 0]);
  });

  test('a dropdown piece never forms a 2x2 square', () => {
    const board: Board = [
      [dropdownPiece('d0'), dropdownPiece('d1')],
      [dropdownPiece('d2'), dropdownPiece('d3')],
    ];
    expect(checkSquares(board)).toEqual([]);
  });

  test('a run on either side of a dropdown piece is still detected independently', () => {
    const board: Board = [[piece('A', 'a0'), piece('A', 'a1'), piece('A', 'a2'), dropdownPiece('d0'), piece('B', 'b0')]];
    const matches = checkMatches(board);
    expect(matches).toHaveLength(1);
    expect(sortPositions(matches[0]).map((p) => p.col)).toEqual([0, 1, 2]);
  });
});

describe('dropdownArrivals', () => {
  test('a dropdown piece at the bottom of a plain rectangular column has arrived', () => {
    const board: Board = [[piece('A', 'a0')], [dropdownPiece('d0')]];
    expect(dropdownArrivals(board)).toEqual([{ row: 1, col: 0 }]);
  });

  test('a dropdown piece NOT at the bottom of its column has not arrived', () => {
    const board: Board = [[dropdownPiece('d0')], [piece('A', 'a0')]];
    expect(dropdownArrivals(board)).toEqual([]);
  });

  test('on a shaped board, arrival is the bottom of the dropdown\'s own segment (above a void), not the literal board floor', () => {
    const board: Board = [
      [dropdownPiece('d0')],
      [piece('A', 'a0')],
      [{ id: 'v0', type: 'void' }],
      [piece('B', 'b0')],
    ];
    // d0 sits above A, which sits above a void — d0's segment is rows 0-1,
    // and it's at row 0, not the bottom of that segment (row 1) — no arrival.
    expect(dropdownArrivals(board)).toEqual([]);

    const arrivedBoard: Board = [
      [piece('A', 'a0')],
      [dropdownPiece('d0')],
      [{ id: 'v0', type: 'void' }],
      [piece('B', 'b0')],
    ];
    // Now d0 IS at the bottom of its segment (row 1, just above the void) —
    // a real arrival, even though row 3 (below the void) is the literal
    // board floor, not row 1.
    expect(dropdownArrivals(arrivedBoard)).toEqual([{ row: 1, col: 0 }]);
  });

  test('multiple columns are scanned independently, returning only genuine arrivals', () => {
    const board: Board = [
      [piece('A', 'a0'), dropdownPiece('d0')],
      [dropdownPiece('d1'), piece('B', 'b0')],
    ];
    // Column 0: dropdown at row 1 (bottom) — arrived. Column 1: dropdown at
    // row 0, not the bottom — not arrived.
    expect(dropdownArrivals(board)).toEqual([{ row: 1, col: 0 }]);
  });

  test('a board with no dropdown pieces at all reports no arrivals', () => {
    const board = buildBoard([
      ['A', 'B'],
      ['B', 'A'],
    ]);
    expect(dropdownArrivals(board)).toEqual([]);
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

describe('findAnyLegalMove', () => {
  test('returns an actual pair of positions — not just true — for a board that has a legal move, and swapping that exact pair really does create a match', () => {
    const board = buildBoard([
      ['A', 'A', 'B'],
      ['B', 'C', 'A'],
    ]);

    const move = findAnyLegalMove(board);

    expect(move).not.toBeNull();
    const swapped = swapPieces(board, move!.a, move!.b);
    expect(checkMatches(swapped).length).toBeGreaterThan(0);
  });

  test('returns null for a board with no legal move anywhere', () => {
    const board = buildBoard([
      ['A', 'B'],
      ['B', 'A'],
    ]);

    expect(findAnyLegalMove(board)).toBeNull();
  });

  test('agrees with hasLegalMoves on every board — the boolean is just this result narrowed to non-null', () => {
    const stuck = buildBoard([
      ['A', 'B'],
      ['B', 'A'],
    ]);
    const playable = buildBoard([
      ['A', 'A', 'B'],
      ['B', 'C', 'A'],
    ]);

    expect(findAnyLegalMove(stuck) === null).toBe(!hasLegalMoves(stuck));
    expect(findAnyLegalMove(playable) === null).toBe(!hasLegalMoves(playable));
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

describe('dropdown (escort) pieces — always a legal swap', () => {
  test('a dropdown piece makes an otherwise-stuck board report a legal move', () => {
    // Same stuck 3x3 Latin square as the color-bomb test above.
    const board = buildBoard([
      ['A', 'B', 'C'],
      ['C', 'A', 'B'],
      ['B', 'C', 'A'],
    ]);
    expect(hasLegalMoves(board)).toBe(false);

    // Swapping the center for a dropdown piece changes only one thing: a
    // dropdown swap is always legal (it never needs to form a match — the
    // player must be able to freely nudge it sideways), so the board is no
    // longer stuck.
    board[1][1] = dropdownPiece('dd');
    expect(hasLegalMoves(board)).toBe(true);
  });

  test('findAnyLegalMove returns the actual dropdown pair, not just true', () => {
    const board = buildBoard([
      ['A', 'B', 'C'],
      ['C', 'A', 'B'],
      ['B', 'C', 'A'],
    ]);
    board[1][1] = dropdownPiece('dd');
    const move = findAnyLegalMove(board);
    expect(move).not.toBeNull();
    const involvesDropdown = (pos: Position) => board[pos.row][pos.col].type === 'dropdown';
    expect(involvesDropdown(move!.a) || involvesDropdown(move!.b)).toBe(true);
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

  test('a 2x2 that includes a blocker is not a square', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['A', 'A', 'Y'],
      ['C', 'D', 'E'],
    ]);
    // Turn one of the four into a blocker of the same matchType — piecesMatch
    // would still reject it, but checkSquares also requires a blocker corner
    // to be excluded outright, so a blocker in a 2x2 never seeds an area bomb.
    board[1][1] = blockerPiece('A', '1-1', 2);
    expect(checkSquares(board)).toHaveLength(0);
  });

  // Real playtesting found a square with a live striped corner (same
  // matchType as the other three) silently failed to form at all — this used
  // to be lumped in with the blocker case above, but a striped piece is
  // content, not a non-content sentinel, and the run path already lets an
  // existing special fire itself instead of blocking a match outright (see
  // engine/DECISIONS.md's square+striped entry). checkSquares now detects
  // this shape; gameState.ts's resolveMatchEffects decides what happens to
  // the striped corner (fires its own sweep, doesn't spawn a new area bomb —
  // see its own tests).
  test('a 2x2 with a live striped corner (same matchType as the other three) IS a square', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['A', 'A', 'Y'],
      ['C', 'D', 'E'],
    ]);
    board[1][1] = { id: '1-1', type: 'striped', matchType: 'A', direction: 'row' };
    const squares = checkSquares(board);
    expect(squares).toHaveLength(1);
    expect(squares[0].matchType).toBe('A');
    expect(sortPositions(squares[0])).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  test('a 2x2 that includes a color bomb or area bomb is not a square (colorless, no matchType to share)', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['A', 'A', 'Y'],
      ['C', 'D', 'E'],
    ]);
    board[1][1] = { id: '1-1', type: 'color_bomb' };
    expect(checkSquares(board)).toHaveLength(0);

    board[1][1] = { id: '1-1', type: 'area_bomb' };
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

// shuffle used to try 100 random reshuffles, then silently return the LAST
// one even if it still had a match, a square, or zero legal moves — the one
// rescue mechanism a stuck board has, handing back a board it never
// verified. These confirm the hardened version (a deterministic,
// multiset-preserving repair tier, then a self-verifying forced-legal-move
// construction, only THEN a loud descriptive throw for a genuinely
// impossible board) actually holds — see engine/DECISIONS.md's
// shuffle-hardening entry.
describe('shuffle — hardened rescue fallback', () => {
  test('a rigged rng that repeats the exact same illegal arrangement on every attempt is still rescued into a legal board', () => {
    // rng ≡ 0 makes fisherYates produce the SAME result every single call —
    // hand-traced against the actual algorithm below, it's a left-rotation
    // by exactly one position of the row-major-collected movable pieces
    // [B,A,A,A,C,D,E,F,G] -> [A,A,A,C,D,E,F,G,B] -- so every one of the 100
    // "random" attempts is byte-identical, and this board is laid out so
    // THAT SPECIFIC rotation lands three A's in row 0. This guarantees all
    // 100 attempts fail identically, so the final legal result can only have
    // come from the new deterministic repair tier, never from luck.
    const board = buildBoard([
      ['B', 'A', 'A'],
      ['A', 'C', 'D'],
      ['E', 'F', 'G'],
    ]);

    const shuffled = shuffle(board, () => 0);

    expect(checkMatches(shuffled)).toHaveLength(0);
    expect(checkSquares(shuffled)).toHaveLength(0);
    expect(hasLegalMoves(shuffled)).toBe(true);
    // Same multiset, not just "some legal board" — a reshuffle must never
    // change what pieces exist, only where they sit.
    const originalTypes = board.flat().map((p) => p.matchType).sort();
    const shuffledTypes = shuffled.flat().map((p) => p.matchType).sort();
    expect(shuffledTypes).toEqual(originalTypes);
  });

  test('adversarial worst case: a heavily voided (ring) board with dense blockers and a high piece-type count is always rescued into a genuinely legal board', () => {
    const rows = 8;
    const cols = 5;
    // The real generated-level `ring` template at its real board size (see
    // engine/boardShapes.ts and CLAUDE.md's board-shape entry) — the most
    // restrictive shape this game actually ships, 22 of 40 cells playable.
    const voidKeys = new Set(ringVoids(rows, cols).map((p) => `${p.row},${p.col}`));
    const perimeter: Position[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!voidKeys.has(`${r},${c}`)) perimeter.push({ row: r, col: c });
      }
    }
    expect(perimeter).toHaveLength(22); // confirms this really is the 55%-playable ring

    // Every 4th perimeter cell (row-major) is a blocker — dense, but leaves
    // enough ordinary cells that a legal arrangement remains possible.
    const blockerKeys = new Set(
      perimeter.filter((_, i) => i % 4 === 0).map((p) => `${p.row},${p.col}`)
    );
    // The real 6-type pool this skin ships (skins/lalas-kitchen/config.json)
    // — "high piece-type count" at its actual real-content maximum, not an
    // arbitrary bigger number.
    const pieceTypes = ['tomato', 'lemon', 'herb', 'garlic', 'chili', 'spoon'];

    const board: Board = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ({ id: `${r}-${c}`, type: 'void' as const }))
    );
    perimeter.forEach((pos, i) => {
      const id = `${pos.row}-${pos.col}`;
      const matchType = pieceTypes[i % pieceTypes.length];
      board[pos.row][pos.col] = blockerKeys.has(`${pos.row},${pos.col}`)
        ? { id, type: 'blocker', matchType, hitsRemaining: 1 }
        : { id, type: 'normal', matchType };
    });
    const blockerCountBefore = board.flat().filter((p) => p.type === 'blocker').length;

    // Several genuinely different rngs, including maximally-degenerate
    // constants that each force fisherYates to repeat one fixed permutation
    // on every single attempt (see the test above) — tier-1's random search
    // cannot rely on trying different arrangements at all under these.
    for (const rng of [seededRng(99), () => 0, () => 0.999999]) {
      const shuffled = shuffle(board, rng);

      expect(checkMatches(shuffled)).toHaveLength(0);
      expect(checkSquares(shuffled)).toHaveLength(0);
      expect(hasLegalMoves(shuffled)).toBe(true);

      // The board's shape and blocker count are never touched by a
      // reshuffle — only ordinary movable pieces are ever redistributed.
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (board[r][c].type === 'void') expect(shuffled[r][c].type).toBe('void');
        }
      }
      expect(shuffled.flat().filter((p) => p.type === 'blocker')).toHaveLength(blockerCountBefore);
    }
  });

  test('a genuinely impossible board (no matchType ever reaches count 3) throws a descriptive error instead of returning an illegal board', () => {
    // Every movable cell is a distinct type — no arrangement can ever
    // contain a 3-run, so no legal move can ever exist, no matter how the
    // pieces are placed. shuffle must refuse to hand back ANY candidate
    // here, loudly, rather than silently returning the least-bad attempt.
    const board = buildBoard([['A', 'B', 'C']]);
    expect(() => shuffle(board, seededRng(1))).toThrow(/could not produce a legal board/);
  });
});

describe('checkCrossShapes — L/T/plus crossing-run detection', () => {
  test('finds a plus shape (crossing cell is the middle of both arms) and returns it anchor-first', () => {
    // Row 2, cols 1-3 and col 2, rows 1-3 are each an exactly-3 run sharing
    // (2,2) — the classic plus. Everything else is a distinct matchType so
    // this is the only shape on the board.
    const board = buildBoard([
      ['p', 'q', 'r', 's', 't'],
      ['u', 'v', 'A', 'w', 'x'],
      ['y', 'A', 'A', 'A', 'z'],
      ['m', 'c', 'A', 'o', 'k'],
      ['e', 'f', 'g', 'h', 'i'],
    ]);
    // Sanity: checkMatches already independently sees both arms as ordinary
    // 3-runs — this is exactly why no legality-gate wiring was needed (see
    // engine/DECISIONS.md's crossing-run entry).
    expect(checkMatches(board)).toHaveLength(2);
    expect(checkSquares(board)).toHaveLength(0);

    const crosses = checkCrossShapes(board);
    expect(crosses).toHaveLength(1);
    expect(crosses[0].matchType).toBe('A');
    // positions[0] is the crossing cell — the anchor that becomes the area bomb.
    expect(crosses[0].positions[0]).toEqual({ row: 2, col: 2 });
    expect(sortPositions(crosses[0])).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
      { row: 3, col: 2 },
    ]);
  });

  test('finds an L shape (crossing cell is the shared endpoint of both arms)', () => {
    const board = buildBoard([
      ['A', 'A', 'A', 'p'],
      ['A', 'q', 'r', 's'],
      ['A', 't', 'u', 'v'],
      ['w', 'x', 'y', 'z'],
    ]);
    expect(checkMatches(board)).toHaveLength(2);

    const crosses = checkCrossShapes(board);
    expect(crosses).toHaveLength(1);
    expect(crosses[0].positions[0]).toEqual({ row: 0, col: 0 });
    expect(sortPositions(crosses[0])).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 0 },
      { row: 2, col: 0 },
    ]);
  });

  test('finds a T shape (crossing cell is the middle of one arm, the endpoint of the other)', () => {
    const board = buildBoard([
      ['A', 'A', 'A', 'p'],
      ['q', 'A', 'r', 's'],
      ['t', 'A', 'u', 'v'],
      ['w', 'x', 'y', 'z'],
    ]);
    expect(checkMatches(board)).toHaveLength(2);

    const crosses = checkCrossShapes(board);
    expect(crosses).toHaveLength(1);
    expect(crosses[0].positions[0]).toEqual({ row: 0, col: 1 });
    expect(sortPositions(crosses[0])).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 1 },
      { row: 2, col: 1 },
    ]);
  });

  test('a straight 5-run with no perpendicular run anywhere is not a cross', () => {
    const board = buildBoard([
      ['A', 'A', 'A', 'A', 'A'],
      ['b', 'c', 'd', 'e', 'f'],
      ['g', 'h', 'i', 'j', 'k'],
      ['l', 'm', 'n', 'o', 'p'],
      ['q', 'r', 's', 't', 'u'],
    ]);
    expect(checkMatches(board)).toHaveLength(1);
    expect(checkCrossShapes(board)).toHaveLength(0);
  });

  // The confirmed precedence rule: a crossing point only spawns an area bomb
  // when BOTH arms are exactly length 3. A 4- or 5-long arm already spawns its
  // own striped piece / color bomb via the ordinary run logic, so
  // checkCrossShapes must never report it as a candidate at all — this is
  // baked into the scan, not filtered afterward by a caller (see
  // engine/DECISIONS.md's crossing-run entry).
  test('a 4-long arm crossing an exactly-3 arm is NOT reported as a cross', () => {
    const board = buildBoard([
      ['p', 'q', 'r', 's', 't'],
      ['u', 'A', 'v', 'w', 'x'],
      ['A', 'A', 'A', 'A', 'y'],
      ['z', 'A', 'aa', 'bb', 'cc'],
      ['dd', 'ee', 'ff', 'gg', 'hh'],
    ]);
    // Sanity: checkMatches sees both the 4-run and the 3-run independently.
    expect(checkMatches(board)).toHaveLength(2);
    expect(checkCrossShapes(board)).toHaveLength(0);
  });

  test('a 5-long arm crossing an exactly-3 arm is NOT reported as a cross', () => {
    const board = buildBoard([
      ['p', 'q', 'r', 's', 't'],
      ['u', 'A', 'v', 'w', 'x'],
      ['A', 'A', 'A', 'A', 'A'],
      ['z', 'A', 'aa', 'bb', 'cc'],
      ['dd', 'ee', 'ff', 'gg', 'hh'],
    ]);
    expect(checkMatches(board)).toHaveLength(2);
    expect(checkCrossShapes(board)).toHaveLength(0);
  });

  test('a blocker at the crossing cell breaks both arms — not a cross', () => {
    const board = buildBoard([
      ['p', 'q', 'r', 's', 't'],
      ['u', 'v', 'A', 'w', 'x'],
      ['y', 'A', 'A', 'A', 'z'],
      ['m', 'c', 'A', 'o', 'k'],
      ['e', 'f', 'g', 'h', 'i'],
    ]);
    board[2][2] = blockerPiece('A', '2-2', 2);
    expect(checkCrossShapes(board)).toHaveLength(0);
  });

  test('a void at the crossing cell breaks both arms — not a cross', () => {
    const board = buildShapedBoard([
      ['p', 'q', 'r', 's', 't'],
      ['u', 'v', 'A', 'w', 'x'],
      ['y', 'A', '.', 'A', 'z'],
      ['m', 'c', 'A', 'o', 'k'],
      ['e', 'f', 'g', 'h', 'i'],
    ]);
    expect(checkCrossShapes(board)).toHaveLength(0);
  });

  test('a live striped piece in an arm is included, not excluded — detection only reports geometry', () => {
    const board = buildBoard([
      ['p', 'q', 'r', 's', 't'],
      ['u', 'v', 'A', 'w', 'x'],
      ['y', 'A', 'A', 'A', 'z'],
      ['m', 'c', 'A', 'o', 'k'],
      ['e', 'f', 'g', 'h', 'i'],
    ]);
    board[1][2] = { id: '1-2', type: 'striped', matchType: 'A', direction: 'col' };
    const crosses = checkCrossShapes(board);
    expect(crosses).toHaveLength(1);
    expect(crosses[0].matchType).toBe('A');
    expect(sortPositions(crosses[0])).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
      { row: 3, col: 2 },
    ]);
  });

  test('hasLegalMoves and checkMatches already treat a cross-forming swap as legal with no new wiring', () => {
    // A distinct board where swapping (2,2)<->(1,2) completes a T: row 2
    // cols1-3 and col 2 rows2-4. Neither arm exists yet (both need (2,2)).
    const board = buildBoard([
      ['p0', 'p1', 'p2', 'p3', 'p4'],
      ['p5', 'p6', 'A', 'p8', 'p9'],
      ['p10', 'A', 'p12', 'A', 'p14'],
      ['p15', 'p16', 'A', 'p18', 'p19'],
      ['p20', 'p21', 'A', 'p23', 'p24'],
    ]);
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkSquares(board)).toHaveLength(0);
    expect(checkCrossShapes(board)).toHaveLength(0);
    // hasLegalMoves finds this swap legal via its EXISTING checkMatches
    // clause alone — no checkCrossShapes addition was made to legalPair.
    expect(hasLegalMoves(board)).toBe(true);

    const swapped = swapPieces(board, { row: 2, col: 2 }, { row: 1, col: 2 });
    expect(checkMatches(swapped).length).toBeGreaterThanOrEqual(2);
    expect(checkCrossShapes(swapped)).toHaveLength(1);
  });

  test('shuffle returns a board free of runs, squares, and crossing points', () => {
    const board = buildBoard([
      ['A', 'A', 'B', 'B'],
      ['A', 'A', 'B', 'C'],
      ['B', 'C', 'A', 'A'],
      ['C', 'B', 'A', 'C'],
    ]);
    const shuffled = shuffle(board, seededRng(7));
    expect(checkMatches(shuffled)).toHaveLength(0);
    expect(checkSquares(shuffled)).toHaveLength(0);
    expect(checkCrossShapes(shuffled)).toHaveLength(0);
  });
});

describe('findSpreadTarget (denial-zone spread frontier)', () => {
  test('returns the first blocker (row-major) paired with its first ordinary neighbor (up before right)', () => {
    const board = buildBoard([
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
    ]);
    // Blocker at (2,0): scanned first. Its neighbors in offset order are up
    // (1,0) then right (2,1) — both ordinary, so 'up' wins.
    board[2][0] = blockerPiece('X', 'blk', 1);
    expect(findSpreadTarget(board)).toEqual({
      source: { row: 2, col: 0 },
      target: { row: 1, col: 0 },
    });
  });

  test('skips neighbors that are not ordinary and picks the first ordinary one', () => {
    const board = buildBoard([
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
    ]);
    // Blocker at (1,1) surrounded by: up (0,1) a color bomb, down (2,1) another
    // blocker, left (1,0) ordinary, right (1,2) ordinary. Up/down are ineligible
    // (not 'normal'), so the first ordinary in offset order — left (1,0) — wins.
    board[1][1] = blockerPiece('X', 'blk1', 1);
    board[0][1] = colorBombPiece('cb');
    board[2][1] = blockerPiece('X', 'blk2', 1);
    // (1,1) is the first blocker in row-major order, so it's the source.
    expect(findSpreadTarget(board)).toEqual({
      source: { row: 1, col: 1 },
      target: { row: 1, col: 0 },
    });
  });

  test('returns null when the zone is fully enclosed (no blocker borders an ordinary cell)', () => {
    // Every cell is a blocker — nothing can spread. Also covers a board with no
    // ordinary neighbor anywhere.
    const board: Board = [
      [blockerPiece('X', 'b00', 1), blockerPiece('X', 'b01', 1)],
      [blockerPiece('X', 'b10', 1), blockerPiece('X', 'b11', 1)],
    ];
    expect(findSpreadTarget(board)).toBeNull();
  });

  test('returns null on a board with no blockers at all', () => {
    const board = buildBoard([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    expect(findSpreadTarget(board)).toBeNull();
  });
});

// Void cells make a board non-rectangular (a plus, a ring, an irregular
// outline). Every rule below is the "this cell doesn't exist" contract: a void
// is never matched, never a square corner, never swapped, never moved by
// gravity or shuffle, and never spawned into.
function voidPiece(id: string): Piece {
  return { id, type: 'void' };
}

// Like buildBoard, but the letter '.' places a fixed void cell instead of an
// ordinary piece — so a board's shape reads as ASCII art in the test.
function buildShapedBoard(letters: string[][]): Board {
  return letters.map((row, r) =>
    row.map((ch, c) => (ch === '.' ? voidPiece(`${r}-${c}`) : piece(ch, `${r}-${c}`)))
  );
}

describe('void cells — matching', () => {
  test('a void breaks a run: three matching pieces split by a void do not match', () => {
    const board = buildShapedBoard([['A', 'A', '.', 'A', 'A']]);
    expect(checkMatches(board)).toEqual([]);
  });

  test('a run on one side of a void is still detected', () => {
    const board = buildShapedBoard([['A', 'A', 'A', '.', 'B']]);
    const matches = checkMatches(board);
    expect(matches).toHaveLength(1);
    expect(sortPositions(matches[0]).map((p) => p.col)).toEqual([0, 1, 2]);
  });

  test('a void corner prevents a 2x2 square', () => {
    const board = buildShapedBoard([
      ['A', 'A'],
      ['A', '.'],
    ]);
    expect(checkSquares(board)).toEqual([]);
  });
});

describe('void cells — gravity (calculateCascades)', () => {
  test('a piece rests on top of a void instead of falling through it', () => {
    const topX = piece('X', 'x');
    const belowY = piece('Y', 'y');
    // Column, top→bottom: X, (cleared), VOID, Y. X must fall to rest ON the
    // void (row 1), never past it into row 3; Y below the void is untouched.
    const board: Array<Array<Piece | null>> = [[topX], [null], [voidPiece('v')], [belowY]];

    const spawnQueue = [piece('S', 'spawn-top')];
    const spawnPiece = () => {
      const next = spawnQueue.shift();
      if (!next) throw new Error('spawnPiece called more times than expected');
      return next;
    };

    const result = calculateCascades(board, spawnPiece);

    expect(result[0][0].id).toBe('spawn-top'); // refill enters at segment top
    expect(result[1][0].id).toBe('x'); // X fell one row, rests on the void
    expect(result[2][0].type).toBe('void'); // void fixed in place
    expect(result[2][0].id).toBe('v'); // same object/id — never moved
    expect(result[3][0].id).toBe('y'); // below-void segment untouched
    expect(spawnQueue).toHaveLength(0); // exactly one spawn — never into the void
  });

  test('an enclosed segment refills from its own top, not the board top', () => {
    const survivorX = piece('X', 'x');
    const survivorY = piece('Y', 'y');
    // Column: VOID, X, (cleared), Y, VOID. The playable segment is rows 1-3,
    // walled by voids above and below. Its one refill must appear at row 1
    // (the segment's own top), never at row 0 (which is a void).
    const board: Array<Array<Piece | null>> = [
      [voidPiece('v-top')],
      [survivorX],
      [null],
      [survivorY],
      [voidPiece('v-bot')],
    ];

    const spawnQueue = [piece('S', 'spawn-mid')];
    const spawnPiece = () => {
      const next = spawnQueue.shift();
      if (!next) throw new Error('spawnPiece called more times than expected');
      return next;
    };

    const result = calculateCascades(board, spawnPiece);

    expect(result[0][0].type).toBe('void');
    expect(result[1][0].id).toBe('spawn-mid'); // refill at the segment's top
    expect(result[2][0].id).toBe('x');
    expect(result[3][0].id).toBe('y');
    expect(result[4][0].type).toBe('void');
    expect(spawnQueue).toHaveLength(0);
  });

  test('a void-free column is unchanged by the segmented logic', () => {
    // Regression guard: with no voids, gravity must behave exactly as before —
    // survivors compact to the bottom, refills at the very top.
    const survivorX = piece('X', 'x');
    const survivorY = piece('Y', 'y');
    const board: Array<Array<Piece | null>> = [[null], [survivorX], [null], [survivorY]];
    const spawnQueue = [piece('S1', 's1'), piece('S2', 's2')];
    const spawnPiece = () => spawnQueue.shift() as Piece;

    const result = calculateCascades(board, spawnPiece);

    expect(result.map((row) => row[0].id)).toEqual(['s1', 's2', 'x', 'y']);
  });
});

describe('void cells — hasLegalMoves', () => {
  test('a legal ordinary swap is still found when voids are present elsewhere', () => {
    // Swapping (2,0) and (2,1) makes column 0 = A,A,A. Voids fill column 2 and
    // must not hide that move.
    const board = buildShapedBoard([
      ['A', 'B', '.'],
      ['A', 'C', '.'],
      ['B', 'A', '.'],
    ]);
    expect(hasLegalMoves(board)).toBe(true);
  });

  test('a void is never counted as a swap partner, so a shape with no real move is stuck', () => {
    // The only two pieces are diagonal (not adjacent); every orthogonal
    // neighbour is a void, which can never be swapped. No legal move exists.
    const board = buildShapedBoard([
      ['A', '.'],
      ['.', 'A'],
    ]);
    expect(hasLegalMoves(board)).toBe(false);
  });
});

describe('void cells — shuffle keeps the board shape fixed', () => {
  test('voids stay at their exact positions after a reshuffle', () => {
    // Unlike the original diagonal-void layout this replaced, every row and
    // column here has at least 3 contiguous movable cells — a board where NO
    // line ever reaches length 3 can structurally never have a legal move
    // (checkMatches/hasLegalMoves both require a 3-run), regardless of piece
    // types, which is a fixture bug shuffle's own hardening now correctly
    // rejects rather than silently tolerates — see
    // engine/DECISIONS.md's shuffle-hardening entry.
    const board = buildShapedBoard([
      ['A', 'A', 'B'],
      ['B', '.', 'C'],
      ['C', 'A', 'B'],
    ]);
    const shuffled = shuffle(board, seededRng(3));

    // Every void cell is still a void at the same coordinate, with the same id.
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c].type === 'void') {
          expect(shuffled[r][c].type).toBe('void');
          expect(shuffled[r][c].id).toBe(board[r][c].id);
        } else {
          expect(shuffled[r][c].type).not.toBe('void');
        }
      }
    }
  });
});
