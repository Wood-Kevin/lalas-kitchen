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
