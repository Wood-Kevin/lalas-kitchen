export type PieceType = 'normal' | 'striped' | 'blocker' | 'color_bomb' | 'area_bomb' | 'void';

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

// A 'void' piece is not content — it's a hole in the board's SHAPE, the cell
// that lets a level be non-rectangular (a plus, a ring, an irregular outline).
// It carries no matchType, so piecesMatch already rejects it; it's excluded
// explicitly everywhere a blocker is (matching, squares, legal moves, swaps) so
// the "this cell doesn't exist" contract holds even if code changes around it.
// It is FIXED: gravity treats it as a floor (calculateCascades never moves,
// clears, or refills it — pieces can't fall through it), the generator never
// fills it, shuffle never relocates it, and components/Board.tsx renders
// nothing there (the board background shows through as the cutout). It was made
// a sentinel piece type — the same shape 'blocker' uses — rather than a nullable
// board cell precisely so `Board = Piece[][]` stays non-null and every existing
// consumer keeps a real object at every index. See engine/DECISIONS.md's
// board-shape / void-cell entry.

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
// top-left cell — the anchor that becomes the area bomb, mirroring how a run
// uses its first cell as the striped/bomb anchor — UNLESS one of the four
// cells is already a live striped piece, in which case gameState.ts's
// resolveMatchEffects fires that piece's own sweep instead of spawning a new
// area bomb at all (see the squareEligible comment above).
export interface Square {
  matchType: string | undefined;
  positions: Position[];
}

// A crossing point: a horizontal run AND a vertical run, each EXACTLY length
// 3, sharing one cell — the classic L/T/plus. A THIRD match shape, additive
// to checkMatches' straight runs and checkSquares' 2x2 blocks: unlike a
// square, a cross's own two arms are each already an ordinary 3-run that
// checkMatches independently reports — this scan's only job is to name the
// CELL THEY SHARE as its own anchor (mirroring Square.positions[0]'s
// top-left convention), the shape checkMatches has no notion of. positions[0]
// is always the crossing cell, the anchor that becomes the area bomb; the
// other four are the two arms' remaining cells, in no particular order beyond
// "row arm's other two cells, then column arm's other two cells" (not
// load-bearing for callers).
//
// Only EXACTLY-length-3 arms count on both axes — baked into the scan
// itself, not filtered afterward by the caller (see checkCrossShapes below).
// A 4- or 5-long arm through this cell already spawns its own striped piece
// or color bomb via checkMatches' ordinary run handling (see gameState.ts's
// resolveMatchEffects); letting a cross also claim that cell would
// double-spawn a special over the same event, so checkCrossShapes never even
// reports it as a candidate. This is a confirmed, deliberate scope line, not
// an oversight — see engine/DECISIONS.md's crossing-run entry.
export interface CrossShape {
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
  // A void is a hole, not a piece — it can never participate in a run, so it
  // breaks any line it sits in (a run scan stops at it and resumes after it).
  // It carries no matchType so the final check already rejects it, but the
  // explicit guard keeps the "void is never content" invariant local and
  // obvious, exactly like the sentinels above.
  if (a.type === 'void' || b.type === 'void') return false;
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

// A corner may be a plain ordinary piece OR a live striped piece — a striped
// piece caught in a square fires its own line sweep instead of a new area bomb
// spawning (see gameState.ts's resolveMatchEffects), the same "an existing
// special fires itself rather than seeding a new one" rule a run already
// applies to a striped piece caught in it. A blocker or void never counts
// (real playtesting confirmed this — see engine/DECISIONS.md's square+striped
// entry); a color bomb or area bomb never counts either, but that's moot here
// since both are colorless and piecesMatch already excludes them from ever
// sharing a matchType with the other corners.
function squareEligible(piece: Piece): boolean {
  return piece.type === 'normal' || piece.type === 'striped';
}

// Finds every 2x2 block of four mutually-matching, square-eligible pieces
// (see squareEligible above). This is the SPAWN scan; it's independent of, and
// runs alongside, checkMatches (a pure 2x2 forms no 3-in-a-row, so the run
// scan alone would miss it). Overlapping squares (a 2x3 region, say) are all
// returned, but such a region also contains a straight run, so
// gameState.ts's resolveMatchEffects — which only spawns a bomb for a square
// whose cells no run touches — stands those down and lets the run logic
// handle them (L/T/larger shapes stay deferred). Pure: reads the board,
// returns the squares found.
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
      if (!squareEligible(tl) || !squareEligible(tr) || !squareEligible(bl) || !squareEligible(br)) {
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

// Finds every crossing point where a horizontal run and a vertical run, each
// EXACTLY length 3, share a cell (see CrossShape above). Built entirely on
// runsInLine (the same primitive checkMatches uses), so blocker/void/
// color_bomb/area_bomb are excluded "for free" via piecesMatch — no separate
// eligibility gate is needed here, unlike checkSquares' squareEligible (which
// reimplements corner adjacency from scratch and so needs its own gate). A
// live striped piece IS included (mirrors squareEligible's decision to allow
// a striped corner): this scan only reports geometry — "an existing special
// fires itself instead of a new one spawning" is gameState.ts's
// resolveMatchEffects' call, not this function's.
export function checkCrossShapes(board: Board): CrossShape[] {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;

  // Every cell covered by an exactly-length-3 row run, keyed by "r,c".
  const rowRunAt = new Map<string, { start: number; length: number }>();
  for (let r = 0; r < rows; r++) {
    for (const run of runsInLine(board[r])) {
      if (run.length !== 3) continue;
      for (let c = run.start; c < run.start + run.length; c++) {
        rowRunAt.set(`${r},${c}`, run);
      }
    }
  }

  // Same for columns.
  const colRunAt = new Map<string, { start: number; length: number }>();
  for (let c = 0; c < cols; c++) {
    const column = board.map((row) => row[c]);
    for (const run of runsInLine(column)) {
      if (run.length !== 3) continue;
      for (let r = run.start; r < run.start + run.length; r++) {
        colRunAt.set(`${r},${c}`, run);
      }
    }
  }

  const crosses: CrossShape[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rowRun = rowRunAt.get(`${r},${c}`);
      const colRun = colRunAt.get(`${r},${c}`);
      if (!rowRun || !colRun) continue;

      const rowCells: Position[] = [];
      for (let cc = rowRun.start; cc < rowRun.start + rowRun.length; cc++) {
        if (cc !== c) rowCells.push({ row: r, col: cc });
      }
      const colCells: Position[] = [];
      for (let rr = colRun.start; rr < colRun.start + colRun.length; rr++) {
        if (rr !== r) colCells.push({ row: rr, col: c });
      }

      crosses.push({
        matchType: board[r][c].matchType,
        positions: [{ row: r, col: c }, ...rowCells, ...colCells],
      });
    }
  }

  return crosses;
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
//
// Void cells (a hole in a non-rectangular board's shape) are FIXED floors: a
// column is walked as a series of maximal non-void SEGMENTS separated by voids,
// and gravity acts within each segment independently. Survivors in a segment
// compact to the bottom of THAT segment (they can't fall through the void
// below), and refills spawn at the top of THAT segment (they can't fall in past
// the void above) — so an enclosed pocket, like the middle-row cells of a plus's
// side arm, still refills from its own local top rather than draining forever.
// A void-free column is exactly one full-height segment, so a plain rectangular
// board behaves identically to before (the pre-void single-loop code was the
// special case where every column is one segment).
export function calculateCascades(
  board: Array<Array<Piece | null>>,
  spawnPiece: () => Piece
): Board {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const result: Board = Array.from({ length: rows }, () => new Array(cols));

  const isVoid = (cell: Piece | null): boolean => cell !== null && cell.type === 'void';

  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (isVoid(board[r][c])) {
        // A void stays exactly where it is — it's board shape, never moved,
        // cleared, or refilled.
        result[r][c] = board[r][c] as Piece;
        r++;
        continue;
      }
      // Start of a playable segment [segStart, segEnd): every non-void cell up
      // to the next void or the board floor.
      const segStart = r;
      while (r < rows && !isVoid(board[r][c])) r++;
      const segEnd = r;
      const segLen = segEnd - segStart;

      const surviving: Piece[] = [];
      for (let rr = segStart; rr < segEnd; rr++) {
        const cell = board[rr][c];
        if (cell !== null) surviving.push(cell); // non-void by construction
      }

      const missing = segLen - surviving.length;
      const spawned: Piece[] = [];
      for (let i = 0; i < missing; i++) spawned.push(spawnPiece());

      const filledSegment = [...spawned, ...surviving];
      for (let rr = segStart; rr < segEnd; rr++) {
        result[rr][c] = filledSegment[rr - segStart];
      }
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
  const maxAttempts = 100;

  // Void cells are the board's fixed shape — they must never be relocated by a
  // reshuffle. Only the non-void pieces are redistributed, and only across the
  // non-void positions, so a plus stays a plus. A void-free board reduces to
  // "every position is movable," identical to the pre-void flat shuffle.
  const movablePositions: Position[] = [];
  const movablePieces: Piece[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].type === 'void') continue;
      movablePositions.push({ row: r, col: c });
      movablePieces.push(board[r][c]);
    }
  }

  let candidate: Board = board;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shuffledPieces = fisherYates(movablePieces, rng);
    candidate = board.map((row) => row.slice());
    movablePositions.forEach((pos, i) => {
      candidate[pos.row][pos.col] = shuffledPieces[i];
    });
    // A freshly shuffled board must be free of BOTH straight runs and 2x2
    // squares — a latent square would auto-spawn an area bomb on the player's
    // next move without them having formed it, so it counts as "already
    // matched" here exactly like a run does. No checkCrossShapes clause is
    // needed: a latent crossing point's two arms are themselves already
    // ordinary runs, so checkMatches(candidate) is already non-empty whenever
    // a cross exists — see engine/DECISIONS.md's crossing-run entry.
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
// resulting board would otherwise contain a run. Void cells (board-shape
// holes) are excluded the same way and for the same reason — they can never
// be swapped (see the `swappable` guard in the loop below).
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
    // No checkCrossShapes clause is needed here, deliberately — unlike a pure
    // 2x2 square, a crossing point's two arms are themselves already ordinary
    // 3-runs that checkMatches independently reports, so checkMatches(swapped)
    // is already non-empty whenever a cross exists. See engine/DECISIONS.md's
    // crossing-run entry.
    return checkMatches(swapped).length > 0 || checkSquares(swapped).length > 0;
  };

  // A void cell is a hole in the board shape, never swappable — it's excluded
  // as both source and neighbour exactly like a blocker, so a board is never
  // judged stuck (or legal) on the basis of a swap that can't happen.
  const swappable = (piece: Piece): boolean => piece.type !== 'blocker' && piece.type !== 'void';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!swappable(board[r][c])) continue;
      if (c + 1 < cols && swappable(board[r][c + 1])) {
        const swapped = swapPieces(board, { row: r, col: c }, { row: r, col: c + 1 });
        if (legalPair(board[r][c], board[r][c + 1], swapped)) return true;
      }
      if (r + 1 < rows && swappable(board[r + 1][c])) {
        const swapped = swapPieces(board, { row: r, col: c }, { row: r + 1, col: c });
        if (legalPair(board[r][c], board[r + 1][c], swapped)) return true;
      }
    }
  }

  return false;
}
