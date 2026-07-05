import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Board,
  Piece,
  Position,
  Match,
  Square,
  StripeDirection,
  checkMatches,
  checkSquares,
  swapPieces,
  calculateCascades,
  hasLegalMoves,
  shuffle,
  applyAdjacentDamage,
  findSpreadTarget,
} from './matrix';
import { generateLevel } from './generator';

// Re-exported so components/ (and appPersistence.ts) can depend on
// gameState.ts alone for the engine-facing types they need, instead of
// also reaching into matrix.ts directly — gameState.ts is already the
// presentation layer's boundary for GameState, LevelConfig, etc., so
// Position/Board belong on that same seam.
export type { Position, Board };

export type ObjectiveType = 'collect';

export interface Objective {
  type: ObjectiveType;
  targetMatchType: string;
  targetCount: number;
  currentCount: number;
}

// The dynamic denial-zone spread mechanic's per-level runtime state. Present on
// GameState (and enabled via LevelConfig.denialSpread) ONLY for levels past the
// difficulty threshold that gates it — see appPersistence.ts's
// DENIAL_SPREAD_MIN_LEVEL_NUMBER, gated the same way pot_lid is. Absent
// (undefined) on every level below the threshold, which keeps blockers purely
// static: a cluster of blockers is a denial zone that never grows, identical to
// every level built before this mechanic. See engine/DECISIONS.md's
// denial-zone-spread entry and CLAUDE.md's Data Model Notes.
export interface DenialSpreadState {
  // Unaddressed moves since the zone last took damage (or last spread). Reset
  // to 0 the moment any blocker is hit or cleared this move ("addressing" the
  // zone), which also cancels any pending warning.
  movesUnaddressed: number;
  // The move count at which an unaddressed zone spreads. NOT a fixed universal
  // number — createGameState sets it to a proportion of the level's own move
  // budget (SPREAD_MOVE_FRACTION), so the pressure feels the same whether a
  // level grants 18 moves or 30. Always >= 2, so spreadInterval - 1 (the
  // warning move) is always a real, visible move before the spread lands.
  spreadInterval: number;
  // The hitsRemaining a freshly spread blocker is born with — the level's own
  // blockerHitsToClear, so a spread-in cell is exactly as tough to clear as a
  // generator-placed one.
  blockerHitsToClear: number;
}

export type GameStatus = 'in_progress' | 'paused_awaiting_input' | 'won';

// Which resource hit zero to cause a paused_awaiting_input status. null
// whenever status isn't paused_awaiting_input. This is the mechanism that
// lets a future skin show different messaging per pause type without the
// engine needing to know what that messaging is — same "engine emits data,
// skin decides presentation" separation as the event types below.
//
// 'lives' was removed from this union — see DECISIONS.md's life-spend
// session. Mid-level lives exhaustion never had a real trigger (nothing
// ever decremented GameState.lives during play), and the life-spend
// mechanic actually built spends a life *after* a level ends, at the
// account level, with level-start itself gated at lives > 0 — so
// GameState.lives, fixed at level start to an already-gated value, can
// never legitimately reach zero inside a call to applyMove. Re-add it here
// only if a real mid-level lives-spend trigger is ever built.
export type PauseReason = 'moves' | null;

export interface GameState {
  board: Board;
  movesRemaining: number;
  // Snapshot of the account's persisted lives count at level start — read
  // by the HUD for display, but not itself decremented during play (see
  // PauseReason's comment above). The account-level lives count that
  // actually changes on a loss lives in App.tsx, not here.
  lives: number;
  // Always at least one entry — a single-objective level (every hand-built
  // LEVEL_QUEUE entry today) is just an array of length one, not a special
  // case. Win requires every entry's currentCount to reach its targetCount
  // (see applyMove), so this array is also the one place "how many things
  // does this level ask for" lives.
  objectives: Objective[];
  status: GameStatus;
  pauseReason: PauseReason;
  // Running total of every piece cleared this level, by matchType — feeds
  // the level_summary event. Distinct from each objective's currentCount,
  // which only tracks the one matchType that objective cares about.
  totalCleared: Record<string, number>;
  // Generates the next cascade-spawned piece. Stored as a closure (not a
  // seed) so GameState never needs to know whether it's backed by a seeded
  // PRNG or something else — same injection pattern as matrix.ts's
  // calculateCascades(board, spawnPiece). GameState is transient/in-memory
  // only (see SaveData below), so a non-serializable field here is fine.
  spawnPiece: () => Piece;
  // Present only when the dynamic denial-zone spread mechanic is enabled for
  // this level (LevelConfig.denialSpread, gated in appPersistence.ts).
  // undefined means blockers never spread — every level below the threshold,
  // and every level built before this mechanic existed. See DenialSpreadState.
  denialSpread?: DenialSpreadState;
}

export interface ComboStreakEvent {
  type: 'combo_streak';
  cascadeCount: number;
  clearedByMatchType: Record<string, number>;
}

export interface LevelSummaryEvent {
  type: 'level_summary';
  outcome: 'won' | 'paused_awaiting_input';
  // null when outcome is 'won' — a reason only means something for a pause.
  reason: PauseReason;
  clearedByMatchType: Record<string, number>;
}

export type EngineEvent = ComboStreakEvent | LevelSummaryEvent;

export interface ApplyMoveResult {
  state: GameState;
  events: EngineEvent[];
  // One board snapshot per cascade pass this move resolved, in order, for
  // the presentation layer to animate as distinct sequential beats (this
  // pass's clears settle, then the next pass's begin) rather than collapsing
  // the whole chain into a single before/after diff. The final entry always
  // equals `state.board`, so animating the last step lands exactly on the
  // committed board. Empty for a rejected move (no match / not in progress),
  // where `state` is returned unchanged. A single-match move with no chain
  // yields exactly one step — the settled board — so simple cases are
  // unchanged, just expressed as a length-1 sequence. See DECISIONS.md's
  // cascade-steps entry.
  steps: Board[];
}

// mulberry32, same implementation as generator.ts. Duplicated rather than
// imported since generator.ts doesn't export it — see DECISIONS.md.
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeededSpawnPiece(seed: number, pieceTypeIds: string[]): () => Piece {
  const rng = mulberry32(seed);
  let counter = 0;
  return (): Piece => {
    const id = `spawn-${counter}`;
    counter += 1;
    const matchType = pieceTypeIds[Math.floor(rng() * pieceTypeIds.length)];
    return { id, type: 'normal', matchType };
  };
}

export interface LevelConfig {
  seed: number;
  rows: number;
  cols: number;
  pieceTypeIds: string[];
  movesLimit: number;
  lives: number;
  // Always non-empty. Every objective must be met to win (see applyMove) —
  // never let two entries share a targetMatchType, since clearedByMatchType
  // is keyed by matchType and a shared target would double-credit the same
  // clear toward two different objectives at once.
  objectives: Array<{ targetMatchType: string; targetCount: number }>;
  // Optional so generator-driven levels (appPersistence.ts's
  // buildGeneratedLevelConfig) can leave it unset rather than fabricate a
  // name — components/levelProgress.ts's resolveLevelDisplayName falls back
  // to a plain "Level N" label whenever this is undefined.
  displayName?: string;
  // Optional generated-level blocker placement — mirrors generator.ts's
  // GeneratorConfig fields exactly. Omitted (or blockerCount 0/undefined)
  // means no blockers, identical to every level built before this phase.
  blockerCount?: number;
  blockerMatchType?: string;
  blockerHitsToClear?: number;
  // When true, this level's denial zone spreads if left unaddressed — the
  // dynamic layer, gated past a difficulty threshold in appPersistence.ts
  // (buildGeneratedLevelConfig). Omitted/false means blockers are purely
  // static, the default for every level below the threshold and every level
  // built before this mechanic. createGameState turns this flag into the
  // concrete DenialSpreadState (interval scaled to movesLimit).
  denialSpread?: boolean;
  // Optional board-shape holes — the cells that make this level
  // non-rectangular (a plus, a ring, an irregular outline). Passed straight
  // through to generateLevel, which turns each into a fixed 'void' piece (see
  // matrix.ts's Piece doc and generator.ts). Omitted/empty means a plain
  // rows×cols rectangle, the default for every level built before board-shape
  // support. Hand-authored today; generator-driven shapes are deferred (see
  // DEFERRED_COMPLEXITY.md).
  voidCells?: Position[];
}

// What fraction of a level's move budget an untouched denial zone is allowed to
// sit before it spreads. A quarter of the budget: an 18-move level spreads
// every 5 unaddressed moves, a 30-move level every 8 — proportional, so the
// pressure reads the same regardless of level length (see DenialSpreadState's
// spreadInterval). Deliberately gentle per CLAUDE.md's calm-pacing brief: the
// zone can only grow a handful of times across a whole level even if totally
// ignored, and any single hit on the zone resets the clock. This is the one
// place the spread cadence is tuned; the WHICH-levels gate lives separately in
// appPersistence.ts.
const SPREAD_MOVE_FRACTION = 0.25;

export function createGameState(config: LevelConfig): GameState {
  const board = generateLevel(config.seed, {
    rows: config.rows,
    cols: config.cols,
    pieceTypeIds: config.pieceTypeIds,
    blockerCount: config.blockerCount,
    blockerMatchType: config.blockerMatchType,
    blockerHitsToClear: config.blockerHitsToClear,
    voidCells: config.voidCells,
  });

  return {
    board,
    movesRemaining: config.movesLimit,
    lives: config.lives,
    objectives: config.objectives.map((objective) => ({
      type: 'collect',
      targetMatchType: objective.targetMatchType,
      targetCount: objective.targetCount,
      currentCount: 0,
    })),
    status: 'in_progress',
    pauseReason: null,
    totalCleared: {},
    // seed + 1, not config.seed itself: generateLevel's own rng instance is
    // internal and fully consumed by the time it returns, so ongoing
    // cascade spawns need a fresh stream. Offsetting by 1 keeps it
    // deterministic per level while decorrelating it from the board-fill
    // sequence. See DECISIONS.md.
    spawnPiece: createSeededSpawnPiece(config.seed + 1, config.pieceTypeIds),
    // Only levels flagged for the dynamic mechanic carry spread state; every
    // other level leaves this undefined and its blockers stay static. The
    // interval is derived from THIS level's movesLimit so the cadence scales
    // with level length; max(2, ...) guarantees a warning move exists.
    denialSpread: config.denialSpread
      ? {
          movesUnaddressed: 0,
          spreadInterval: Math.max(2, Math.round(config.movesLimit * SPREAD_MOVE_FRACTION)),
          blockerHitsToClear: config.blockerHitsToClear ?? 1,
        }
      : undefined,
  };
}

function cloneBoardWithGaps(board: Board, positions: Position[]): Array<Array<Piece | null>> {
  const next: Array<Array<Piece | null>> = board.map((row) => row.slice());
  for (const pos of positions) {
    next[pos.row][pos.col] = null;
  }
  return next;
}

// Whether a piece may be force-cleared by a special effect (a striped sweep,
// an area-bomb blast, a color-bomb detonation, a combo, or the chain reaction
// any of those can trigger). A blocker never force-clears — it only ever takes
// adjacent damage (see applyAdjacentDamage) — and a void never clears at all,
// since it's board SHAPE, not content (see matrix.ts's calculateCascades: a
// void is a fixed floor gravity treats as permanent). Every clear-set builder
// below used to spell out `type !== 'blocker'` on its own; on a rectangular
// board that was equivalent to this, since void never existed. Once
// non-rectangular boards shipped, every one of those call sites still let a
// sweep/blast/chain reach straight through a void cell — nulling it via
// cloneBoardWithGaps, which calculateCascades then reads as an ordinary gap
// (not a void, since its isVoid check requires an actual void Piece, not
// null) and refills with a spawned piece, permanently erasing the hole. The
// swallowed void also lands in diffBoards' `cleared` list with no matchType,
// so the exit-tile pipeline resolves it to the undefined/"?" placeholder on
// its way out. One shared predicate, not five ad hoc `!== 'blocker'` checks
// that could drift independently again the next time a non-content type is
// added (see matrix.ts's parallel `swappable` guard in hasLegalMoves, which
// already excludes both for the same reason).
function isClearable(piece: Piece): boolean {
  return piece.type !== 'blocker' && piece.type !== 'void';
}

// Every cell in a striped piece's sweep line — its whole row ('row') or whole
// column ('col'). Pure grid geometry, blocker-agnostic: callers decide what to
// do with a blocker on the line (resolveMatchEffects's addClear skips it; the
// combos filter it out before clearing, so it only ever takes adjacent damage).
// The single source of the striped-line geometry, shared by the in-match sweep
// (resolveMatchEffects) and both swap-triggered combos (applyMove).
function sweepLinePositions(
  rows: number,
  cols: number,
  pos: Position,
  direction: StripeDirection
): Position[] {
  const out: Position[] = [];
  if (direction === 'row') {
    for (let c = 0; c < cols; c++) out.push({ row: pos.row, col: c });
  } else {
    for (let r = 0; r < rows; r++) out.push({ row: r, col: pos.col });
  }
  return out;
}

// Every cell in the 3x3 block centered on `pos`, clamped to the board edges —
// the area an area bomb clears when it fires. Includes the center cell, so the
// bomb consumes itself. Pure grid geometry, the square-shaped sibling of
// sweepLinePositions above and just as blocker-agnostic: its caller
// (resolveAreaBomb, the swap trigger) filters blockers out of the clear set, so
// a blocker on the blast takes normal adjacent damage instead of a force-clear.
// Kept beside sweepLinePositions since both are "which cells does this special
// reach" geometry.
function areaBlastPositions(rows: number, cols: number, pos: Position): Position[] {
  const out: Position[] = [];
  for (let r = pos.row - 1; r <= pos.row + 1; r++) {
    for (let c = pos.col - 1; c <= pos.col + 1; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      out.push({ row: r, col: c });
    }
  }
  return out;
}

// The board's single most common matchType — the color a color bomb detonates
// when it's CAUGHT in another effect's clear set (a chain), where there's no
// swap partner to name a target color the way an ordinary bomb swap has one.
// Counts every non-blocker piece carrying a matchType (ordinary AND striped
// pieces — a striped piece still has a color; color/area bombs are colorless, so
// they carry none and never count). Ties resolve toward the first matchType seen
// in row-major order (strict > keeps the earlier one), so the pick is fully
// deterministic — same board always chains the same way. Returns undefined only
// when no colored piece exists at all (a board of nothing but specials/blockers),
// in which case a caught color bomb just clears itself with no detonation.
function mostCommonMatchType(board: Board): string | undefined {
  const counts = new Map<string, number>();
  for (const row of board) {
    for (const cell of row) {
      if (cell.type === 'blocker' || cell.matchType === undefined) continue;
      counts.set(cell.matchType, (counts.get(cell.matchType) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [matchType, count] of counts) {
    if (count > bestCount) {
      best = matchType;
      bestCount = count;
    }
  }
  return best;
}

// Chain reaction — the deferred behavior finally built: a special piece caught in
// ANOTHER special's clear effect fires its OWN effect too, rather than just
// vanishing as ordinary content. Given a seed set of cells some effect is about
// to clear, this expands it to include the clear set of every other special the
// seed catches, repeating until no further special is reached. It's the one
// shared place chaining lives, called from resolveClearSet (so every
// swap-triggered effect chains: solo color bomb, area bomb, striped+striped,
// striped+bomb) AND from resolveMatchEffects (so an in-match striped sweep chains
// too) — so a special reacts identically however it was caught.
//
// `originKeys` are the special pieces the CALLING effect already fired or consumed
// itself: the swapped bomb, the two swapped stripeds, the supercombo's converted
// pieces, the in-match striped triggers. They sit in the seed (so they still
// clear) but must never re-fire — a chain is only the OTHER specials an effect
// catches, never the ones the effect already IS. Without this, e.g. a solo color
// bomb would re-detonate itself on the most-common color, and a striped+striped
// cross would fire each trigger's own line on top of the cross it defines.
//
// Each caught special contributes its own geometry:
//   - striped    → its full row or column, per its own `direction`
//   - area_bomb  → the 3x3 block centered on it
//   - color_bomb → every piece of the board's most common matchType (a caught
//                  bomb has no swap partner — see mostCommonMatchType)
//
// Blockers are never added (they only ever take adjacent damage — the one rule
// every caller already enforces on its own seed). It ALWAYS terminates: the board
// has finitely many cells, each cell enters `cleared` at most once, and only a
// freshly-cleared non-origin special is ever enqueued — so the chain must run dry
// the moment it stops reaching new specials, or once the whole board is cleared.
// Pure: reads the board, returns the fully-expanded position list.
function expandChainClears(board: Board, seed: Position[], originKeys: Set<string>): Position[] {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const keyOf = (r: number, c: number): string => `${r},${c}`;
  const cleared = new Set<string>();
  const queue: Position[] = [];

  const add = (r: number, c: number): void => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (!isClearable(board[r][c])) return;
    const key = keyOf(r, c);
    if (cleared.has(key)) return;
    cleared.add(key);
    // A special the calling effect didn't already fire is a chain source. Origins
    // still clear (added above) but are never enqueued, so they don't re-fire.
    const type = board[r][c].type;
    if (
      (type === 'striped' || type === 'area_bomb' || type === 'color_bomb') &&
      !originKeys.has(key)
    ) {
      queue.push({ row: r, col: c });
    }
  };

  for (const p of seed) add(p.row, p.col);

  while (queue.length > 0) {
    const pos = queue.shift() as Position;
    const piece = board[pos.row][pos.col];
    if (piece.type === 'striped') {
      const direction: StripeDirection = piece.direction === 'row' ? 'row' : 'col';
      for (const q of sweepLinePositions(rows, cols, pos, direction)) add(q.row, q.col);
    } else if (piece.type === 'area_bomb') {
      for (const q of areaBlastPositions(rows, cols, pos)) add(q.row, q.col);
    } else if (piece.type === 'color_bomb') {
      const target = mostCommonMatchType(board);
      if (target !== undefined) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cell = board[r][c];
            if (cell.type !== 'blocker' && cell.matchType === target) add(r, c);
          }
        }
      }
    }
  }

  return [...cleared].map((k) => {
    const [r, c] = k.split(',').map(Number);
    return { row: r, col: c };
  });
}

// The special piece an anchor cell is converted into this pass. A striped
// piece carries its sweep direction; a color bomb carries nothing (it's
// colorless — see matrix.ts's Piece comment); an area bomb is now also colorless
// and carries nothing (it drops the base cell's matchType, same as a color bomb,
// since it's swap-activated rather than matched). Kept as a discriminated union
// so resolveCascades builds each target piece correctly without a second lookup,
// and so adding a future special type is one more variant here.
type AnchorSpec =
  | { kind: 'striped'; direction: StripeDirection }
  | { kind: 'color_bomb' }
  | { kind: 'area_bomb' };

// Decides what each of this pass's matches (runs) and squares actually does —
// the one place the special-piece spawn rules live:
//  - a run that CONTAINS a live striped piece triggers it: the striped piece
//    sweeps its whole row or column (per its `direction`) into the clear set,
//    and the ordinary run cells clear too. A DIFFERENT special caught on that
//    swept line (another striped, a color bomb, an area bomb) now chains — fires
//    its own effect too — via expandChainClears at the tail of this function
//    (chaining is built; see that helper). Area bombs are NOT triggered by the
//    run itself: a colorless, swap-activated area bomb can never sit inside a run
//    (see resolveAreaBomb and applyMove for its swap trigger) — but one caught in
//    a striped sweep here does chain;
//  - a fresh 4-long run of ordinary pieces CONVERTS one cell into a striped
//    piece carrying the run's orientation as its clear direction, and clears
//    the other three;
//  - a fresh 5-long run CONVERTS one cell into a color bomb and clears the
//    other four. (A color bomb doesn't act here — it only fires when the
//    player swaps it, handled in applyMove. This branch just spawns it.);
//  - a fresh 2x2 SQUARE (from `squares`) CONVERTS its top-left cell into an
//    area bomb and clears the other three — but only if none of its four cells
//    is part of any run this pass. A square overlapping a run is an L/T/larger
//    shape, deferred (DEFERRED_COMPLEXITY.md): the run logic handles those
//    cells and the square stands down. The spawned area bomb is colorless
//    (drops its matchType, like a color bomb) and fires only when later
//    swapped (resolveAreaBomb), not passively. If one of the square's four
//    cells is already a live striped piece (matrix.ts's checkSquares allows
//    this through — see its squareEligible comment), no new area bomb spawns
//    at all: that striped piece fires its own sweep instead, the same
//    "an existing special fires itself rather than seeding a new one" rule
//    the run branch above applies;
//  - anything else (a plain 3-match, or a 6+ run) clears every cell.
// Blockers are never added to the clear set here: they only ever fall to
// adjacent damage (applyAdjacentDamage), so a striped sweep or area blast across
// a blocker still respects its hitsRemaining rather than force-clearing it. Pure
// — reads `board`, mutates nothing, returns the cells to gap and the anchor
// cells to convert into special pieces.
function resolveMatchEffects(
  board: Board,
  matches: Match[],
  squares: Square[]
): { clearedPositions: Position[]; anchors: Array<{ pos: Position } & AnchorSpec> } {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const keyOf = (r: number, c: number): string => `${r},${c}`;
  const clearedKeys = new Set<string>();
  const anchorByKey = new Map<string, AnchorSpec>();
  // The striped pieces that fire their own sweep in the loop below — the pass's
  // own triggers. Passed to expandChainClears as origins so they aren't treated
  // as caught specials and re-swept; only OTHER specials on their lines chain.
  const stripedTriggerKeys = new Set<string>();

  const addClear = (r: number, c: number): void => {
    if (isClearable(board[r][c])) clearedKeys.add(keyOf(r, c));
  };

  // Fires every live striped piece among `triggers` (its own line sweep) and
  // clears every cell in `allCells` alongside it. Shared by the run branch
  // below and the square branch further down — both answer the same question
  // ("a match already contains a live special — fire it, don't spawn a new
  // special over it") the same way, so this is the one place that logic lives
  // rather than being duplicated per shape.
  const fireStripedTriggersAndClearAll = (triggers: Position[], allCells: Position[]): void => {
    for (const p of triggers) {
      stripedTriggerKeys.add(keyOf(p.row, p.col));
      const piece = board[p.row][p.col];
      const direction: StripeDirection = piece.direction === 'row' ? 'row' : 'col';
      for (const q of sweepLinePositions(rows, cols, p, direction)) addClear(q.row, q.col);
    }
    for (const p of allCells) addClear(p.row, p.col);
  };

  // Every cell any run covers this pass — a square is only allowed to spawn an
  // area bomb when none of its four cells is in here (the pure-square rule that
  // keeps L/T/larger shapes deferred, see the doc above).
  const runCovered = new Set<string>();
  for (const match of matches) {
    for (const p of match.positions) runCovered.add(keyOf(p.row, p.col));
  }

  for (const match of matches) {
    const cells = match.positions;
    // Live striped pieces sitting in this run — a striped piece fires its line
    // sweep when it's included in a match (its passive trigger). Area bombs are
    // no longer collected here: they're colorless and swap-activated now (see
    // matrix.ts's piecesMatch and gameState.ts's resolveAreaBomb), so one can
    // never appear in a run's cells in the first place.
    const striped = cells.filter((p) => board[p.row][p.col].type === 'striped');

    if (striped.length > 0) {
      fireStripedTriggersAndClearAll(striped, cells);
    } else if (cells.length === 5) {
      const anchor = cells[0];
      anchorByKey.set(keyOf(anchor.row, anchor.col), { kind: 'color_bomb' });
      for (let i = 1; i < cells.length; i++) addClear(cells[i].row, cells[i].col);
    } else if (cells.length === 4) {
      const anchor = cells[0];
      anchorByKey.set(keyOf(anchor.row, anchor.col), { kind: 'striped', direction: match.orientation });
      for (let i = 1; i < cells.length; i++) addClear(cells[i].row, cells[i].col);
    } else {
      for (const p of cells) addClear(p.row, p.col);
    }
  }

  // Pure 2x2 squares → area bombs — unless the square already contains a live
  // striped piece, in which case that piece fires its own sweep instead (the
  // same rule the run branch above applies): checkSquares now allows a
  // striped corner through (see matrix.ts's squareEligible), so a square is no
  // longer guaranteed to be four plain ordinary pieces. Otherwise, same
  // anchor-conversion shape a 4-run uses for a striped piece: convert the
  // top-left cell, clear the other three (so a square credits 3 toward
  // objectives now; the bomb pays out the rest when it later fires).
  for (const square of squares) {
    if (square.positions.some((p) => runCovered.has(keyOf(p.row, p.col)))) continue;
    const stripedCorners = square.positions.filter((p) => board[p.row][p.col].type === 'striped');
    if (stripedCorners.length > 0) {
      fireStripedTriggersAndClearAll(stripedCorners, square.positions);
      continue;
    }
    const anchor = square.positions[0];
    anchorByKey.set(keyOf(anchor.row, anchor.col), { kind: 'area_bomb' });
    for (let i = 1; i < square.positions.length; i++) {
      addClear(square.positions[i].row, square.positions[i].col);
    }
  }

  // Chain reaction: any OTHER special the pass's clears catch — a striped piece,
  // color bomb, or area bomb lying on a swept line — fires its own effect too,
  // to fixpoint (see expandChainClears). The pass's own striped triggers are
  // excluded as origins so they don't re-sweep. Expansion reads the pre-pass
  // `board`, so a cell being converted into a special THIS pass (an anchor, still
  // ordinary on `board`) is never a chain source — a freshly-spawned special
  // never fires the same pass it's born. Run before the anchor-delete below so an
  // anchor cell a chain happens to sweep is still restored to a special, not
  // gapped.
  const seedPositions = [...clearedKeys].map((k) => {
    const [r, c] = k.split(',').map(Number);
    return { row: r, col: c };
  });
  clearedKeys.clear();
  for (const p of expandChainClears(board, seedPositions, stripedTriggerKeys)) {
    clearedKeys.add(keyOf(p.row, p.col));
  }

  // A cell chosen to become a special piece is never also gapped, even if an
  // overlapping match (or a chain sweep above) added it to the clear set — the
  // special piece wins.
  for (const k of anchorByKey.keys()) clearedKeys.delete(k);

  const parseKey = (k: string): Position => {
    const [r, c] = k.split(',').map(Number);
    return { row: r, col: c };
  };
  return {
    clearedPositions: [...clearedKeys].map(parseKey),
    anchors: [...anchorByKey.entries()].map(([k, spec]) => ({ pos: parseKey(k), ...spec })),
  };
}

function resolveCascades(
  board: Board,
  spawnPiece: () => Piece
): { board: Board; cascadeCount: number; clearedByMatchType: Record<string, number>; steps: Board[] } {
  let currentBoard = board;
  let cascadeCount = 0;
  const clearedByMatchType: Record<string, number> = {};
  // One settled board snapshot per cascade pass, in order, so the
  // presentation layer can animate each pass as a distinct beat instead of
  // diffing only the pre-move and final-settled boards (see DECISIONS.md's
  // cascade-steps entry). steps.length always equals cascadeCount; the last
  // entry equals the returned `board`. This is the exact per-pass state the
  // while loop already computes — exposing it, not recomputing anything.
  const steps: Board[] = [];

  while (true) {
    const matches = checkMatches(currentBoard);
    // Squares are a second, run-independent match shape (a pure 2x2 forms no
    // 3-in-a-row), so the cascade continues while EITHER exists — otherwise a
    // cascade that settles into a bare 2x2 would leave it un-triggered.
    const squares = checkSquares(currentBoard);
    if (matches.length === 0 && squares.length === 0) break;

    cascadeCount += 1;

    const { clearedPositions, anchors } = resolveMatchEffects(currentBoard, matches, squares);

    // Blockers don't match directly — they take damage from whatever clears
    // next to them (see matrix.ts's applyAdjacentDamage and DECISIONS.md),
    // now including a striped piece's line sweep. Any blocker that reaches
    // zero this pass clears alongside and joins the same cascade/refill.
    const { board: damagedBoard, newlyClearedBlockers } = applyAdjacentDamage(currentBoard, clearedPositions);

    // Count every cell that actually clears, by its matchType. The anchor
    // cell of a 4-match is excluded (it becomes a striped piece, it isn't
    // cleared), so a 4-match credits 3 toward objectives now and the striped
    // piece pays out the rest when it later triggers.
    for (const pos of clearedPositions) {
      const key = currentBoard[pos.row][pos.col].matchType ?? 'unknown';
      clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
    }
    for (const pos of newlyClearedBlockers) {
      const key = damagedBoard[pos.row][pos.col].matchType ?? 'unknown';
      clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
    }

    const withGaps = cloneBoardWithGaps(damagedBoard, [...clearedPositions, ...newlyClearedBlockers]);
    // Convert each anchor cell in place. It keeps its id (so the presentation
    // diff sees a piece that stayed put, not a new spawn) and survives this
    // pass's gravity like any other piece.
    //  - striped: keeps its matchType too (it's still a matchable piece of its
    //    own type until swept) and gains the type + clear direction.
    //  - area_bomb: drops matchType/direction entirely — like a color bomb it's
    //    now colorless (can never form an ordinary run, see matrix.ts's
    //    piecesMatch) and only fires when swapped (resolveAreaBomb via
    //    applyMove). Only its id is preserved, same as the color bomb.
    //  - color_bomb: drops matchType/direction entirely — it's colorless and
    //    can never form an ordinary run (see matrix.ts's piecesMatch), it only
    //    fires when swapped (applyMove).
    for (const anchor of anchors) {
      const base = currentBoard[anchor.pos.row][anchor.pos.col];
      withGaps[anchor.pos.row][anchor.pos.col] =
        anchor.kind === 'striped'
          ? { ...base, type: 'striped', direction: anchor.direction }
          : anchor.kind === 'area_bomb'
            ? { id: base.id, type: 'area_bomb' }
            : { id: base.id, type: 'color_bomb' };
    }
    currentBoard = calculateCascades(withGaps, spawnPiece);
    steps.push(currentBoard);
  }

  return { board: currentBoard, cascadeCount, clearedByMatchType, steps };
}

// Activates a color bomb swap — a genuinely different mechanism from a normal
// match (which resolveCascades drives). A color bomb doesn't clear by forming
// a run; it detonates the instant it's swapped:
//  - swapped with an ordinary/striped piece: clear every non-blocker piece
//    sharing that piece's matchType (including the swapped piece itself and
//    the bomb), regardless of whether a run would have formed;
//  - swapped with ANOTHER color bomb (the rarest, most set-up-intensive play,
//    confirmed with the architect): clear every non-blocker piece on the whole
//    board.
// Either way blockers are NOT force-cleared — they only ever take normal
// adjacent damage from the cells that clear around them (applyAdjacentDamage),
// exactly as they do for an ordinary match or a striped sweep, so a two-hit
// blocker genuinely still needs two hits no matter what triggers the clear.
// After the detonation clears + refills, any chain matches the refill creates
// resolve through the ordinary resolveCascades path, so bomb combos still
// cascade normally. Returns the same shape resolveCascades does, so applyMove
// treats both move kinds identically from here on. `bombPos` is where the
// swapped bomb sits; `otherPos` is the piece it was swapped with. Neither is
// physically swapped first — both cells clear regardless, so the swap itself
// is cosmetically irrelevant.
function resolveColorBomb(
  board: Board,
  bombPos: Position,
  otherPos: Position,
  spawnPiece: () => Piece
): { board: Board; cascadeCount: number; clearedByMatchType: Record<string, number>; steps: Board[] } {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const other = board[otherPos.row][otherPos.col];
  const detonateWholeBoard = other.type === 'color_bomb';
  const targetMatchType = other.matchType;

  const clearedPositions: Position[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const piece = board[r][c];
      // Blockers only ever fall to adjacent damage, never a direct clear; a
      // void is board shape, never content, and never clears at all (matters
      // most for detonateWholeBoard below, which would otherwise sweep every
      // void on a shaped board along with everything else).
      if (!isClearable(piece)) continue;
      const isBomb = r === bombPos.row && c === bombPos.col;
      const matchesTarget =
        piece.type !== 'color_bomb' && targetMatchType !== undefined && piece.matchType === targetMatchType;
      if (detonateWholeBoard || isBomb || matchesTarget) {
        clearedPositions.push({ row: r, col: c });
      }
    }
  }

  // The swapped bomb and its partner are THIS effect's own triggers — they clear
  // but don't chain (the bomb mustn't re-detonate on the most-common color; a
  // bomb partner in a whole-board swap mustn't either). Any OTHER special the
  // detonation catches — e.g. a striped piece of the target color elsewhere — is
  // not an origin, so it chains and fires its sweep.
  const originKeys = new Set<string>([
    `${bombPos.row},${bombPos.col}`,
    `${otherPos.row},${otherPos.col}`,
  ]);
  return resolveClearSet(board, clearedPositions, spawnPiece, originKeys);
}

// Activates an area-bomb swap — the same swap-triggered camp as the color bomb,
// but with a fixed LOCAL effect: it always clears the 3x3 block centered on the
// bomb's own cell, regardless of what it was swapped with (the partner just has
// to be an ordinary piece — an area+special swap is a deferred combo that
// applyMove snaps back before ever reaching here). This reverses the area bomb's
// original passive/colored trigger (see engine/DECISIONS.md's area-bomb reversal
// entry). `bombPos` is where the area bomb sits; it isn't physically swapped
// first, since the blast is centered on it and clears it regardless — the swap
// is cosmetically irrelevant, exactly like the color bomb. Blockers on the blast
// are filtered out of the clear set (they only ever take adjacent damage, never
// a force-clear) and the shared resolveClearSet tail does the detonation +
// refill + chain-cascade, so applyMove treats this like every other move kind
// from here on.
function resolveAreaBomb(
  board: Board,
  bombPos: Position,
  spawnPiece: () => Piece
): { board: Board; cascadeCount: number; clearedByMatchType: Record<string, number>; steps: Board[] } {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const clearedPositions = areaBlastPositions(rows, cols, bombPos).filter((p) =>
    isClearable(board[p.row][p.col])
  );
  // The area bomb itself is this effect's own trigger (it clears but doesn't
  // chain — its blast IS the seed). Any OTHER special caught in the 3x3 is not an
  // origin, so it chains and fires its own effect.
  const originKeys = new Set<string>([`${bombPos.row},${bombPos.col}`]);
  return resolveClearSet(board, clearedPositions, spawnPiece, originKeys);
}

// The shared "clear exactly these cells, then let the board settle" pipeline —
// the common tail of every swap-triggered effect that doesn't clear by forming
// a run (the color bomb and both special-piece combos below). Given a set of
// cells to clear, it: applies adjacent damage to any blockers beside them (only
// ever a one-hit-per-call knock, never a force-clear — clearedPositions must
// already EXCLUDE blocker cells, exactly as each caller builds it); counts every
// cleared cell (and any blocker that reached zero) by matchType so objectives
// credit correctly; gaps + refills; then hands the refilled board to the
// ordinary resolveCascades so any chain matches the refill creates still cascade
// normally. Returns the exact same shape resolveCascades does — the detonation
// is step one — so applyMove treats every move kind identically from here on.
function resolveClearSet(
  board: Board,
  clearedPositions: Position[],
  spawnPiece: () => Piece,
  originKeys: Set<string>
): { board: Board; cascadeCount: number; clearedByMatchType: Record<string, number>; steps: Board[] } {
  // Chain reaction first: fold in the clear set of every other special this
  // effect's cells catch (see expandChainClears). originKeys are the specials
  // THIS effect already fired (its bomb, its swapped stripeds, its converted
  // pieces) — they clear but never re-fire. Everything below counts and gaps the
  // fully-expanded set, so a chained sweep/blast credits its own cells to
  // objectives exactly like a first-order clear does.
  const expanded = expandChainClears(board, clearedPositions, originKeys);

  const { board: damagedBoard, newlyClearedBlockers } = applyAdjacentDamage(board, expanded);

  const clearedByMatchType: Record<string, number> = {};
  for (const pos of expanded) {
    const key = board[pos.row][pos.col].matchType ?? 'unknown';
    clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
  }
  for (const pos of newlyClearedBlockers) {
    const key = damagedBoard[pos.row][pos.col].matchType ?? 'unknown';
    clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
  }

  const withGaps = cloneBoardWithGaps(damagedBoard, [...expanded, ...newlyClearedBlockers]);
  const firstBoard = calculateCascades(withGaps, spawnPiece);

  // The detonation itself is the first beat; any matches its refill creates
  // chain through the ordinary cascade loop, so combos still resolve normally.
  const chained = resolveCascades(firstBoard, spawnPiece);
  for (const [matchType, count] of Object.entries(chained.clearedByMatchType)) {
    clearedByMatchType[matchType] = (clearedByMatchType[matchType] ?? 0) + count;
  }

  return {
    board: chained.board,
    cascadeCount: 1 + chained.cascadeCount,
    clearedByMatchType,
    steps: [firstBoard, ...chained.steps],
  };
}

// Combo 1: two striped pieces swapped directly into each other. Both sweeps fire
// at once, clearing a full cross — the entire row AND entire column through the
// swap — instead of each piece waiting to be included in a later ordinary match.
// The cross is centered on posA; posB is its adjacent swap partner, so it lies on
// one of the two swept lines and clears regardless. The combo overrides each
// piece's individual sweep direction (two stripeds always make a cross, even if
// both happened to be row-clearers), matching the genre and the "entire row and
// column" spec. Blocker cells are filtered out of the clear set — like every
// other mechanism, a blocker on the cross only takes adjacent damage (see
// resolveClearSet). Always a legal, committed move (it doesn't rely on a run) —
// hasLegalMoves treats a striped+striped pair as legal for the same reason.
function resolveStripedCross(
  board: Board,
  posA: Position,
  posB: Position,
  spawnPiece: () => Piece
): { board: Board; cascadeCount: number; clearedByMatchType: Record<string, number>; steps: Board[] } {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const keys = new Set<string>();
  for (const p of sweepLinePositions(rows, cols, posA, 'row')) keys.add(`${p.row},${p.col}`);
  for (const p of sweepLinePositions(rows, cols, posA, 'col')) keys.add(`${p.row},${p.col}`);
  const cleared = keysToClearablePositions(keys, board);
  // Both swapped stripeds are this combo's own triggers — the cross overrides
  // their individual directions, so neither re-fires its own line as a chain.
  // A THIRD striped (or a bomb) lying on the cross is not an origin and chains.
  const originKeys = new Set<string>([`${posA.row},${posA.col}`, `${posB.row},${posB.col}`]);
  return resolveClearSet(board, cleared, spawnPiece, originKeys);
}

// Combo 2: a striped piece swapped directly with a color bomb — the supercombo.
// Every non-blocker piece on the board sharing the striped piece's matchType is
// converted into a striped piece and then fired, all at once. Because a converted
// striped piece's only effect is to sweep its line, the settled result is exactly
// the union of those sweeps, which is what we compute directly here (the same way
// resolveColorBomb computes its clear set without physically staging the swap) —
// the intermediate "everything flashes striped" frame is a presentation nicety,
// deferred (see DEFERRED_COMPLEXITY.md). Directions alternate row/col by
// discovery order so the supercombo clears both full rows and full columns rather
// than one orientation. The bomb cell is consumed too. Blockers are filtered out
// and only take adjacent damage. Always legal (the bomb already makes any swap
// involving it legal in hasLegalMoves).
function resolveStripedBombCombo(
  board: Board,
  stripedPos: Position,
  bombPos: Position,
  spawnPiece: () => Piece
): { board: Board; cascadeCount: number; clearedByMatchType: Record<string, number>; steps: Board[] } {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const targetMatchType = board[stripedPos.row][stripedPos.col].matchType;
  const keys = new Set<string>();
  keys.add(`${bombPos.row},${bombPos.col}`); // the bomb consumes itself
  // The bomb and every piece this combo converts-and-fires are its own triggers —
  // they clear but never chain. This matters because a matching cell may ALREADY
  // be a striped piece on the board: without it here, expandChainClears would
  // re-sweep that piece along its ORIGINAL direction on top of the alternating
  // one the combo assigned, over-clearing beyond the defined supercombo. A
  // DIFFERENT-colored special the sweeps catch is not in here, so it still chains.
  const originKeys = new Set<string>([`${bombPos.row},${bombPos.col}`]);
  let converted = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const piece = board[r][c];
      if (piece.type === 'blocker' || piece.type === 'color_bomb') continue;
      if (targetMatchType === undefined || piece.matchType !== targetMatchType) continue;
      // Convert this matching piece to a striped piece and fire it immediately.
      originKeys.add(`${r},${c}`);
      const direction: StripeDirection = converted % 2 === 0 ? 'row' : 'col';
      converted += 1;
      for (const p of sweepLinePositions(rows, cols, { row: r, col: c }, direction)) {
        keys.add(`${p.row},${p.col}`);
      }
    }
  }
  const cleared = keysToClearablePositions(keys, board);
  return resolveClearSet(board, cleared, spawnPiece, originKeys);
}

// Turns a set of "r,c" cell keys into the Position list resolveClearSet wants,
// dropping any cell that can't be force-cleared (see isClearable) — a blocker,
// so it only ever takes adjacent damage, and a void, so a combo's sweep lines
// can never eat through a shaped board's fixed holes.
function keysToClearablePositions(keys: Set<string>, board: Board): Position[] {
  const out: Position[] = [];
  for (const k of keys) {
    const [r, c] = k.split(',').map(Number);
    if (isClearable(board[r][c])) out.push({ row: r, col: c });
  }
  return out;
}

// Total blocker hitsRemaining across the board — the denial zone's "health."
// Compared before vs after a move resolves to decide whether the zone was
// ADDRESSED this move (any blocker hit or cleared lowers it). Matches can only
// ever lower it (a match never adds a blocker; spread runs after this check), so
// a strict decrease is an unambiguous "the player engaged the zone" signal.
function blockerHealth(board: Board): number {
  let total = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell.type === 'blocker') total += cell.hitsRemaining ?? 1;
    }
  }
  return total;
}

// Strips the transient spreadWarning flag off every cell that carries it,
// returning a new board only when something changed (so an unwarned board keeps
// its identity). The warning is recomputed from scratch each move, so it's
// always cleared first rather than mutated in place.
function clearSpreadWarnings(board: Board): Board {
  let changed = false;
  const next = board.map((row) =>
    row.map((cell) => {
      if (!cell.spreadWarning) return cell;
      changed = true;
      const { spreadWarning, ...rest } = cell;
      return rest;
    })
  );
  return changed ? next : board;
}

// Advances the denial zone one move. Pure: takes the settled post-cascade board
// plus the current spread state and whether the zone was addressed this move,
// returns the next board (with a warning marked, a cell spread, or neither) and
// the next spread state. The three outcomes:
//   - addressed        → reset the clock to 0, cancel any warning
//   - reaches interval  → SPREAD: the frontier ordinary cell becomes a blocker
//   - reaches interval-1→ WARNING: the frontier cell is flagged (growing crack)
// Any prior warning is always cleared first, then recomputed, so a warning never
// lingers past the one move it's meant to precede.
function stepDenialZone(
  board: Board,
  denial: DenialSpreadState,
  addressed: boolean
): { board: Board; denial: DenialSpreadState } {
  const cleared = clearSpreadWarnings(board);

  if (addressed) {
    return { board: cleared, denial: { ...denial, movesUnaddressed: 0 } };
  }

  const movesUnaddressed = denial.movesUnaddressed + 1;

  if (movesUnaddressed >= denial.spreadInterval) {
    const spot = findSpreadTarget(cleared);
    if (!spot) {
      // Zone fully boxed in — nowhere to grow. Hold at the threshold rather
      // than resetting, so it spreads the instant a neighbor opens up instead
      // of making the player wait out another full interval.
      return { board: cleared, denial: { ...denial, movesUnaddressed: denial.spreadInterval } };
    }
    const source = cleared[spot.source.row][spot.source.col];
    const targetPiece = cleared[spot.target.row][spot.target.col];
    const nextBoard = cleared.map((row) => row.slice());
    nextBoard[spot.target.row][spot.target.col] = {
      // Reuse the target cell's id so the tile morphs into a blocker in place
      // (boardDiff sees no clear/spawn) — the cell was denied, it didn't leave.
      id: targetPiece.id,
      type: 'blocker',
      matchType: source.matchType,
      hitsRemaining: denial.blockerHitsToClear,
    };
    return { board: nextBoard, denial: { ...denial, movesUnaddressed: 0 } };
  }

  if (movesUnaddressed === denial.spreadInterval - 1) {
    const spot = findSpreadTarget(cleared);
    if (spot) {
      const targetPiece = cleared[spot.target.row][spot.target.col];
      const nextBoard = cleared.map((row) => row.slice());
      nextBoard[spot.target.row][spot.target.col] = { ...targetPiece, spreadWarning: true };
      return { board: nextBoard, denial: { ...denial, movesUnaddressed } };
    }
  }

  return { board: cleared, denial: { ...denial, movesUnaddressed } };
}

// Fires when a single move triggers this many chained cascades or more.
const COMBO_STREAK_THRESHOLD = 4;

export function applyMove(state: GameState, posA: Position, posB: Position): ApplyMoveResult {
  if (state.status !== 'in_progress') {
    return { state, events: [], steps: [] };
  }

  // Blockers aren't swappable at all — moving one out of its cell would
  // dodge the adjacent-damage mechanic entirely, so this is rejected the
  // same way a no-match swap is: snap back, no move spent, no events. Checked
  // before the color-bomb branch below so a bomb-with-blocker swap is rejected
  // too (a blocker is never a valid detonation partner), matching the same
  // exclusion hasLegalMoves makes.
  const pieceA = state.board[posA.row][posA.col];
  const pieceB = state.board[posB.row][posB.col];
  if (pieceA.type === 'blocker' || pieceB.type === 'blocker') {
    return { state, events: [], steps: [] };
  }

  // Void cells are holes in the board's shape, never pieces — a swap into or
  // out of one can't happen. Rejected exactly like a blocker/no-match swap: no
  // move spent, no state change. This is the safety net for a drag from a cell
  // on the board's edge toward a neighbouring void (dragDirection only
  // bounds-checks the rectangle, not the shape); hasLegalMoves excludes voids
  // too, so a board is never wrongly judged stuck because of one.
  if (pieceA.type === 'void' || pieceB.type === 'void') {
    return { state, events: [], steps: [] };
  }

  // Special-piece swaps activate on the swap itself, NOT by forming a match, so
  // they bypass the no-match snap-back check below entirely (always legal,
  // committed moves — hasLegalMoves is extended to match). The branch ORDER here
  // is load-bearing:
  //
  //   0. area bomb + anything  → 3x3 blast (resolveAreaBomb), OR snap back if the
  //                              partner is another special (deferred combo)
  //   1. striped + color bomb  → supercombo (resolveStripedBombCombo)
  //   2. striped + striped     → cross clear (resolveStripedCross)
  //   3. color bomb + anything → solo bomb   (resolveColorBomb)
  //   4. ordinary swap         → match-or-snap-back
  //
  // (0) MUST come before (3): an area+color_bomb swap is also "bomb-involving,"
  // but the area bomb is colorless (no matchType), so resolveColorBomb would run
  // a degenerate single-type clear on `undefined` and detonate only the bomb
  // cell. area+special is a DEFERRED combo (see DEFERRED_COMPLEXITY.md), so it
  // snaps back with no move spent instead — hasLegalMoves is matched. area+
  // ordinary fires the local 3x3 blast. The area branch only fires when an area
  // bomb is actually involved, so it's inert for every non-area swap below.
  // (1) MUST come before (3): a striped+bomb swap is also "bomb-involving," and a
  // striped piece carries a matchType, so resolveColorBomb would happily accept
  // it as an ordinary detonation partner and run the WEAKER single-type clear
  // instead of the convert-every-matching-piece-to-striped supercombo. Checking
  // it first is the only thing guaranteeing the stronger effect wins.
  // (2) MUST come before (4): two striped pieces don't necessarily form a run, so
  // the ordinary branch would snap them back instead of comboing.
  const aArea = pieceA.type === 'area_bomb';
  const bArea = pieceB.type === 'area_bomb';
  const aStriped = pieceA.type === 'striped';
  const bStriped = pieceB.type === 'striped';
  const aBomb = pieceA.type === 'color_bomb';
  const bBomb = pieceB.type === 'color_bomb';
  let resolved: { board: Board; cascadeCount: number; clearedByMatchType: Record<string, number>; steps: Board[] };
  if (aArea || bArea) {
    const partner = aArea ? pieceB : pieceA;
    if (partner.type === 'area_bomb' || partner.type === 'striped' || partner.type === 'color_bomb') {
      // area + special is a deferred combo (area+color_bomb, area+striped,
      // area+area) — snap back exactly like a no-match swap: no move spent, no
      // state change. See DEFERRED_COMPLEXITY.md.
      return { state, events: [], steps: [] };
    }
    // area + ordinary: fire the 3x3 blast centered on the bomb, regardless of
    // what it was swapped with or whether a run would have formed.
    const bombPos = aArea ? posA : posB;
    resolved = resolveAreaBomb(state.board, bombPos, state.spawnPiece);
  } else if ((aStriped && bBomb) || (aBomb && bStriped)) {
    const stripedPos = aStriped ? posA : posB;
    const bombPos = aBomb ? posA : posB;
    resolved = resolveStripedBombCombo(state.board, stripedPos, bombPos, state.spawnPiece);
  } else if (aStriped && bStriped) {
    resolved = resolveStripedCross(state.board, posA, posB, state.spawnPiece);
  } else if (aBomb || bBomb) {
    // Solo bomb. If both are bombs either assignment works (resolveColorBomb
    // detonates the whole board regardless).
    const bombPos = aBomb ? posA : posB;
    const otherPos = aBomb ? posB : posA;
    resolved = resolveColorBomb(state.board, bombPos, otherPos, state.spawnPiece);
  } else {
    const swapped = swapPieces(state.board, posA, posB);
    // A swap is legal if it forms a straight run OR a 2x2 square (which spawns
    // an area bomb — see resolveMatchEffects). A pure square forms no
    // 3-in-a-row, so checkSquares must be consulted here too, or a valid
    // square-forming move would be wrongly snapped back as a no-match swap.
    if (checkMatches(swapped).length === 0 && checkSquares(swapped).length === 0) {
      // Illegal move: no match, snap back. No move spent, no state change.
      return { state, events: [], steps: [] };
    }
    resolved = resolveCascades(swapped, state.spawnPiece);
  }

  const { board: cascadedBoard, cascadeCount, clearedByMatchType, steps } = resolved;

  // Dynamic denial-zone spread (gated levels only — state.denialSpread is
  // undefined everywhere else, so blockers stay static). Runs on the settled
  // post-cascade board and BEFORE the legal-move rescue below, so a
  // spread-created blocker is covered by the same hasLegalMoves guarantee as
  // everything else. "Addressed" = the zone lost blocker health this move (any
  // blocker damaged or cleared, comparing the pre-move board to the settled
  // one), which resets the spread clock and cancels any pending warning.
  let denialSpread = state.denialSpread;
  let settledBoard = cascadedBoard;
  if (denialSpread) {
    const addressed = blockerHealth(cascadedBoard) < blockerHealth(state.board);
    const stepped = stepDenialZone(cascadedBoard, denialSpread, addressed);
    settledBoard = stepped.board;
    denialSpread = stepped.denial;
  }

  // A settled cascade can leave a board with zero legal moves — confirmed
  // during real mobile playtesting as a genuine mid-play stuck state, not
  // just a theoretical edge case. `generateLevel` (generator.ts) already
  // runs this exact hasLegalMoves -> shuffle rescue once at level creation;
  // reusing both functions here rather than writing new logic keeps
  // "board is playable" a single guarantee enforced the same way at both
  // points it can be violated. No event fires for this — a shuffle should
  // read as silent and immediate to the player, not an announced
  // interruption, per CLAUDE.md's calm-pacing constraint.
  const resolvedBoard = hasLegalMoves(settledBoard) ? settledBoard : shuffle(settledBoard);

  const totalCleared = { ...state.totalCleared };
  for (const [matchType, count] of Object.entries(clearedByMatchType)) {
    totalCleared[matchType] = (totalCleared[matchType] ?? 0) + count;
  }

  const objectives: Objective[] = state.objectives.map((objective) => ({
    ...objective,
    currentCount: objective.currentCount + (clearedByMatchType[objective.targetMatchType] ?? 0),
  }));

  const movesRemaining = state.movesRemaining - 1;

  let status: GameStatus = state.status;
  let pauseReason: PauseReason = state.pauseReason;
  // Win requires every objective met, not just one — a two-objective level
  // with only one target satisfied stays in_progress (or pauses on moves)
  // exactly like an unmet single-objective level always has.
  if (objectives.every((objective) => objective.currentCount >= objective.targetCount)) {
    status = 'won';
    pauseReason = null;
  } else if (movesRemaining <= 0) {
    status = 'paused_awaiting_input';
    pauseReason = 'moves';
  }

  const events: EngineEvent[] = [];
  if (cascadeCount >= COMBO_STREAK_THRESHOLD) {
    events.push({ type: 'combo_streak', cascadeCount, clearedByMatchType });
  }
  // paused_awaiting_input IS this phase's "loss" outcome (see DECISIONS.md)
  // — a resource hit zero without the objective met, and the matching grant
  // function (grantBonusMoves / grantBonusLife) is the only way out of it.
  // The summary event fires for both ways a level can end: reaching the
  // objective, or running out of a resource.
  if (status === 'won' || status === 'paused_awaiting_input') {
    events.push({
      type: 'level_summary',
      outcome: status,
      reason: pauseReason,
      clearedByMatchType: totalCleared,
    });
  }

  const newState: GameState = {
    ...state,
    board: resolvedBoard,
    movesRemaining,
    objectives,
    status,
    pauseReason,
    totalCleared,
    denialSpread,
  };

  // resolveCascades' last step is the pre-rescue cascadedBoard; the state
  // actually committed is resolvedBoard (identical unless a zero-legal-move
  // rescue shuffle fired). Overwrite the final step so animating through
  // `steps` always ends exactly on state.board — a rescue shuffle folds into
  // that last beat rather than becoming a visible extra rearrangement, per
  // its "silent and immediate" intent (see DECISIONS.md). steps is always
  // non-empty here: an ordinary swap reached this point only because `swapped`
  // had at least one match (resolveCascades ran ≥1 pass), and every special
  // swap (bomb / cross / supercombo) returns the detonation itself as step one
  // via resolveClearSet — so there is always a final step to overwrite.
  const finalSteps = steps.slice();
  finalSteps[finalSteps.length - 1] = resolvedBoard;

  return { state: newState, events, steps: finalSteps };
}

// The engine doesn't know or care what triggers this (rewarded ad, IAP,
// whatever) — that decision lives entirely outside the engine. It only
// knows how to resume play from the paused state. Checks pauseReason (not
// just status) so this stays correct if a second pause reason is ever
// reintroduced — see PauseReason's comment on why 'lives' was removed.
export function grantBonusMoves(state: GameState, n: number): GameState {
  if (state.status !== 'paused_awaiting_input' || state.pauseReason !== 'moves') {
    return state;
  }
  return {
    ...state,
    movesRemaining: state.movesRemaining + n,
    status: 'in_progress',
    pauseReason: null,
  };
}

export interface SaveData {
  skinId: string;
  currentLevel: number;
  lives: number;
  // Known, accepted tradeoff: this is set from Date.now() at grant time, so
  // a player can get more lives than intended by winding the device clock
  // back. Not worth solving at this scale — see CLAUDE.md's Data Model
  // Notes and DECISIONS.md.
  livesLastRegenAt: number;
  itemsCollected: Record<string, number>;
  powerUpCounts: Record<string, number>;
  // 1-based level numbers the player has won at least once, feeding the
  // dashboard screen. Optional (not just defaulted to []) so save files
  // written before the level queue existed still parse — a hard schema
  // migration isn't worth it at this scale, same call as livesLastRegenAt
  // above. Every new write (see appPersistence.ts's buildSaveData) always
  // populates it; readers fall back to [] themselves.
  completedLevels?: number[];
  // IDs of one-time tutorial popups the player has already dismissed (e.g.
  // 'blocker') — a plain string list, not a bespoke boolean per tutorial,
  // so a later power-up tutorial is one more entry here rather than a
  // second bespoke flag and a second bespoke check. Optional for the same
  // pre-existing-save-file reason as completedLevels above; readers fall
  // back to [] themselves.
  seenTutorials?: string[];
  // IDs of recipe cards (skinConfig.recipeCards) the player has unlocked by
  // winning that card's milestone level at least once — same plain-list,
  // optional-for-pre-existing-saves shape as seenTutorials above, not a
  // richer "unlocked at timestamp X" record, since nothing reads anything
  // beyond membership (see appPersistence.ts's unlockRecipeCard).
  unlockedRecipeCards?: string[];
  // Whether in-game sound effects (match/cascade/win) should play. Optional
  // for the same pre-existing-save-file reason as completedLevels/
  // seenTutorials/unlockedRecipeCards above — a save written before this
  // field existed still parses; App.tsx's applyLoadedSave resolves the real
  // default (off, per CLAUDE.md's Design Constraints: the target player
  // finds game sound distracting) at read time via `??`, never here.
  soundEnabled?: boolean;
  // Whether haptic feedback (a light tap on a successful match) should
  // fire. Independent of soundEnabled — a different sensory channel, so a
  // player can want tactile confirmation without audio or vice versa. Same
  // optional-for-old-saves shape; App.tsx's applyLoadedSave resolves the
  // real default (also off, for the same calm-by-default reasoning as
  // sound — no documented user research exists for haptics specifically).
  hapticsEnabled?: boolean;
}

// Small interface matching @react-native-async-storage/async-storage's
// actual getItem/setItem shape (both real signatures also accept an
// optional trailing callback, which is structurally compatible with this
// narrower shape), so the real package below is a drop-in `AsyncStorageLike`
// with no adapter code needed. `createInMemoryStorage` is kept as an
// explicit, dependency-free option for tests that don't want to touch real
// storage — see DECISIONS.md.
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  // Deletes a key entirely — the honest way to clear a save (writing an empty
  // value would leave a non-null blob that loadSave would then JSON.parse).
  // The real AsyncStorage.removeItem(key, callback?) is structurally compatible
  // with this narrower shape, same as getItem/setItem above, so the package
  // stays a drop-in with no adapter.
  removeItem(key: string): Promise<void>;
}

export function createInMemoryStorage(): AsyncStorageLike {
  const store = new Map<string, string>();
  return {
    async getItem(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async setItem(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

// Real, persisted storage: native iOS/Android get the actual native
// AsyncStorage module; Expo's web target gets the package's own
// window.localStorage-backed fallback (see
// node_modules/@react-native-async-storage/async-storage/src/AsyncStorage.ts)
// — both resolve automatically through this one import, no platform branch
// needed here.
const defaultStorage: AsyncStorageLike = AsyncStorage;

function saveKey(skinId: string): string {
  return `lalas-kitchen:save:${skinId}`;
}

export async function loadSave(
  skinId: string,
  storage: AsyncStorageLike = defaultStorage
): Promise<SaveData | null> {
  const raw = await storage.getItem(saveKey(skinId));
  return raw === null ? null : (JSON.parse(raw) as SaveData);
}

export async function saveProgress(
  skinId: string,
  data: SaveData,
  storage: AsyncStorageLike = defaultStorage
): Promise<void> {
  await storage.setItem(saveKey(skinId), JSON.stringify(data));
}

// Deletes this skin's entire save so the next loadSave returns null — the exact
// "fresh install" state. Used only by the dev-only reset (see App.tsx's
// handleDevReset); a normal player never triggers it. Removing the key (rather
// than writing a blank SaveData) means "no save" and "reset save" are the same
// state, so the app's real first-run path can be reused verbatim afterward.
export async function clearSave(
  skinId: string,
  storage: AsyncStorageLike = defaultStorage
): Promise<void> {
  await storage.removeItem(saveKey(skinId));
}
