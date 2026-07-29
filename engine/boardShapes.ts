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

export type BoardShapeId = 'cut_corners' | 'plus' | 'ring' | 'diamond' | 'hourglass' | 'pockets';

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

// Shared taper depth for diamondVoids/hourglassVoids — both cut a
// symmetric wedge of columns per row, just anchored at opposite ends (the
// diamond tapers in from the row edges toward the center; the hourglass
// tapers in from the vertical center toward its edges). One shared formula
// keeps the two visually related instead of each guessing its own depth.
// Capped by cols so the taper can never void an entire row (floor((cols-1)/2)
// always leaves at least 1 center column standing at maximum cut), and by
// rows so the taper has enough vertical room to actually step through.
function diamondTaperSteps(rows: number, cols: number): number {
  return Math.max(0, Math.min(Math.floor(rows / 2), Math.floor((cols - 1) / 2)));
}

// Tapers each row's outer columns inward from both the top and bottom edge,
// widest cut at row 0/rows-1 (down to a single center column) and no cut at
// all once within `steps` rows of the vertical center — a rounded
// lozenge/gem silhouette, general for any rows x cols.
export function diamondVoids(rows: number, cols: number): Position[] {
  const steps = diamondTaperSteps(rows, cols);
  const voids: Position[] = [];
  for (let row = 0; row < rows; row++) {
    const distFromRowEdge = Math.min(row, rows - 1 - row);
    const cut = Math.max(0, steps - distFromRowEdge);
    if (cut <= 0) continue;
    for (let col = 0; col < cut; col++) voids.push({ row, col });
    for (let col = cols - cut; col < cols; col++) voids.push({ row, col });
  }
  return voids;
}

// The inverse taper direction from diamondVoids: a band of rows centered on
// the board's vertical middle narrows to a single-column neck, while every
// row outside that band stays fully playable — a bowtie/hourglass
// silhouette. Unlike the other 5 templates (all pure boundary/interior
// cuts), this pinches the board's own gravity flow through a bottleneck,
// a genuinely different play texture, not just a different outline.
export function hourglassVoids(rows: number, cols: number): Position[] {
  const steps = diamondTaperSteps(rows, cols);
  if (steps <= 0) return [];
  const bandHeight = steps * 2;
  const bandStart = Math.floor((rows - bandHeight) / 2);
  const bandEnd = bandStart + bandHeight - 1;
  const voids: Position[] = [];
  for (let row = bandStart; row <= bandEnd; row++) {
    const distFromBandEdge = Math.min(row - bandStart, bandEnd - row);
    const cut = Math.min(steps, distFromBandEdge + 1);
    for (let col = 0; col < cut; col++) voids.push({ row, col });
    for (let col = cols - cut; col < cols; col++) voids.push({ row, col });
  }
  return voids;
}

// Scattered single-cell interior holes on an odd-row/odd-col lattice — the
// one template that isn't a boundary silhouette at all. Restricted to
// 1 <= row <= rows-2 and 1 <= col <= cols-2 by construction (the lattice
// starts at row/col 1), so a pocket never touches the board's own edge and
// this can never be mistaken for a ring cut.
export function pocketsVoids(rows: number, cols: number): Position[] {
  const voids: Position[] = [];
  for (let row = 1; row <= rows - 2; row++) {
    if (row % 2 !== 1) continue;
    for (let col = 1; col <= cols - 2; col++) {
      if (col % 2 === 1) voids.push({ row, col });
    }
  }
  return voids;
}

export const BOARD_SHAPE_TEMPLATES: Record<BoardShapeId, (rows: number, cols: number) => Position[]> = {
  cut_corners: cutCornersVoids,
  plus: plusVoids,
  ring: ringVoids,
  diamond: diamondVoids,
  hourglass: hourglassVoids,
  pockets: pocketsVoids,
};

// Deterministic rotation order — appPersistence.ts's generatedShapeId cycles
// through this list by index rather than picking randomly, the same
// deterministic-by-levelNumber shape every other generated-level lever
// (blocker id rotation, objective targetMatchType rotation) already uses.
// The 3 new entries are appended after the original 3 rather than
// interleaved, so SHAPE_ROTATION_OFFSET's existing reasoning (why raw level
// 8 lands on `plus`) is untouched for every level number that existed
// before this change — only levels past the old length-3 cycle see a
// genuinely new rotation position, disclosed in DECISIONS.md.
export const BOARD_SHAPE_ROTATION: BoardShapeId[] = [
  'cut_corners',
  'plus',
  'ring',
  'diamond',
  'hourglass',
  'pockets',
];

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
