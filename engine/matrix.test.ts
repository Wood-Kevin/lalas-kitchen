import {
  checkMatches,
  swapPieces,
  calculateCascades,
  shuffle,
  hasLegalMoves,
  Board,
  Piece,
} from './matrix';

function piece(matchType: string, id: string): Piece {
  return { id, type: 'normal', matchType };
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
