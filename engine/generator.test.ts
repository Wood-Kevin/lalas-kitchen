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

describe('generateLevel — clustered blocker placement (denial-zone-eligible levels)', () => {
  // BFS connectivity check over 4-directional adjacency — the actual
  // contiguity claim clusterBlockers makes.
  function isOneContiguousRegion(positions: Position[]): boolean {
    if (positions.length <= 1) return true;
    const key = (p: Position): string => `${p.row},${p.col}`;
    const remaining = new Set(positions.map(key));
    const byKey = new Map(positions.map((p) => [key(p), p]));
    const start = positions[0];
    const queue: Position[] = [start];
    remaining.delete(key(start));
    const offsets = [
      { row: -1, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: -1 },
      { row: 0, col: 1 },
    ];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (const o of offsets) {
        const nk = `${cur.row + o.row},${cur.col + o.col}`;
        if (remaining.has(nk)) {
          remaining.delete(nk);
          queue.push(byKey.get(nk)!);
        }
      }
    }
    return remaining.size === 0;
  }

  const clusterConfig: GeneratorConfig = {
    rows: 8,
    cols: 8,
    pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
    blockerCount: 4,
    blockerMatchType: 'cling',
    blockerHitsToClear: 1,
    clusterBlockers: true,
  };

  test('places blockers as one contiguous adjacent region, not scattered', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const board = generateLevel(seed, clusterConfig);
      const blockerPositions: Position[] = [];
      board.forEach((row, r) =>
        row.forEach((p, c) => {
          if (p.type === 'blocker') blockerPositions.push({ row: r, col: c });
        })
      );
      expect(blockerPositions).toHaveLength(4);
      expect(isOneContiguousRegion(blockerPositions)).toBe(true);
    }
  });

  test('still places the requested count with the right matchType and hit count', () => {
    const board = generateLevel(7, clusterConfig);
    const blockers = board.flat().filter((p) => p.type === 'blocker');
    expect(blockers).toHaveLength(4);
    for (const blocker of blockers) {
      expect(blocker.matchType).toBe('cling');
      expect(blocker.hitsRemaining).toBe(1);
    }
  });

  test('a clustered board still never contains an accidental match on creation', () => {
    for (const seed of [1, 2, 3, 42, 999, 123456]) {
      const board = generateLevel(seed, clusterConfig);
      expect(checkMatches(board)).toEqual([]);
    }
  });

  test('a clustered board still always has at least one legal move', () => {
    for (const seed of [1, 2, 3, 42, 999, 123456]) {
      const board = generateLevel(seed, clusterConfig);
      expect(hasLegalMoves(board)).toBe(true);
    }
  });

  test('the same seed reproduces an identical clustered board', () => {
    expect(generateLevel(11, clusterConfig)).toEqual(generateLevel(11, clusterConfig));
  });

  test('a clustered region never lands on a void cell, even reseeding across a disconnected shaped board', () => {
    // A 7x7 board voided down to two disconnected pockets (top-left 3x3 block
    // and bottom-right 3x3 block, separated by a void moat) — big enough that
    // no single pocket can hold all 6 requested blockers, forcing the
    // reseed-a-new-region fallback to kick in at least once.
    const rows = 7;
    const cols = 7;
    const voidCells: Position[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const inTopLeft = r < 3 && c < 3;
        const inBottomRight = r >= 4 && c >= 4;
        if (!inTopLeft && !inBottomRight) voidCells.push({ row: r, col: c });
      }
    }
    const isVoidCell = (r: number, c: number): boolean => voidCells.some((p) => p.row === r && p.col === c);

    const board = generateLevel(3, {
      rows,
      cols,
      pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
      voidCells,
      blockerCount: 6,
      blockerMatchType: 'cling',
      blockerHitsToClear: 1,
      clusterBlockers: true,
    });

    const blockers = board.flat().filter((p) => p.type === 'blocker');
    expect(blockers).toHaveLength(6);
    board.forEach((row, r) =>
      row.forEach((p, c) => {
        if (p.type === 'blocker') expect(isVoidCell(r, c)).toBe(false);
      })
    );
    expect(checkMatches(board)).toEqual([]);
    expect(hasLegalMoves(board)).toBe(true);
  });

  test('omitting clusterBlockers (or setting it false) keeps the original scatter placement unchanged', () => {
    const scattered = generateLevel(7, {
      rows: 8,
      cols: 8,
      pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
      blockerCount: 4,
      blockerMatchType: 'cling',
      blockerHitsToClear: 1,
    });
    // Same seed, same everything except the flag — this is the exact
    // pre-existing "places the requested number of blockers" test's board,
    // proving the new parameter is opt-in and doesn't change default output.
    const explicitlyOff = generateLevel(7, { ...clusterConfig, blockerCount: 4, clusterBlockers: false });
    expect(explicitlyOff).toEqual(scattered);
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
