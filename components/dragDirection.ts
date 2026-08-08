// Pure geometry for drag-to-swap: given how far a finger has travelled from
// the tile it started on, decide which single adjacent neighbour (if any) the
// drag is pointing at. Kept as a standalone pure function — no React, no
// gesture library, no grid knowledge — so the ambiguous/diagonal cases can be
// pinned down in a test file rather than by dragging on a phone (see
// CLAUDE.md's testing-over-simulator philosophy). Board.tsx maps the returned
// direction onto an actual neighbour position and reuses the exact same
// applyMove path a tap does.

export type DragDirection = 'up' | 'down' | 'left' | 'right';

// Screen-space deltas → grid deltas. In React Native's coordinate space +x is
// rightward and +y is *downward*, so a downward drag (dy > 0) targets the row
// below (dRow +1). Board.tsx applies these to the origin cell.
export const DRAG_NEIGHBOR_DELTA: Record<DragDirection, { dRow: number; dCol: number }> = {
  up: { dRow: -1, dCol: 0 },
  down: { dRow: 1, dCol: 0 },
  left: { dRow: 0, dCol: -1 },
  right: { dRow: 0, dCol: 1 },
};

// Resolve a drag vector to the one neighbour it most clearly indicates, or
// null if the finger hasn't yet travelled far enough to commit.
//
// The rule is deliberately "dominant axis wins": a match-3 swap only ever
// moves a tile to an orthogonal neighbour, so a diagonal drag must collapse to
// a single axis rather than being rejected — the player shouldn't have to drag
// in a perfectly straight line. The threshold is measured against that
// dominant component (not the vector's length), so a drag counts as committed
// once it has moved `threshold` px *toward a neighbour*, without the finger
// needing to travel all the way to that neighbour's centre.
//
// An exact 45° tie (|dx| === |dy|) resolves to horizontal, chosen arbitrarily
// but fixed so the genuinely ambiguous case is deterministic — the same drag
// never flickers between two neighbours.
export function resolveDragDirection(
  dx: number,
  dy: number,
  threshold: number
): DragDirection | null {
  // Marked a worklet so the release handler in Tile.tsx can call it directly on
  // the UI thread (to decide whether a drag will commit a swap) using the exact
  // same dominant-axis + threshold rule Board applies on the JS thread — one
  // source of truth for the geometry, no duplicated tie-breaking. Still a plain
  // pure function when called from JS (Board.tsx, the tests).
  'worklet';
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  // Not far enough along either axis yet — no neighbour is clearly targeted.
  if (Math.max(absX, absY) < threshold) return null;
  if (absX >= absY) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'down' : 'up';
}

// A drag vector originating on `origin` mapped to the actual in-bounds neighbour
// cell it commits to, or null if it resolves to nothing (below threshold, or it
// would run off the board edge). This is the single "does this release land a
// swap?" decision, shared by two callers that must agree:
//   - Board.dragNeighbor, on the JS thread, for the live target highlight and
//     the release-to-applyMove handoff;
//   - Tile's onFinalize worklet, on release, to decide whether to spring the
//     finger-offset back. A non-null target means a swap will commit (or snap
//     back) and re-render, so the position effect folds the offset home on the
//     grid slide's clock — onFinalize must NOT start a second decay. A null
//     target means nothing re-renders, so onFinalize is the only thing that can
//     return the tile to rest.
// Kept a worklet so the release handler can call it on the UI thread; still a
// plain pure function from JS (Board, the tests). Bounds use a plain {row,col}
// shape rather than importing gameState's Position, so this module stays pure
// geometry with no engine dependency.
// --- The drag RAIL: what the tile visibly does while the finger is down ---
//
// resolveDragDirection above decides where a drag COMMITS; this decides how
// the tile FOLLOWS. They must agree, and originally they didn't: the follow
// was a free 2D float (dragX and dragY both tracked the finger, each clamped
// to ±1 tile), so the piece could hover diagonally over four cells while the
// axis-locked target highlight snapped between neighbours — real playtest:
// "I can move a piece basically any direction which makes a weird friction."
// A match-3 swap is an orthogonal exchange, so the follow is now a RAIL: the
// dominant axis is picked live, the perpendicular component is zeroed, and
// the piece only ever slides toward one neighbour at a time.
//
// The hysteresis keeps the rail from flickering: once an axis is chosen, the
// other axis must exceed it by this factor before the rail switches — near
// the diagonal, small jitter no longer flips the piece (or the highlight,
// which consumes the projected vector) back and forth.
export const DRAG_AXIS_HYSTERESIS = 1.3;

// 0 = no axis chosen yet (fresh drag), 1 = horizontal rail, 2 = vertical.
// Numeric rather than a string union so it lives cheaply in a shared value
// on the UI thread.
export type DragAxis = 0 | 1 | 2;

export function projectDragToRail(
  dx: number,
  dy: number,
  currentAxis: DragAxis
): { axis: DragAxis; dx: number; dy: number } {
  // A worklet for the same reason resolveDragTarget is: the pan gesture's
  // onUpdate calls this per frame on the UI thread. Plain pure function
  // from JS (the tests).
  'worklet';
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  let axis: DragAxis = currentAxis;
  if (axis === 0) {
    // Fresh drag: plain dominant axis, the same >= tie-break toward
    // horizontal resolveDragDirection uses.
    axis = absX >= absY ? 1 : 2;
  } else if (axis === 1 && absY > absX * DRAG_AXIS_HYSTERESIS) {
    axis = 2;
  } else if (axis === 2 && absX > absY * DRAG_AXIS_HYSTERESIS) {
    axis = 1;
  }
  return axis === 1 ? { axis, dx, dy: 0 } : { axis, dx: 0, dy };
}

export function resolveDragTarget(
  dx: number,
  dy: number,
  origin: { row: number; col: number },
  rows: number,
  cols: number,
  thresholdPx: number
): { row: number; col: number } | null {
  'worklet';
  const direction = resolveDragDirection(dx, dy, thresholdPx);
  if (!direction) return null;
  const delta = DRAG_NEIGHBOR_DELTA[direction];
  const target = { row: origin.row + delta.dRow, col: origin.col + delta.dCol };
  if (target.row < 0 || target.row >= rows || target.col < 0 || target.col >= cols) return null;
  return target;
}
