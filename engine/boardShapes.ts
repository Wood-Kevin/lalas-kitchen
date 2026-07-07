import { Position } from './matrix';

// A small, curated set of reusable board-shape templates — the same
// curated-set-over-invented-variety approach every other piece of content
// variety in this project uses (recipe cards, blocker ids, tutorial content).
// Each template is a pure function of (rows, cols) -> the Position[] to hand
// generateLevel's own voidCells (see generator.ts's GeneratorConfig) — it has
// no opinion on *when* a level should use one, that's appPersistence.ts's
// generatedShapeId gate. rows/cols are threaded through rather than hardcoded
// so a template stays correct even though it's only ever exercised today at
// the generated-level board's fixed 8x5 size (see appPersistence.ts's
// buildGeneratedLevelConfig doc on why board size itself never varies).

export type BoardShapeId = 'cut_corners' | 'plus' | 'ring';

// Voids a small L-shaped notch at each of the 4 corners: the corner cell
// itself plus its two orthogonal neighbours (one step along each edge). A
// single-cell corner void reads as barely visible on a screenshot; three
// cells per corner gives the "cut corner" look real weight without eating
// deep into the board. Deduped through a Set since a very narrow/short board
// could otherwise double-count a cell shared between two adjacent corners.
export function cutCornersVoids(rows: number, cols: number): Position[] {
  const seen = new Set<string>();
  const voids: Position[] = [];
  const add = (row: number, col: number): void => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) return;
    const key = `${row},${col}`;
    if (seen.has(key)) return;
    seen.add(key);
    voids.push({ row, col });
  };

  for (const row of [0, rows - 1]) {
    const rowStep = row === 0 ? 1 : -1;
    for (const col of [0, cols - 1]) {
      const colStep = col === 0 ? 1 : -1;
      add(row, col);
      add(row + rowStep, col);
      add(row, col + colStep);
    }
  }
  return voids;
}

// Voids the 4 corner blocks outside a full-height middle column band and a
// full-width middle row band, leaving a cross/plus of playable cells — the
// same shape the hand-built "Cutting Board" showcase level uses, generalized
// to any rows x cols instead of that level's own hand-picked 7x7 corners.
// Corner block size is proportional to board size (a quarter of the shorter
// run in each direction, floored, minimum 1) rather than a fixed constant, so
// the arms stay a sensible width instead of vanishing on a narrow board.
export function plusVoids(rows: number, cols: number): Position[] {
  const cornerRowHeight = Math.max(1, Math.floor(rows / 4));
  const cornerColWidth = Math.max(1, Math.floor(cols / 4));
  const voids: Position[] = [];

  for (let row = 0; row < rows; row++) {
    const inRowCorner = row < cornerRowHeight || row >= rows - cornerRowHeight;
    if (!inRowCorner) continue;
    for (let col = 0; col < cols; col++) {
      const inColCorner = col < cornerColWidth || col >= cols - cornerColWidth;
      if (inColCorner) voids.push({ row, col });
    }
  }
  return voids;
}

// Voids every interior cell, leaving a 1-cell-thick playable frame/ring
// around the board's own edge.
export function ringVoids(rows: number, cols: number): Position[] {
  const voids: Position[] = [];
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      voids.push({ row, col });
    }
  }
  return voids;
}

export const BOARD_SHAPE_TEMPLATES: Record<BoardShapeId, (rows: number, cols: number) => Position[]> = {
  cut_corners: cutCornersVoids,
  plus: plusVoids,
  ring: ringVoids,
};

// Deterministic rotation order — appPersistence.ts's generatedShapeId cycles
// through this list by index rather than picking randomly, the same
// deterministic-by-levelNumber shape every other generated-level lever
// (blocker id rotation, objective targetMatchType rotation) already uses.
export const BOARD_SHAPE_ROTATION: BoardShapeId[] = ['cut_corners', 'plus', 'ring'];

// How much of a rows x cols rectangle a shape template actually leaves
// playable, as a 0-1 fraction. Real playtesting on a generated `ring` level
// (55% playable at the fixed 8x5 generated-board size — the most severe of
// the 3 templates, vs. cut_corners' 70% and plus's 80%) reported it as
// genuinely unfair, not just visually different: appPersistence.ts's
// difficulty ramp (generatedTargetCount/generatedMovesLimit) was computed
// purely from levelNumber, with zero awareness of how many cells a shape
// template had just removed. This is that missing awareness, factored out as
// its own pure geometry function (rather than inlined at the one call site)
// so it's independently testable against each template the same way the
// templates themselves are. voidCells defaults to empty so a plain rectangle
// (no shape applied) always yields exactly 1.
export function playableCellRatio(rows: number, cols: number, voidCells: Position[] = []): number {
  const total = rows * cols;
  if (total <= 0) return 1;
  const playable = Math.max(0, total - voidCells.length);
  return playable / total;
}
