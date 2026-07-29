// Pure geometry behind components/LevelMap.tsx — same "push anything
// testable out of the component" reasoning as cascadeTiming.ts/
// dragDirection.ts/sweepAnimation.ts.
//
// The winding path was originally a series of straight rotated-View
// segments between node centers, matching GinghamTrim.tsx's house
// convention of reproducing a mockup effect with plain Views rather than a
// new rendering dependency — see engine/DECISIONS.md's level-map entry.
// That was revisited after a real architect request for an actual curve:
// react-native-svg is now installed (see package.json) — a real, low-risk
// choice compared to this project's other native-dependency history (the
// AdMob saga), since it's one of the native modules Expo Go itself already
// bundles, so it doesn't reintroduce the "can't load in Expo Go" regression
// that surfaced earlier this session. See engine/DECISIONS.md's
// level-map-curve entry for the full reasoning.

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
const NODE_SPACING_Y = 230;
const TOP_PADDING = 120;

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

// One cubic-bezier piece of a smooth curve through a sequence of points —
// `start`/`end` land exactly on two consecutive real node centers (a real,
// testable invariant: the curve always passes through every node, same
// guarantee the old straight segments trivially had), `control1`/`control2`
// are the Catmull-Rom-derived bezier handles that make the join between
// this segment and its neighbors read as one continuous smooth line rather
// than a visible kink at each node. One segment per adjacent point pair —
// same shape the old straight-segment array had — so LevelMap.tsx's
// existing per-segment walked/lit/locked coloring loop needed no
// restructuring, only a different render (an SVG <Path> instead of a
// rotated View) per segment.
export interface LevelMapCurveSegment {
  start: LevelMapPoint;
  control1: LevelMapPoint;
  control2: LevelMapPoint;
  end: LevelMapPoint;
}

// Catmull-Rom-to-Bezier conversion (the standard technique for a smooth
// curve that passes through every control point, not just near them, unlike
// a raw Bezier spline): each segment's handles are derived from its own two
// endpoints plus one neighbor on each side, using the well-known
// `p1 + (p2 - p0) / 6` / `p2 - (p3 - p1) / 6` formulas. A segment at either
// end of the path has no real outer neighbor, so it reuses its own nearer
// endpoint in that slot (`points[i - 1] ?? points[i]`) — the conventional
// boundary handling, equivalent to the curve's tangent flattening out
// exactly at the first/last node rather than extrapolating past it.
export function computeLevelMapCurveSegments(points: LevelMapPoint[]): LevelMapCurveSegment[] {
  const segments: LevelMapCurveSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    segments.push({
      start: p1,
      control1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      control2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      end: p2,
    });
  }
  return segments;
}

// An SVG path `d` string for exactly one curve segment — deliberately not
// the whole path joined into one string, since LevelMapPath.native.tsx
// renders each segment as its own <Path> to keep the existing per-segment
// walked/lit/locked color logic (a single joined path could only ever have
// one color).
export function curveSegmentToPathD(segment: LevelMapCurveSegment): string {
  const { start, control1, control2, end } = segment;
  return `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`;
}

// Samples `steps + 1` points along one cubic-bezier curve segment (the
// standard De Casteljau/Bernstein-polynomial evaluation), including both
// endpoints — used only by LevelMapPath.web.tsx, which has no SVG <Path> to
// draw the true curve (react-native-svg's web entry point transitively
// imports a Fabric-only codegen file Metro cannot bundle for web, a real
// break caught live — see engine/DECISIONS.md's level-map-curve entry), so
// the web fallback approximates the same curve as several short straight
// segments between consecutive sampled points instead. `steps` is the
// caller's choice of how many straight micro-segments to render per real
// curve segment — more steps reads smoother but costs more Views.
export function sampleCurveSegment(segment: LevelMapCurveSegment, steps: number): LevelMapPoint[] {
  const points: LevelMapPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    points.push({
      x: mt * mt * mt * segment.start.x + 3 * mt * mt * t * segment.control1.x + 3 * mt * t * t * segment.control2.x + t * t * t * segment.end.x,
      y: mt * mt * mt * segment.start.y + 3 * mt * mt * t * segment.control1.y + 3 * mt * t * t * segment.control2.y + t * t * t * segment.end.y,
    });
  }
  return points;
}

// The scroll offset that centers a node vertically in the viewport — used to
// open the map already scrolled to the current level rather than the top of
// the list (this session's explicit ask). Clamped to 0 so a current level
// near the very top of the content never asks for a negative scroll offset.
export function computeScrollOffsetToCenter(nodeY: number, viewportHeight: number): number {
  return Math.max(0, nodeY - viewportHeight / 2);
}
