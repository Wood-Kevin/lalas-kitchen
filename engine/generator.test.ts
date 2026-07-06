import { BOARD_SHAPE_ROTATION, BOARD_SHAPE_TEMPLATES } from './boardShapes';
import { generateLevel, GeneratorConfig } from './generator';
import { checkMatches, checkSquares, hasLegalMoves, Position } from './matrix';

function matchTypeGrid(board: ReturnType<typeof generateLevel>): (string | undefined)[][] {
  return board.map((row) => row.map((p) => p.matchType));
}

describe('generateLevel', () => {
  const normalConfig: GeneratorConfig = {
    rows: 8,
    cols: 8,
    pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
  };

  test('the same seed called twice produces an identical board', () => {
    const first = generateLevel(12345, normalConfig);
    const second = generateLevel(12345, normalConfig);

    expect(second).toEqual(first);
  });

  test('different seeds produce different boards', () => {
    const boardA = generateLevel(1, normalConfig);
    const boardB = generateLevel(2, normalConfig);

    expect(matchTypeGrid(boardA)).not.toEqual(matchTypeGrid(boardB));
  });

  test('generated boards never contain an accidental match on creation', () => {
    for (const seed of [1, 2, 3, 42, 999, 123456]) {
      const board = generateLevel(seed, normalConfig);
      expect(checkMatches(board)).toEqual([]);
    }
  });

  test('generated boards always have at least one legal move', () => {
    for (const seed of [1, 2, 3, 42, 999, 123456]) {
      const board = generateLevel(seed, normalConfig);
      expect(hasLegalMoves(board)).toBe(true);
    }
  });

  test('a hostile config (2 piece types, small board) still resolves with no matches and no infinite loop', () => {
    const hostileConfig: GeneratorConfig = {
      rows: 6,
      cols: 6,
      pieceTypeIds: ['A', 'B'],
    };

    for (const seed of [1, 2, 3, 4, 5]) {
      const board = generateLevel(seed, hostileConfig);
      expect(checkMatches(board)).toEqual([]);
      expect(hasLegalMoves(board)).toBe(true);
    }
  });

  test('rejects a config with fewer than 2 piece types', () => {
    expect(() => generateLevel(1, { rows: 5, cols: 5, pieceTypeIds: ['A'] })).toThrow();
  });
});

describe('generateLevel — blocker placement', () => {
  const blockerConfig: GeneratorConfig = {
    rows: 8,
    cols: 8,
    pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
    blockerCount: 4,
    blockerMatchType: 'cling',
    blockerHitsToClear: 1,
  };

  test('places the requested number of blockers with the right matchType and hit count', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const board = generateLevel(seed, blockerConfig);
      const blockers = board.flat().filter((p) => p.type === 'blocker');

      expect(blockers).toHaveLength(4);
      for (const blocker of blockers) {
        expect(blocker.matchType).toBe('cling');
        expect(blocker.hitsRemaining).toBe(1);
      }
    }
  });

  test('a board with blockers still never contains an accidental match on creation', () => {
    for (const seed of [1, 2, 3, 42, 999, 123456]) {
      const board = generateLevel(seed, blockerConfig);
      expect(checkMatches(board)).toEqual([]);
    }
  });

  test('a board with blockers still always has at least one legal move', () => {
    for (const seed of [1, 2, 3, 42, 999, 123456]) {
      const board = generateLevel(seed, blockerConfig);
      expect(hasLegalMoves(board)).toBe(true);
    }
  });

  test('omitting blockerCount places no blockers, unchanged from every level built before this phase', () => {
    const board = generateLevel(1, {
      rows: 8,
      cols: 8,
      pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
    });
    expect(board.flat().some((p) => p.type === 'blocker')).toBe(false);
  });

  // blockerHitsToClear is plain passthrough data to placeBlockers (see
  // generator.ts) — this proves it genuinely isn't hardcoded to 1 anywhere
  // in the placement path, using pot_lid's real config value (2).
  test('a blockerHitsToClear of 2 (pot_lid) is placed with hitsRemaining 2, not hardcoded to 1', () => {
    const board = generateLevel(1, {
      rows: 8,
      cols: 8,
      pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
      blockerCount: 4,
      blockerMatchType: 'pot_lid',
      blockerHitsToClear: 2,
    });
    const blockers = board.flat().filter((p) => p.type === 'blocker');
    expect(blockers).toHaveLength(4);
    for (const blocker of blockers) {
      expect(blocker.matchType).toBe('pot_lid');
      expect(blocker.hitsRemaining).toBe(2);
    }
  });
});

describe('generateLevel — non-rectangular (void) board shape', () => {
  // A plus on a 7x7 board: the four 2x2 corner blocks are voids, leaving a
  // fat plus of playable cells (the same shape the hand-built showcase level
  // uses).
  const plusVoids: Position[] = [];
  for (const r of [0, 1, 5, 6]) {
    for (const c of [0, 1, 5, 6]) {
      plusVoids.push({ row: r, col: c });
    }
  }
  const isVoidCell = (r: number, c: number): boolean =>
    plusVoids.some((p) => p.row === r && p.col === c);

  const plusConfig: GeneratorConfig = {
    rows: 7,
    cols: 7,
    pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
    voidCells: plusVoids,
  };

  test('void cells are placed exactly where requested and nowhere else', () => {
    const board = generateLevel(42, plusConfig);
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (isVoidCell(r, c)) {
          expect(board[r][c].type).toBe('void');
          expect(board[r][c].matchType).toBeUndefined();
        } else {
          expect(board[r][c].type).toBe('normal');
          expect(board[r][c].matchType).toBeDefined();
        }
      }
    }
  });

  test('a piece is never generated into a void cell (voids hold no content)', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const board = generateLevel(seed, plusConfig);
      for (const pos of plusVoids) {
        expect(board[pos.row][pos.col].type).toBe('void');
      }
    }
  });

  test('a shaped board is match-free and playable on creation, same guarantee as a rectangle', () => {
    for (const seed of [1, 2, 3, 42, 999, 123456]) {
      const board = generateLevel(seed, plusConfig);
      expect(checkMatches(board)).toEqual([]);
      expect(checkSquares(board)).toEqual([]);
      expect(hasLegalMoves(board)).toBe(true);
    }
  });

  test('the same seed reproduces an identical shaped board', () => {
    expect(generateLevel(7, plusConfig)).toEqual(generateLevel(7, plusConfig));
  });

  test('blockers on a shaped board never land on a void cell', () => {
    const board = generateLevel(3, { ...plusConfig, blockerCount: 6, blockerMatchType: 'cling', blockerHitsToClear: 1 });
    const blockers = board.flat().filter((p) => p.type === 'blocker');
    expect(blockers.length).toBeGreaterThan(0);
    board.forEach((row, r) =>
      row.forEach((p, c) => {
        if (p.type === 'blocker') expect(isVoidCell(r, c)).toBe(false);
      })
    );
  });
});

describe('generateLevel — curated shape templates (boardShapes.ts), at the real generated-level board size', () => {
  // 8x5 is the fixed board size buildGeneratedLevelConfig actually uses for
  // every generator-driven level (see appPersistence.ts), not the hand-built
  // Cutting Board level's own 7x7 — a template needs to hold up at the size
  // it's genuinely exercised at, not just the size it happened to be
  // eyeballed against.
  const ROWS = 8;
  const COLS = 5;
  const PIECE_TYPE_IDS = ['A', 'B', 'C', 'D', 'E'];

  for (const shapeId of BOARD_SHAPE_ROTATION) {
    const voidCells = BOARD_SHAPE_TEMPLATES[shapeId](ROWS, COLS);
    const isVoidCell = (r: number, c: number): boolean => voidCells.some((p) => p.row === r && p.col === c);

    describe(`shape: ${shapeId}`, () => {
      const config: GeneratorConfig = {
        rows: ROWS,
        cols: COLS,
        pieceTypeIds: PIECE_TYPE_IDS,
        voidCells,
      };

      test('is match-free, square-free, and has a legal move on creation — the same guarantee a rectangle gets', () => {
        for (const seed of [1, 2, 3, 42, 999, 123456]) {
          const board = generateLevel(seed, config);
          expect(checkMatches(board)).toEqual([]);
          expect(checkSquares(board)).toEqual([]);
          expect(hasLegalMoves(board)).toBe(true);
        }
      });

      test('void cells hold no content, and every other cell is a real playable piece', () => {
        const board = generateLevel(7, config);
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (isVoidCell(r, c)) {
              expect(board[r][c].type).toBe('void');
              expect(board[r][c].matchType).toBeUndefined();
            } else {
              expect(board[r][c].type).toBe('normal');
              expect(board[r][c].matchType).toBeDefined();
            }
          }
        }
      });

      test('blockers never land on a void cell', () => {
        const board = generateLevel(5, { ...config, blockerCount: 4, blockerMatchType: 'cling', blockerHitsToClear: 1 });
        const blockers = board.flat().filter((p) => p.type === 'blocker');
        expect(blockers.length).toBeGreaterThan(0);
        board.forEach((row, r) =>
          row.forEach((p, c) => {
            if (p.type === 'blocker') expect(isVoidCell(r, c)).toBe(false);
          })
        );
      });

      test('the same seed reproduces an identical shaped board', () => {
        expect(generateLevel(11, config)).toEqual(generateLevel(11, config));
      });
    });
  }
});
