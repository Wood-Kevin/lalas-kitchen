export type PieceType = 'normal' | 'striped' | 'blocker' | 'color_bomb' | 'area_bomb';

// Which line a striped piece clears when it's matched (see gameState.ts's
// resolveCascades). A separate 'row'/'col' field rather than two piece types
// ('row_clearer'/'col_clearer') so a striped piece is one type carrying a
// direction — the exact "matchType plus a direction" shape the feature was
// specified in, and it keeps every "is this special?" check a single
// `type === 'striped'` test rather than a growing set of type literals.
export type StripeDirection = 'row' | 'col';

export interface Piece {
  id: string;
  type: PieceType;
  matchType?: string;
  // Only meaningful when type === 'blocker'. How many adjacent-match hits
  // this cell has left before it clears — see applyAdjacentDamage.
  hitsRemaining?: number;
  // Only meaningful when type === 'striped'. Which line this piece clears
  // the next time it's matched. Same optional-field-by-type pattern as
  // hitsRemaining above.
  direction?: StripeDirection;
  // A 'color_bomb' piece (spawned by a 5-in-a-row/column, see gameState.ts's
  // resolveMatchEffects) carries NO matchType, direction, or hitsRemaining —
  // it's colorless by design, so it can never form an ordinary run
  // (piecesMatch excludes it, like a blocker). It activates only by being
  // swapped, handled entirely in gameState.ts's applyMove, not here.
  //
  // An 'area_bomb' piece (spawned by a 2x2 square of same-type pieces, see
  // gameState.ts's resolveMatchEffects and checkSquares below) is now the SAME
  // taxonomy as the color bomb: it also drops matchType/direction/hitsRemaining
  // and is colorless (piecesMatch excludes it too), and it also activates by
  // being SWAPPED, not by being matched — swapping it with any ordinary piece
  // fires its 3x3 blast (gameState.ts's resolveAreaBomb). This reverses its
  // original passive/colored design: the single fixed area_bomb.webp sprite
  // gave a player no way to see which color a passive bomb was, so making it
  // colorless makes that question moot (see engine/DECISIONS.md's area-bomb
  // reversal entry).
  //
  // Only meaningful when type === 'normal' AND the level has the dynamic
  // denial-zone spread mechanic enabled (see gameState.ts's DenialSpreadState).
  // True for exactly one move on the ordinary cell a blocker is about to spread
  // into: the "growing crack" warning the player sees the move before the zone
  // grows (components/Tile.tsx renders it). It never affects matching — a warned
  // piece is still an ordinary, matchable, swappable piece; matching it (which
  // necessarily damages the adjacent blocker) is exactly how a player defuses
  // the warning. Absent on every level without the spread mechanic.
  spreadWarning?: boolean;
}

export type Board = Piece[][];

export interface Position {
  row: number;
  col: number;
}

export interface Match {
  matchType: string | undefined;
  positions: Position[];
  // Which axis this run lies along — a horizontal run is 'row', a vertical
  // run is 'col'. A 4-long run's orientation is what decides the direction of
  // the striped piece it spawns (see gameState.ts's resolveCascades); a plain
  // 3-match ignores it. positions.length already carries the run length, so a
  // 4-match is distinguishable from a 3-match with no extra field.
  orientation: StripeDirection;
}

// A 2x2 block of four mutually-matching pieces — a genuinely different shape
// from checkMatches' straight-line runs, so it gets its own scan (checkSquares)
// rather than being folded into runsInLine. It has no orientation (a square
// isn't a row or a column), and it must never be mistaken for a 4-long run,
// which spawns a striped piece instead of an area bomb. positions[0] is the
// top-left cell and is the anchor that becomes the area bomb, mirroring how a
// run uses its first cell as the striped/bomb anchor (see gameState.ts's
// resolveMatchEffects).
export interface Square {
  matchType: string | undefined;
  positions: Position[];
}

// Two pieces only match if both carry a matchType and it's equal. A piece
// with no matchType can never form a run. Blockers are excluded outright
// regardless of matchType — a blocker carries a matchType purely so its
// clears can be counted toward an objective (see gameState.ts's
// resolveCascades), not so it can participate in a run. A color bomb is
// excluded the same way: it's colorless (no matchType) and only ever acts by
// being swapped (see gameState.ts's applyMove), never by joining a run — this
// guard makes that true even if a bomb ever ends up adjacent to same-typed
// pieces around it. An area bomb is now excluded for exactly the same reason:
// it too is colorless and swap-activated (it was passive/colored before — see
// engine/DECISIONS.md's area-bomb reversal entry), so it can never form or
// join a run either.
function piecesMatch(a: Piece, b: Piece): boolean {
  if (a.type === 'blocker' || b.type === 'blocker') return false;
  if (a.type === 'color_bomb' || b.type === 'color_bomb') return false;
  if (a.type === 'area_bomb' || b.type === 'area_bomb') return false;
  return a.matchType !== undefined && a.matchType === b.matchType;
}

function runsInLine(line: Piece[]): Array<{ start: number; length: number }> {
  const runs: Array<{ start: number; length: number }> = [];
  let runStart = 0;
  for (let i = 1; i <= line.length; i++) {
    const continuesRun = i < line.length && piecesMatch(line[i], line[i - 1]);
    if (!continuesRun) {
      const length = i - runStart;
      if (length >= 3) {
        runs.push({ start: runStart, length });
      }
      runStart = i;
    }
  }
  return runs;
}

export function checkMatches(board: Board): Match[] {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const matches: Match[] = [];

  for (let r = 0; r < rows; r++) {
    const row = board[r];
    for (const run of runsInLine(row)) {
      matches.push({
        matchType: row[run.start].matchType,
        positions: Array.from({ length: run.length }, (_, i) => ({ row: r, col: run.start + i })),
        orientation: 'row',
      });
    }
  }

  for (let c = 0; c < cols; c++) {
    const column = board.map((row) => row[c]);
    for (const run of runsInLine(column)) {
      matches.push({
        matchType: column[run.start].matchType,
        positions: Array.from({ length: run.length }, (_, i) => ({ row: run.start + i, col: c })),
        orientation: 'col',
      });
    }
  }

  return matches;
}

// Finds every 2x2 block of four ORDINARY pieces sharing one matchType. Only
// plain `type === 'normal'` cells seed a square: a blocker, a color bomb, or an
// already-live special (striped/area_bomb) caught in a 2x2 region never
// converts to — or is consumed by — an area bomb, exactly as the run path never
// re-spawns a special over an existing one. This is the SPAWN scan; it's
// independent of, and runs alongside, checkMatches (a pure 2x2 forms no
// 3-in-a-row, so the run scan alone would miss it). Overlapping squares (a 2x3
// region, say) are all returned, but such a region also contains a straight
// run, so gameState.ts's resolveMatchEffects — which only spawns a bomb for a
// square whose cells no run touches — stands those down and lets the run logic
// handle them (L/T/larger shapes stay deferred). Pure: reads the board, returns
// the squares found.
export function checkSquares(board: Board): Square[] {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const squares: Square[] = [];

  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const tl = board[r][c];
      const tr = board[r][c + 1];
      const bl = board[r + 1][c];
      const br = board[r + 1][c + 1];
      if (tl.type !== 'normal' || tr.type !== 'normal' || bl.type !== 'normal' || br.type !== 'normal') {
        continue;
      }
      if (!piecesMatch(tl, tr) || !piecesMatch(tl, bl) || !piecesMatch(tl, br)) continue;

      squares.push({
        matchType: tl.matchType,
        positions: [
          { row: r, col: c },
          { row: r, col: c + 1 },
          { row: r + 1, col: c },
          { row: r + 1, col: c + 1 },
        ],
      });
    }
  }

  return squares;
}

export function swapPieces(board: Board, posA: Position, posB: Position): Board {
  const newBoard = board.map((row) => row.slice());
  const temp = newBoard[posA.row][posA.col];
  newBoard[posA.row][posA.col] = newBoard[posB.row][posB.col];
  newBoard[posB.row][posB.col] = temp;
  return newBoard;
}

// Board carries nulls for cells already cleared by the caller (gameState's
// applyMove nulls out checkMatches positions before calling this). New
// pieces come from an injected spawnPiece callback rather than Math.random
// directly, so matrix.ts stays free of any RNG dependency — Phase 2's
// seeded generator supplies a deterministic spawnPiece when it lands.
export function calculateCascades(
  board: Array<Array<Piece | null>>,
  spawnPiece: () => Piece
): Board {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const result: Board = Array.from({ length: rows }, () => new Array(cols));

  for (let c = 0; c < cols; c++) {
    const surviving: Piece[] = [];
    for (let r = 0; r < rows; r++) {
      const cell = board[r][c];
      if (cell !== null) surviving.push(cell);
    }

    const missing = rows - surviving.length;
    const spawned: Piece[] = [];
    for (let i = 0; i < missing; i++) spawned.push(spawnPiece());

    const fullColumn = [...spawned, ...surviving];
    for (let r = 0; r < rows; r++) {
      result[r][c] = fullColumn[r];
    }
  }

  return result;
}

export interface AdjacentDamageResult {
  board: Board;
  // Blockers whose hitsRemaining reached zero from this one call — the
  // caller joins these positions into the same clear/cascade as the
  // triggering match. Everything else about the board is unchanged aside
  // from decremented hitsRemaining on the blockers that were hit.
  newlyClearedBlockers: Position[];
}

const ADJACENT_OFFSETS: Position[] = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
];

// Whenever a match clears cells, any blocker cell adjacent to one of those
// cells takes exactly one hit — not one hit per adjacent cleared cell, so a
// blocker boxed in by a single L-shaped match still only loses one point of
// hitsRemaining for that match, matching genre convention (see
// DECISIONS.md for why adjacent damage was chosen over a hidden-piece
// mechanic). Pure function: takes the board as it stood right before the
// clear and the positions about to be cleared, returns a new board with
// damaged blockers' hitsRemaining decremented, plus the positions of any
// blocker that reached zero and should clear alongside the triggering match.
export function applyAdjacentDamage(board: Board, clearedPositions: Position[]): AdjacentDamageResult {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const newBoard = board.map((row) => row.slice());
  const clearedSet = new Set(clearedPositions.map((p) => `${p.row},${p.col}`));
  const alreadyDamaged = new Set<string>();
  const newlyClearedBlockers: Position[] = [];

  for (const pos of clearedPositions) {
    for (const offset of ADJACENT_OFFSETS) {
      const row = pos.row + offset.row;
      const col = pos.col + offset.col;
      if (row < 0 || row >= rows || col < 0 || col >= cols) continue;

      const key = `${row},${col}`;
      if (clearedSet.has(key) || alreadyDamaged.has(key)) continue;

      const cell = newBoard[row][col];
      if (cell.type !== 'blocker') continue;

      alreadyDamaged.add(key);
      const hitsRemaining = (cell.hitsRemaining ?? 1) - 1;
      newBoard[row][col] = { ...cell, hitsRemaining };
      if (hitsRemaining <= 0) {
        newlyClearedBlockers.push({ row, col });
      }
    }
  }

  return { board: newBoard, newlyClearedBlockers };
}

// The deterministic next cell a denial zone will spread into, for the dynamic
// spread mechanic (see gameState.ts's stepDenialZone). Scans row-major for the
// first blocker that borders an ordinary ('normal') cell and returns that
// blocker (source) paired with its first ordinary neighbor in ADJACENT_OFFSETS
// order (target). Returns null when no blocker touches an ordinary piece — the
// zone is fully boxed in by edges, other blockers, or special pieces, so it has
// nowhere to grow this move.
//
// Only 'normal' cells are eligible targets, never a special (striped/bomb) or
// another blocker: a spread turns a plain matchable piece into a blocker, so it
// can never consume a piece the player earned, and can never double-place onto
// an existing blocker. Pure geometry — the caller decides what to do with the
// result (mark a warning on the target, or convert it).
export function findSpreadTarget(
  board: Board
): { source: Position; target: Position } | null {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].type !== 'blocker') continue;
      for (const offset of ADJACENT_OFFSETS) {
        const nr = r + offset.row;
        const nc = c + offset.col;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (board[nr][nc].type === 'normal') {
          return { source: { row: r, col: c }, target: { row: nr, col: nc } };
        }
      }
    }
  }
  return null;
}

function fisherYates<T>(items: T[], rng: () => number): T[] {
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// rng is injected (defaulting to Math.random) so tests can pass a fixed
// sequence and get a deterministic result. Bounded retry avoids handing back
// a board that's already matched or that still has zero legal moves — the
// whole point of shuffling — while guaranteeing termination.
export function shuffle(board: Board, rng: () => number = Math.random): Board {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const flatPieces = board.flat();
  const maxAttempts = 100;

  let candidate: Board = board;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shuffledPieces = fisherYates(flatPieces, rng);
    candidate = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => shuffledPieces[r * cols + c])
    );
    // A freshly shuffled board must be free of BOTH straight runs and 2x2
    // squares — a latent square would auto-spawn an area bomb on the player's
    // next move without them having formed it, so it counts as "already
    // matched" here exactly like a run does.
    if (
      checkMatches(candidate).length === 0 &&
      checkSquares(candidate).length === 0 &&
      hasLegalMoves(candidate)
    ) {
      return candidate;
    }
  }
  return candidate;
}

// Blockers are excluded as candidates on both sides of a swap, not just
// left out of match runs — a swap that moves a blocker out of its cell
// would itself be an illegal move (see gameState.ts's applyMove), so a
// pair involving one must never be reported as "legal" here even if the
// resulting board would otherwise contain a run.
//
// A color bomb is the opposite: a swap involving one is ALWAYS legal, because
// it activates on the swap itself regardless of whether a run forms (see
// gameState.ts's applyMove). So a bomb next to any non-blocker neighbour is a
// legal move even when swapPieces + checkMatches would find nothing — without
// this, a board whose only move is a bomb swap would be wrongly judged stuck
// and shuffled out from under the player.
//
// Two adjacent striped pieces are legal for the same reason: swapping them fires
// the cross combo (see gameState.ts's resolveStripedCross) on the swap itself,
// no run required. A striped+bomb pair is already covered by the color-bomb
// clause above (the bomb makes the pair legal), so both combo swaps are handled.
//
// A swap that forms a 2x2 square (rather than a straight run) is also a legal
// move — it spawns an area bomb (see gameState.ts's resolveMatchEffects) — so
// checkSquares joins checkMatches in the ordinary-pair test below. Without this
// a board whose only move makes a square would be wrongly judged stuck and
// shuffled out from under the player, the same failure the color-bomb clause
// guards against.
//
// A live area bomb is now swap-activated too (it used to trigger passively via a
// run, needing no clause here). Its rule mirrors the color bomb's but is
// narrower, matching the deferred-combo decision: a swap of an area bomb with an
// ORDINARY piece always fires its 3x3 blast, so it's always legal; a swap of an
// area bomb with ANOTHER special (color bomb / striped / area bomb) is a deferred
// combo that snaps back (gameState.ts's applyMove), so it is NOT a legal move.
// The area-bomb clause therefore runs FIRST and returns false for a special
// partner, so that pair isn't wrongly counted as legal via the color-bomb clause
// below.
export function hasLegalMoves(board: Board): boolean {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;

  const legalPair = (a: Piece, b: Piece, swapped: Board): boolean => {
    if (a.type === 'area_bomb' || b.type === 'area_bomb') {
      const partner = a.type === 'area_bomb' ? b : a;
      // area + ordinary → always legal (fires the blast); area + special →
      // deferred no-op, not legal.
      return (
        partner.type !== 'area_bomb' &&
        partner.type !== 'striped' &&
        partner.type !== 'color_bomb'
      );
    }
    if (a.type === 'color_bomb' || b.type === 'color_bomb') return true;
    if (a.type === 'striped' && b.type === 'striped') return true;
    return checkMatches(swapped).length > 0 || checkSquares(swapped).length > 0;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].type === 'blocker') continue;
      if (c + 1 < cols && board[r][c + 1].type !== 'blocker') {
        const swapped = swapPieces(board, { row: r, col: c }, { row: r, col: c + 1 });
        if (legalPair(board[r][c], board[r][c + 1], swapped)) return true;
      }
      if (r + 1 < rows && board[r + 1][c].type !== 'blocker') {
        const swapped = swapPieces(board, { row: r, col: c }, { row: r + 1, col: c });
        if (legalPair(board[r][c], board[r + 1][c], swapped)) return true;
      }
    }
  }

  return false;
}
