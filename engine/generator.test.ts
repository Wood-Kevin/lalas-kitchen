import { generateLevel, GeneratorConfig } from './generator';
import { checkMatches, hasLegalMoves } from './matrix';

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
