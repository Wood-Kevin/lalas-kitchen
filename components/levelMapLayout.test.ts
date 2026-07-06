import {
  computeLevelMapNodePositions,
  computeLevelMapPathSegments,
  computeScrollOffsetToCenter,
  levelMapContentHeight,
} from './levelMapLayout';

describe('computeLevelMapNodePositions', () => {
  test('returns one position per node, in ascending y order', () => {
    const positions = computeLevelMapNodePositions(4);
    expect(positions).toHaveLength(4);
    expect(positions[0].y).toBeLessThan(positions[1].y);
    expect(positions[1].y).toBeLessThan(positions[2].y);
    expect(positions[2].y).toBeLessThan(positions[3].y);
  });

  test('every xFraction stays within the safe 0..1 range', () => {
    const positions = computeLevelMapNodePositions(12);
    for (const position of positions) {
      expect(position.xFraction).toBeGreaterThanOrEqual(0);
      expect(position.xFraction).toBeLessThanOrEqual(1);
    }
  });

  test('is deterministic — the same count always lays out identically', () => {
    expect(computeLevelMapNodePositions(6)).toEqual(computeLevelMapNodePositions(6));
  });

  test('zero nodes returns an empty layout', () => {
    expect(computeLevelMapNodePositions(0)).toEqual([]);
  });
});

describe('levelMapContentHeight', () => {
  test('grows with more nodes', () => {
    expect(levelMapContentHeight(8)).toBeGreaterThan(levelMapContentHeight(4));
  });

  test('a single node still gets top and bottom padding', () => {
    expect(levelMapContentHeight(1)).toBeGreaterThan(0);
  });

  test('is at least tall enough to contain every node position', () => {
    const count = 9;
    const positions = computeLevelMapNodePositions(count);
    const lastY = positions[positions.length - 1].y;
    expect(levelMapContentHeight(count)).toBeGreaterThan(lastY);
  });
});

describe('computeLevelMapPathSegments', () => {
  test('yields one fewer segment than points', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 30 }];
    expect(computeLevelMapPathSegments(points)).toHaveLength(2);
  });

  test('a straight vertical drop has length equal to the y delta and points straight down', () => {
    const segments = computeLevelMapPathSegments([{ x: 50, y: 0 }, { x: 50, y: 100 }]);
    expect(segments).toEqual([{ x: 50, y: 0, length: 100, angleDeg: 90 }]);
  });

  test('a straight horizontal move has angle 0', () => {
    const segments = computeLevelMapPathSegments([{ x: 0, y: 10 }, { x: 40, y: 10 }]);
    expect(segments[0].angleDeg).toBe(0);
    expect(segments[0].length).toBe(40);
  });

  test('a diagonal segment computes real pythagorean length', () => {
    const segments = computeLevelMapPathSegments([{ x: 0, y: 0 }, { x: 3, y: 4 }]);
    expect(segments[0].length).toBe(5);
  });

  test('fewer than two points yields no segments', () => {
    expect(computeLevelMapPathSegments([])).toEqual([]);
    expect(computeLevelMapPathSegments([{ x: 0, y: 0 }])).toEqual([]);
  });
});

describe('computeScrollOffsetToCenter', () => {
  test('centers a node well below the top of a tall viewport', () => {
    expect(computeScrollOffsetToCenter(1000, 800)).toBe(600);
  });

  test('clamps to 0 rather than a negative offset for a node near the very top', () => {
    expect(computeScrollOffsetToCenter(50, 800)).toBe(0);
  });
});
