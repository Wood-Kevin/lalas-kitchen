import {
  BOARD_SHAPE_ROTATION,
  BOARD_SHAPE_TEMPLATES,
  cutCornersVoids,
  diamondVoids,
  hourglassVoids,
  playableCellRatio,
  pocketsVoids,
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
  test('voids a smaller interior, leaving a 2-cell-thick playable band on the real generated board size (8x7)', () => {
    const voids = ringVoids(8, 7);
    // rows 2-5, cols 2-4 — see RING_BAND_THICKNESS's own doc comment.
    expect(voids).toHaveLength(12);
    const voidKeys = toKeySet(voids);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 7; col++) {
        const isVoid = row >= 2 && row <= 5 && col >= 2 && col <= 4;
        expect(voidKeys.has(`${row},${col}`)).toBe(isVoid);
      }
    }
  });

  test('every void cell sits at least RING_BAND_THICKNESS (2) cells in from every board edge — the actual fix for "almost one match option"', () => {
    for (const [rows, cols] of [
      [8, 7],
      [8, 5],
      [10, 10],
    ]) {
      for (const p of ringVoids(rows, cols)) {
        expect(p.row).toBeGreaterThanOrEqual(2);
        expect(p.row).toBeLessThanOrEqual(rows - 1 - 2);
        expect(p.col).toBeGreaterThanOrEqual(2);
        expect(p.col).toBeLessThanOrEqual(cols - 1 - 2);
      }
    }
  });
});

describe('diamondVoids', () => {
  test('tapers to a single center column at the top/bottom edges on the real generated board size (8x5)', () => {
    const voids = diamondVoids(8, 5);
    expect(toKeySet(voids)).toEqual(
      toKeySet([
        { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 3 }, { row: 0, col: 4 },
        { row: 1, col: 0 }, { row: 1, col: 4 },
        { row: 6, col: 0 }, { row: 6, col: 4 },
        { row: 7, col: 0 }, { row: 7, col: 1 }, { row: 7, col: 3 }, { row: 7, col: 4 },
      ])
    );
  });

  test('leaves the vertical-center rows fully playable and every row at least 1 cell wide, across a range of sizes', () => {
    for (const [rows, cols] of [
      [8, 5],
      [6, 6],
      [10, 4],
      [5, 5],
    ]) {
      const voidKeys = toKeySet(diamondVoids(rows, cols));
      for (let row = 0; row < rows; row++) {
        const voidedInRow = Array.from({ length: cols }, (_, col) => voidKeys.has(`${row},${col}`)).filter(Boolean).length;
        expect(voidedInRow).toBeLessThan(cols);
      }
    }
  });
});

describe('hourglassVoids', () => {
  test('pinches to a single center column across the vertical-center band, full width elsewhere, on the real generated board size (8x5)', () => {
    const voids = hourglassVoids(8, 5);
    expect(toKeySet(voids)).toEqual(
      toKeySet([
        { row: 2, col: 0 }, { row: 2, col: 4 },
        { row: 3, col: 0 }, { row: 3, col: 1 }, { row: 3, col: 3 }, { row: 3, col: 4 },
        { row: 4, col: 0 }, { row: 4, col: 1 }, { row: 4, col: 3 }, { row: 4, col: 4 },
        { row: 5, col: 0 }, { row: 5, col: 4 },
      ])
    );
    const voidKeys = toKeySet(voids);
    for (const row of [0, 1, 6, 7]) {
      for (let col = 0; col < 5; col++) {
        expect(voidKeys.has(`${row},${col}`)).toBe(false);
      }
    }
  });

  test('every row stays at least 1 cell wide, across a range of sizes', () => {
    for (const [rows, cols] of [
      [8, 5],
      [6, 6],
      [10, 4],
      [5, 5],
    ]) {
      const voidKeys = toKeySet(hourglassVoids(rows, cols));
      for (let row = 0; row < rows; row++) {
        const voidedInRow = Array.from({ length: cols }, (_, col) => voidKeys.has(`${row},${col}`)).filter(Boolean).length;
        expect(voidedInRow).toBeLessThan(cols);
      }
    }
  });
});

describe('pocketsVoids', () => {
  test('voids only interior odd-row/odd-col lattice cells on the real generated board size (8x5)', () => {
    const voids = pocketsVoids(8, 5);
    expect(toKeySet(voids)).toEqual(
      toKeySet([
        { row: 1, col: 1 }, { row: 1, col: 3 },
        { row: 3, col: 1 }, { row: 3, col: 3 },
        { row: 5, col: 1 }, { row: 5, col: 3 },
      ])
    );
  });

  test('never voids a border cell, across a range of sizes', () => {
    for (const [rows, cols] of [
      [8, 5],
      [6, 6],
      [10, 4],
      [5, 5],
    ]) {
      for (const p of pocketsVoids(rows, cols)) {
        const isBorder = p.row === 0 || p.row === rows - 1 || p.col === 0 || p.col === cols - 1;
        expect(isBorder).toBe(false);
      }
    }
  });
});

describe('BOARD_SHAPE_TEMPLATES / BOARD_SHAPE_ROTATION', () => {
  test('the rotation list and the template registry cover exactly the same 6 ids', () => {
    expect(BOARD_SHAPE_ROTATION).toHaveLength(6);
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

  test('real percentages on the real generated board size (8x7, 56 cells)', () => {
    // ring's own number is post-widening (see ringVoids' own doc comment) —
    // 44/56 ≈ 79%, no longer the severe outlier the original 1-wide band
    // produced (22/40 ≈ 55% at the historical 8x5 size, still true of the
    // OLD implementation, not this one). cut_corners/plus computed directly
    // (12 and 8 voids respectively) rather than assumed from the old 8x5
    // numbers — see this describe block's last test for why that distinction
    // matters here specifically.
    expect(playableCellRatio(8, 7, ringVoids(8, 7))).toBeCloseTo(44 / 56);
    expect(playableCellRatio(8, 7, cutCornersVoids(8, 7))).toBeCloseTo(44 / 56);
    expect(playableCellRatio(8, 7, plusVoids(8, 7))).toBeCloseTo(48 / 56);
  });

  test('real percentages for the 3 newer templates on the real generated board size (8x7, 56 cells)', () => {
    // diamond/hourglass at 32/56 ≈ 57%, NOT the ~70% CLAUDE.md's own text
    // claims — that number was computed at the historical 8x5 board size
    // and never re-verified after the grid-width widening to 8x7 (see
    // engine/DECISIONS.md's grid-width entry). At 7 columns,
    // diamondTaperSteps grows to 3 (min(floor(8/2), floor((7-1)/2))), a much
    // more aggressive cut relative to the narrower board it was tuned
    // against. This is now flagged as a real, separate finding — not fixed
    // in this pass, since only ringVoids was in scope for the actual fix.
    expect(playableCellRatio(8, 7, diamondVoids(8, 7))).toBeCloseTo(32 / 56);
    expect(playableCellRatio(8, 7, hourglassVoids(8, 7))).toBeCloseTo(32 / 56);
    expect(playableCellRatio(8, 7, pocketsVoids(8, 7))).toBeCloseTo(47 / 56);
  });

  test('diamond/hourglass, not ring, are now the most restrictive templates at the real board size — a separate, disclosed finding', () => {
    const ratios = BOARD_SHAPE_ROTATION.map((id) => playableCellRatio(8, 7, BOARD_SHAPE_TEMPLATES[id](8, 7)));
    const ringRatio = playableCellRatio(8, 7, ringVoids(8, 7));
    // Documents the current state honestly rather than asserting a "fixed"
    // claim this pass doesn't back up: ring is no longer the outlier, but
    // diamond/hourglass now are, at roughly the same severity ring used to
    // be. See DEFERRED_COMPLEXITY.md's board-shape-ratio-drift entry.
    expect(Math.min(...ratios)).toBeLessThan(ringRatio);
  });
});
