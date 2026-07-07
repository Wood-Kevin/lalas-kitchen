import {
  BOARD_SHAPE_ROTATION,
  BOARD_SHAPE_TEMPLATES,
  cutCornersVoids,
  playableCellRatio,
  plusVoids,
  ringVoids,
} from './boardShapes';

function toKeySet(positions: { row: number; col: number }[]): Set<string> {
  return new Set(positions.map((p) => `${p.row},${p.col}`));
}

describe('cutCornersVoids', () => {
  test('voids exactly the corner L-shapes on the real generated board size (8x5)', () => {
    const voids = cutCornersVoids(8, 5);
    expect(toKeySet(voids)).toEqual(
      toKeySet([
        { row: 0, col: 0 },
        { row: 1, col: 0 },
        { row: 0, col: 1 },
        { row: 0, col: 4 },
        { row: 1, col: 4 },
        { row: 0, col: 3 },
        { row: 7, col: 0 },
        { row: 6, col: 0 },
        { row: 7, col: 1 },
        { row: 7, col: 4 },
        { row: 6, col: 4 },
        { row: 7, col: 3 },
      ])
    );
    expect(voids).toHaveLength(12);
  });

  test('every void position is in-bounds and unique, across a range of sizes', () => {
    for (const [rows, cols] of [
      [8, 5],
      [6, 6],
      [10, 4],
      [5, 5],
    ]) {
      const voids = cutCornersVoids(rows, cols);
      const keys = voids.map((p) => `${p.row},${p.col}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const p of voids) {
        expect(p.row).toBeGreaterThanOrEqual(0);
        expect(p.row).toBeLessThan(rows);
        expect(p.col).toBeGreaterThanOrEqual(0);
        expect(p.col).toBeLessThan(cols);
      }
    }
  });
});

describe('plusVoids', () => {
  test('voids exactly the 4 corner blocks on the real generated board size (8x5)', () => {
    const voids = plusVoids(8, 5);
    const expectedRows = [0, 1, 6, 7];
    const expectedCols = [0, 4];
    const expected = expectedRows.flatMap((row) => expectedCols.map((col) => ({ row, col })));
    expect(toKeySet(voids)).toEqual(toKeySet(expected));
    expect(voids).toHaveLength(8);
  });

  test('leaves a full-height middle column band and a full-width middle row band playable', () => {
    const voids = plusVoids(8, 5);
    const voidKeys = toKeySet(voids);
    // Middle column band (cols 1-3) must be void-free for every row.
    for (let row = 0; row < 8; row++) {
      for (const col of [1, 2, 3]) {
        expect(voidKeys.has(`${row},${col}`)).toBe(false);
      }
    }
    // Middle row band (rows 2-5) must be void-free for every column.
    for (let col = 0; col < 5; col++) {
      for (const row of [2, 3, 4, 5]) {
        expect(voidKeys.has(`${row},${col}`)).toBe(false);
      }
    }
  });
});

describe('ringVoids', () => {
  test('voids exactly the interior, leaving a 1-cell playable frame on the real generated board size (8x5)', () => {
    const voids = ringVoids(8, 5);
    expect(voids).toHaveLength(18);
    const voidKeys = toKeySet(voids);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 5; col++) {
        const isBorder = row === 0 || row === 7 || col === 0 || col === 4;
        expect(voidKeys.has(`${row},${col}`)).toBe(!isBorder);
      }
    }
  });
});

describe('BOARD_SHAPE_TEMPLATES / BOARD_SHAPE_ROTATION', () => {
  test('the rotation list and the template registry cover exactly the same 3 ids', () => {
    expect(BOARD_SHAPE_ROTATION).toHaveLength(3);
    expect(new Set(BOARD_SHAPE_ROTATION)).toEqual(new Set(Object.keys(BOARD_SHAPE_TEMPLATES)));
  });

  test('every registered template is callable and returns positions for the real board size', () => {
    for (const id of BOARD_SHAPE_ROTATION) {
      const voids = BOARD_SHAPE_TEMPLATES[id](8, 5);
      expect(voids.length).toBeGreaterThan(0);
    }
  });
});

describe('playableCellRatio', () => {
  test('a plain rectangle (no voids) is fully playable', () => {
    expect(playableCellRatio(8, 5)).toBe(1);
    expect(playableCellRatio(8, 5, [])).toBe(1);
  });

  test('real percentages on the real generated board size (8x5, 40 cells) — the exact numbers behind the ring-unfairness report', () => {
    expect(playableCellRatio(8, 5, ringVoids(8, 5))).toBeCloseTo(22 / 40); // 55%
    expect(playableCellRatio(8, 5, cutCornersVoids(8, 5))).toBeCloseTo(28 / 40); // 70%
    expect(playableCellRatio(8, 5, plusVoids(8, 5))).toBeCloseTo(32 / 40); // 80%
  });

  test('ring is the most restrictive of the 3 templates at this board size', () => {
    const ratios = BOARD_SHAPE_ROTATION.map((id) => playableCellRatio(8, 5, BOARD_SHAPE_TEMPLATES[id](8, 5)));
    expect(Math.min(...ratios)).toBe(playableCellRatio(8, 5, ringVoids(8, 5)));
  });
});
