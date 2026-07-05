import { DRAG_NEIGHBOR_DELTA, resolveDragDirection, resolveDragTarget } from './dragDirection';

const THRESHOLD = 20;

describe('resolveDragDirection', () => {
  test('a drag below the threshold on both axes targets nothing', () => {
    expect(resolveDragDirection(5, 5, THRESHOLD)).toBeNull();
    expect(resolveDragDirection(-19, 0, THRESHOLD)).toBeNull();
    expect(resolveDragDirection(0, 0, THRESHOLD)).toBeNull();
  });

  test('a clear horizontal drag resolves left/right by sign', () => {
    expect(resolveDragDirection(40, 0, THRESHOLD)).toBe('right');
    expect(resolveDragDirection(-40, 0, THRESHOLD)).toBe('left');
  });

  test('a clear vertical drag resolves up/down by sign (+y is downward)', () => {
    expect(resolveDragDirection(0, 40, THRESHOLD)).toBe('down');
    expect(resolveDragDirection(0, -40, THRESHOLD)).toBe('up');
  });

  test('a diagonal drag collapses to whichever axis dominates', () => {
    // Mostly-right, drifting down: still 'right'.
    expect(resolveDragDirection(50, 18, THRESHOLD)).toBe('right');
    // Mostly-down, drifting left: 'down'.
    expect(resolveDragDirection(-15, 45, THRESHOLD)).toBe('down');
    // Mostly-up, drifting right: 'up'.
    expect(resolveDragDirection(12, -33, THRESHOLD)).toBe('up');
  });

  test('an exact 45-degree tie resolves deterministically to horizontal', () => {
    expect(resolveDragDirection(30, 30, THRESHOLD)).toBe('right');
    expect(resolveDragDirection(-30, 30, THRESHOLD)).toBe('left');
    expect(resolveDragDirection(30, -30, THRESHOLD)).toBe('right');
    expect(resolveDragDirection(-30, -30, THRESHOLD)).toBe('left');
  });

  test('threshold is measured against the dominant axis, not vector length', () => {
    // Dominant axis (x = 22) clears the 20px threshold even though a small
    // perpendicular drift keeps the finger from pointing perfectly straight.
    expect(resolveDragDirection(22, 8, THRESHOLD)).toBe('right');
    // Dominant axis (y = 15) is under threshold; the larger vector length from
    // the diagonal must NOT be enough to commit.
    expect(resolveDragDirection(10, 15, THRESHOLD)).toBeNull();
  });

  test('exactly at the threshold counts as committed', () => {
    expect(resolveDragDirection(20, 0, THRESHOLD)).toBe('right');
    expect(resolveDragDirection(0, -20, THRESHOLD)).toBe('up');
  });

  test('every direction maps to exactly one orthogonal neighbour delta', () => {
    expect(DRAG_NEIGHBOR_DELTA.up).toEqual({ dRow: -1, dCol: 0 });
    expect(DRAG_NEIGHBOR_DELTA.down).toEqual({ dRow: 1, dCol: 0 });
    expect(DRAG_NEIGHBOR_DELTA.left).toEqual({ dRow: 0, dCol: -1 });
    expect(DRAG_NEIGHBOR_DELTA.right).toEqual({ dRow: 0, dCol: 1 });
  });
});

// resolveDragTarget is the single "does this release land a swap?" decision.
// Tile's onFinalize branches on it: a NON-NULL target means a swap commits and
// re-renders, so the position effect folds the finger-offset back on the grid
// slide's own clock — onFinalize must leave the offset alone (no competing
// decay, which was the drag "jump"). A NULL target means nothing re-renders, so
// onFinalize is the only thing that can spring the tile back. These tests pin
// that control-flow decision itself; the actual folded animation timing is
// covered live in docs/verification/drag-swap-timing (not replicated here).
describe('resolveDragTarget — the release spring-back-or-commit decision', () => {
  // An interior origin with room to move in every direction, on a 5x8 board
  // (the real seed-1/level-1 geometry).
  const ORIGIN = { row: 3, col: 2 };
  const ROWS = 8;
  const COLS = 5;

  test('a drag resolving to a real in-bounds neighbour returns it → onFinalize does NOT spring back', () => {
    // Firm drag in each direction lands the adjacent cell; a truthy target is
    // exactly the "leave the offset for the re-render to fold" branch.
    expect(resolveDragTarget(0, 40, ORIGIN, ROWS, COLS, THRESHOLD)).toEqual({ row: 4, col: 2 });
    expect(resolveDragTarget(0, -40, ORIGIN, ROWS, COLS, THRESHOLD)).toEqual({ row: 2, col: 2 });
    expect(resolveDragTarget(40, 0, ORIGIN, ROWS, COLS, THRESHOLD)).toEqual({ row: 3, col: 3 });
    expect(resolveDragTarget(-40, 0, ORIGIN, ROWS, COLS, THRESHOLD)).toEqual({ row: 3, col: 1 });
  });

  test('a drag below the commit threshold returns null → onFinalize springs the tile back', () => {
    // No neighbour is committed, so nothing re-renders — the tile must return to
    // rest itself. This is the only case where onFinalize animates the offset.
    expect(resolveDragTarget(8, 5, ORIGIN, ROWS, COLS, THRESHOLD)).toBeNull();
    expect(resolveDragTarget(0, 0, ORIGIN, ROWS, COLS, THRESHOLD)).toBeNull();
  });

  test('a drag off the board edge returns null → onFinalize springs the tile back', () => {
    // Past-threshold but the target cell is off-grid: same no-commit, no-render,
    // spring-back branch as an under-threshold drag.
    expect(resolveDragTarget(0, -40, { row: 0, col: 2 }, ROWS, COLS, THRESHOLD)).toBeNull(); // up off the top
    expect(resolveDragTarget(0, 40, { row: 7, col: 2 }, ROWS, COLS, THRESHOLD)).toBeNull(); // down off the bottom
    expect(resolveDragTarget(40, 0, { row: 3, col: 4 }, ROWS, COLS, THRESHOLD)).toBeNull(); // right off the edge
    expect(resolveDragTarget(-40, 0, { row: 3, col: 0 }, ROWS, COLS, THRESHOLD)).toBeNull(); // left off the edge
  });

  test('the diagonal-collapse + tie rules carry through to the committed target', () => {
    // Same dominant-axis rule resolveDragDirection is tested on, but asserted at
    // the level onFinalize/Board actually consume: the resolved neighbour cell.
    expect(resolveDragTarget(50, 18, ORIGIN, ROWS, COLS, THRESHOLD)).toEqual({ row: 3, col: 3 }); // mostly-right
    expect(resolveDragTarget(-15, 45, ORIGIN, ROWS, COLS, THRESHOLD)).toEqual({ row: 4, col: 2 }); // mostly-down
    expect(resolveDragTarget(30, 30, ORIGIN, ROWS, COLS, THRESHOLD)).toEqual({ row: 3, col: 3 }); // 45° tie → horizontal
  });
});
