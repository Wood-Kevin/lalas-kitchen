import {
  computeLevelMapCurveSegments,
  computeLevelMapNodePositions,
  computeLevelMapVisibleRange,
  computeScrollOffsetToCenter,
  curveSegmentToPathD,
  levelMapContentHeight,
  sampleCurveSegment,
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

describe('computeLevelMapCurveSegments', () => {
  test('yields one fewer segment than points', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 30 }];
    expect(computeLevelMapCurveSegments(points)).toHaveLength(2);
  });

  test('fewer than two points yields no segments', () => {
    expect(computeLevelMapCurveSegments([])).toEqual([]);
    expect(computeLevelMapCurveSegments([{ x: 0, y: 0 }])).toEqual([]);
  });

  // The curve must pass through every real node center, not just near
  // them — the same guarantee the old straight segments trivially had, and
  // the whole point of Catmull-Rom over a raw/approximating spline.
  test('every segment starts and ends exactly on its two real node points', () => {
    const points = [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 120, y: 40 }, { x: 200, y: 200 }];
    const segments = computeLevelMapCurveSegments(points);
    expect(segments[0].start).toEqual(points[0]);
    expect(segments[0].end).toEqual(points[1]);
    expect(segments[1].start).toEqual(points[1]);
    expect(segments[1].end).toEqual(points[2]);
    expect(segments[2].start).toEqual(points[2]);
    expect(segments[2].end).toEqual(points[3]);
  });

  // A degenerate 2-point "curve" has no real neighbor on either side —
  // both p0 and p3 fall back to the segment's own nearer endpoint (see the
  // function's own boundary-handling comment). Sanity check this produces
  // a straight line (control points sitting exactly on the start-end line),
  // not a NaN or a wild handle from an undefined neighbor.
  test('a 2-point path (both boundary fallbacks at once) still produces a straight, sane segment', () => {
    const segments = computeLevelMapCurveSegments([{ x: 0, y: 0 }, { x: 90, y: 0 }]);
    expect(segments).toHaveLength(1);
    const { control1, control2 } = segments[0];
    expect(control1.y).toBe(0);
    expect(control2.y).toBe(0);
    expect(Number.isFinite(control1.x)).toBe(true);
    expect(Number.isFinite(control2.x)).toBe(true);
  });

  // Collinear points are the real regression case for a Catmull-Rom
  // implementation bug: a curve through 3+ points on a straight vertical
  // line should stay exactly on that line, not bow outward — every control
  // point's x must equal the shared x.
  test('collinear points produce a curve that stays on the line, not bowing outward', () => {
    const points = [{ x: 40, y: 0 }, { x: 40, y: 100 }, { x: 40, y: 200 }, { x: 40, y: 300 }];
    const segments = computeLevelMapCurveSegments(points);
    for (const segment of segments) {
      expect(segment.control1.x).toBe(40);
      expect(segment.control2.x).toBe(40);
    }
  });

  test('is deterministic — the same points always produce the same curve', () => {
    const points = [{ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 90, y: 10 }];
    expect(computeLevelMapCurveSegments(points)).toEqual(computeLevelMapCurveSegments(points));
  });
});

describe('curveSegmentToPathD', () => {
  test('formats a valid single-segment cubic-bezier SVG path string', () => {
    const d = curveSegmentToPathD({
      start: { x: 0, y: 0 },
      control1: { x: 10, y: 5 },
      control2: { x: 20, y: 15 },
      end: { x: 30, y: 20 },
    });
    expect(d).toBe('M 0 0 C 10 5, 20 15, 30 20');
  });
});

describe('sampleCurveSegment', () => {
  const segment = {
    start: { x: 0, y: 0 },
    control1: { x: 10, y: 20 },
    control2: { x: 30, y: 20 },
    end: { x: 40, y: 0 },
  };

  test('returns steps + 1 points, including both real endpoints exactly', () => {
    const points = sampleCurveSegment(segment, 8);
    expect(points).toHaveLength(9);
    expect(points[0]).toEqual(segment.start);
    expect(points[8]).toEqual(segment.end);
  });

  test('a straight (collinear control points) segment samples points that stay exactly on the line', () => {
    const straight = {
      start: { x: 0, y: 0 },
      control1: { x: 10, y: 0 },
      control2: { x: 20, y: 0 },
      end: { x: 30, y: 0 },
    };
    const points = sampleCurveSegment(straight, 5);
    for (const point of points) {
      expect(point.y).toBe(0);
    }
  });

  test('is deterministic — the same segment and step count always sample identically', () => {
    expect(sampleCurveSegment(segment, 8)).toEqual(sampleCurveSegment(segment, 8));
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

describe('computeLevelMapVisibleRange', () => {
  // The whole point of this function: a deep save must not fall back to
  // rendering every node, which is exactly the reported real-device lag
  // this was built to fix.
  test('a deep save at the top of the scroll only needs a small window, not the whole count', () => {
    const range = computeLevelMapVisibleRange(0, 800, 100, 0);
    expect(range).toEqual({ startIndex: 0, endIndex: 4 });
  });

  test('a larger buffer widens the range on both sides', () => {
    const range = computeLevelMapVisibleRange(0, 800, 100, 230);
    expect(range).toEqual({ startIndex: 0, endIndex: 5 });
  });

  // Scrolled deep into a long save: the range tracks the scroll position,
  // not the top of the content, and stays small — never anywhere close to
  // the full 100-node count.
  test('scrolling deep into a long save windows around the scroll position, not the full count', () => {
    const range = computeLevelMapVisibleRange(5000, 800, 100, 0);
    expect(range).toEqual({ startIndex: 21, endIndex: 26 });
    expect(range.endIndex - range.startIndex).toBeLessThan(100);
  });

  test('startIndex never goes negative and endIndex never exceeds count, even with a huge buffer', () => {
    const range = computeLevelMapVisibleRange(0, 800, 10, 100000);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(10);
  });

  test('a not-yet-measured viewport (height 0) falls back to the full range rather than rendering nothing', () => {
    expect(computeLevelMapVisibleRange(0, 0, 20, 200)).toEqual({ startIndex: 0, endIndex: 20 });
  });

  test('zero levels yields an empty range', () => {
    expect(computeLevelMapVisibleRange(0, 800, 0, 200)).toEqual({ startIndex: 0, endIndex: 0 });
  });

  test('is deterministic — the same inputs always produce the same range', () => {
    expect(computeLevelMapVisibleRange(1200, 700, 60, 300)).toEqual(
      computeLevelMapVisibleRange(1200, 700, 60, 300)
    );
  });
});
