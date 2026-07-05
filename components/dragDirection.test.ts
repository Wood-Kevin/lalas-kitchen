import { DRAG_NEIGHBOR_DELTA, resolveDragDirection } from './dragDirection';

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
