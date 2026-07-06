// Pure geometry behind components/LevelMap.tsx — same "push anything
// testable out of the component" reasoning as cascadeTiming.ts/
// dragDirection.ts/sweepAnimation.ts. No react-native-svg is installed in
// this project (see package.json), and GinghamTrim.tsx already establishes
// the house convention of reproducing a mockup effect with plain Views
// rather than reaching for a new rendering dependency (its own comment:
// "reproduced with plain Views since no gradient dependency was added") —
// so the winding path is a series of straight rotated-View segments between
// node centers, not a smooth SVG bezier curve. Still reads as a winding
// path (it zigzags left/right/center down the screen); it just doesn't
// curve within a single segment.

export interface LevelMapNodePosition {
  // 0..1 fraction across whatever usable width the caller has (component
  // decides the actual pixel inset/diameter math) — kept fraction-based, not
  // a fixed pixel value, so this stays correct across real device widths
  // instead of assuming one mockup screen size.
  xFraction: number;
  // Pixel offset down the scrollable content, in list order (index 0 is the
  // lowest level number, matching resolveLevelMapIndices' own ascending
  // sort) — the map reads top-to-bottom in increasing level order, same
  // direction the old All Levels list already read in.
  y: number;
}

// Vertical distance between consecutive node centers, and the gap above the
// first node — both fixed layout constants (not derived from screen size),
// matching the approved design's own fixed node spacing.
const NODE_SPACING_Y = 210;
const TOP_PADDING = 100;

// A repeating left/center/right/center snake cycle — deterministic and
// testable, not randomized, so the same level list always lays out
// identically. Values are fractions across the usable width; 0.5 is dead
// center, the two extremes stay well inside the edges so a node's medallion
// (which has real width) never clips the screen.
const X_PATTERN = [0.5, 0.16, 0.84, 0.5, 0.84, 0.16];

export function computeLevelMapNodePositions(count: number): LevelMapNodePosition[] {
  return Array.from({ length: count }, (_, i) => ({
    xFraction: X_PATTERN[i % X_PATTERN.length],
    y: TOP_PADDING + i * NODE_SPACING_Y,
  }));
}

// Total scrollable content height for `count` nodes — symmetric top/bottom
// padding so the last node isn't flush against the content's bottom edge,
// the same reasoning TOP_PADDING already applies to the first node.
export function levelMapContentHeight(count: number): number {
  if (count <= 0) return TOP_PADDING * 2;
  return TOP_PADDING * 2 + (count - 1) * NODE_SPACING_Y;
}

export interface LevelMapPoint {
  x: number;
  y: number;
}

export interface LevelMapPathSegment {
  // Anchored at its start point, not its center — renders as an absolutely
  // positioned `left`/`top` View of `width: length` rotated `angleDeg`
  // around its left edge (style `transformOrigin: 'left center'`, real RN
  // 0.81 support — see package.json), so the un-rotated line's left end
  // always lands exactly on the segment's real start point regardless of
  // angle.
  x: number;
  y: number;
  length: number;
  angleDeg: number;
}

// Straight-line connectors between consecutive real (pixel) node centers —
// see this file's header comment for why these are straight segments
// rather than a curved SVG path. One segment per adjacent pair, so `points`
// of length N yields N-1 segments (empty for 0 or 1 points).
export function computeLevelMapPathSegments(points: LevelMapPoint[]): LevelMapPathSegment[] {
  const segments: LevelMapPathSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    segments.push({
      x: a.x,
      y: a.y,
      length: Math.sqrt(dx * dx + dy * dy),
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }
  return segments;
}

// The scroll offset that centers a node vertically in the viewport — used to
// open the map already scrolled to the current level rather than the top of
// the list (this session's explicit ask). Clamped to 0 so a current level
// near the very top of the content never asks for a negative scroll offset.
export function computeScrollOffsetToCenter(nodeY: number, viewportHeight: number): number {
  return Math.max(0, nodeY - viewportHeight / 2);
}
