import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Board,
  Piece,
  Position,
  Match,
  StripeDirection,
  checkMatches,
  swapPieces,
  calculateCascades,
  hasLegalMoves,
  shuffle,
  applyAdjacentDamage,
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
}

export function createGameState(config: LevelConfig): GameState {
  const board = generateLevel(config.seed, {
    rows: config.rows,
    cols: config.cols,
    pieceTypeIds: config.pieceTypeIds,
    blockerCount: config.blockerCount,
    blockerMatchType: config.blockerMatchType,
    blockerHitsToClear: config.blockerHitsToClear,
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
  };
}

function cloneBoardWithGaps(board: Board, positions: Position[]): Array<Array<Piece | null>> {
  const next: Array<Array<Piece | null>> = board.map((row) => row.slice());
  for (const pos of positions) {
    next[pos.row][pos.col] = null;
  }
  return next;
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

// The special piece an anchor cell is converted into this pass. A striped
// piece carries its sweep direction; a color bomb carries nothing (it's
// colorless — see matrix.ts's Piece comment). Kept as a discriminated union
// so resolveCascades builds each target piece correctly without a second
// lookup, and so adding a future special type is one more variant here.
type AnchorSpec =
  | { kind: 'striped'; direction: StripeDirection }
  | { kind: 'color_bomb' };

// Decides what each of this pass's matches actually does — the one place the
// special-piece spawn rules live:
//  - a match that CONTAINS a striped piece triggers it, sweeping that piece's
//    whole row or column (per its `direction`) into the clear set, plus the
//    ordinary match cells;
//  - a fresh 4-long run of ordinary pieces CONVERTS one cell into a striped
//    piece carrying the run's orientation as its clear direction, and clears
//    the other three;
//  - a fresh 5-long run CONVERTS one cell into a color bomb and clears the
//    other four. (A color bomb doesn't act here — it only fires when the
//    player swaps it, handled in applyMove. This branch just spawns it.);
//  - anything else (a plain 3-match, or a 6+ run — L/T-shape triggers and
//    longer specials aren't in scope this session, see DEFERRED_COMPLEXITY.md)
//    clears every cell.
// Blockers are never added to the clear set here: they only ever fall to
// adjacent damage (applyAdjacentDamage), so a striped sweep across a blocker
// still respects its hitsRemaining rather than force-clearing it. Pure —
// reads `board`, mutates nothing, returns the cells to gap and the anchor
// cells to convert into special pieces.
function resolveMatchEffects(
  board: Board,
  matches: Match[]
): { clearedPositions: Position[]; anchors: Array<{ pos: Position } & AnchorSpec> } {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const keyOf = (r: number, c: number): string => `${r},${c}`;
  const clearedKeys = new Set<string>();
  const anchorByKey = new Map<string, AnchorSpec>();

  const addClear = (r: number, c: number): void => {
    if (board[r][c].type !== 'blocker') clearedKeys.add(keyOf(r, c));
  };

  for (const match of matches) {
    const cells = match.positions;
    const containsStriped = cells.some((p) => board[p.row][p.col].type === 'striped');

    if (containsStriped) {
      // A striped piece was part of this match — sweep its full line. (Its
      // own effect firing does NOT recursively trigger other striped pieces
      // caught in the sweep this pass; those just clear. Chaining is deferred,
      // see DEFERRED_COMPLEXITY.md.)
      for (const p of cells) {
        const piece = board[p.row][p.col];
        if (piece.type !== 'striped') continue;
        const direction: StripeDirection = piece.direction === 'row' ? 'row' : 'col';
        for (const q of sweepLinePositions(rows, cols, p, direction)) addClear(q.row, q.col);
      }
      for (const p of cells) addClear(p.row, p.col);
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

  // A cell chosen to become a special piece is never also gapped, even if an
  // overlapping match added it to the clear set — the special piece wins.
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
    if (matches.length === 0) break;

    cascadeCount += 1;

    const { clearedPositions, anchors } = resolveMatchEffects(currentBoard, matches);

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
    //  - color_bomb: drops matchType/direction entirely — it's colorless and
    //    can never form an ordinary run (see matrix.ts's piecesMatch), it only
    //    fires when swapped (applyMove).
    for (const anchor of anchors) {
      const base = currentBoard[anchor.pos.row][anchor.pos.col];
      withGaps[anchor.pos.row][anchor.pos.col] =
        anchor.kind === 'striped'
          ? { ...base, type: 'striped', direction: anchor.direction }
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
      // Blockers only ever fall to adjacent damage, never a direct clear.
      if (piece.type === 'blocker') continue;
      const isBomb = r === bombPos.row && c === bombPos.col;
      const matchesTarget =
        piece.type !== 'color_bomb' && targetMatchType !== undefined && piece.matchType === targetMatchType;
      if (detonateWholeBoard || isBomb || matchesTarget) {
        clearedPositions.push({ row: r, col: c });
      }
    }
  }

  return resolveClearSet(board, clearedPositions, spawnPiece);
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
  spawnPiece: () => Piece
): { board: Board; cascadeCount: number; clearedByMatchType: Record<string, number>; steps: Board[] } {
  const { board: damagedBoard, newlyClearedBlockers } = applyAdjacentDamage(board, clearedPositions);

  const clearedByMatchType: Record<string, number> = {};
  for (const pos of clearedPositions) {
    const key = board[pos.row][pos.col].matchType ?? 'unknown';
    clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
  }
  for (const pos of newlyClearedBlockers) {
    const key = damagedBoard[pos.row][pos.col].matchType ?? 'unknown';
    clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
  }

  const withGaps = cloneBoardWithGaps(damagedBoard, [...clearedPositions, ...newlyClearedBlockers]);
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
  return resolveClearSet(board, cleared, spawnPiece);
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
  let converted = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const piece = board[r][c];
      if (piece.type === 'blocker' || piece.type === 'color_bomb') continue;
      if (targetMatchType === undefined || piece.matchType !== targetMatchType) continue;
      // Convert this matching piece to a striped piece and fire it immediately.
      const direction: StripeDirection = converted % 2 === 0 ? 'row' : 'col';
      converted += 1;
      for (const p of sweepLinePositions(rows, cols, { row: r, col: c }, direction)) {
        keys.add(`${p.row},${p.col}`);
      }
    }
  }
  const cleared = keysToClearablePositions(keys, board);
  return resolveClearSet(board, cleared, spawnPiece);
}

// Turns a set of "r,c" cell keys into the Position list resolveClearSet wants,
// dropping any blocker cell so blockers only ever take adjacent damage (the one
// blocker rule shared by every clearing mechanism).
function keysToClearablePositions(keys: Set<string>, board: Board): Position[] {
  const out: Position[] = [];
  for (const k of keys) {
    const [r, c] = k.split(',').map(Number);
    if (board[r][c].type !== 'blocker') out.push({ row: r, col: c });
  }
  return out;
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

  // Special-piece swaps activate on the swap itself, NOT by forming a match, so
  // they bypass the no-match snap-back check below entirely (always legal,
  // committed moves — hasLegalMoves is extended to match). The branch ORDER here
  // is load-bearing:
  //
  //   1. striped + color bomb  → supercombo (resolveStripedBombCombo)
  //   2. striped + striped     → cross clear (resolveStripedCross)
  //   3. color bomb + anything → solo bomb   (resolveColorBomb)
  //   4. ordinary swap         → match-or-snap-back
  //
  // (1) MUST come before (3): a striped+bomb swap is also "bomb-involving," and a
  // striped piece carries a matchType, so resolveColorBomb would happily accept
  // it as an ordinary detonation partner and run the WEAKER single-type clear
  // instead of the convert-every-matching-piece-to-striped supercombo. Checking
  // it first is the only thing guaranteeing the stronger effect wins.
  // (2) MUST come before (4): two striped pieces don't necessarily form a run, so
  // the ordinary branch would snap them back instead of comboing.
  const aStriped = pieceA.type === 'striped';
  const bStriped = pieceB.type === 'striped';
  const aBomb = pieceA.type === 'color_bomb';
  const bBomb = pieceB.type === 'color_bomb';
  let resolved: { board: Board; cascadeCount: number; clearedByMatchType: Record<string, number>; steps: Board[] };
  if ((aStriped && bBomb) || (aBomb && bStriped)) {
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
    if (checkMatches(swapped).length === 0) {
      // Illegal move: no match, snap back. No move spent, no state change.
      return { state, events: [], steps: [] };
    }
    resolved = resolveCascades(swapped, state.spawnPiece);
  }

  const { board: cascadedBoard, cascadeCount, clearedByMatchType, steps } = resolved;

  // A settled cascade can leave a board with zero legal moves — confirmed
  // during real mobile playtesting as a genuine mid-play stuck state, not
  // just a theoretical edge case. `generateLevel` (generator.ts) already
  // runs this exact hasLegalMoves -> shuffle rescue once at level creation;
  // reusing both functions here rather than writing new logic keeps
  // "board is playable" a single guarantee enforced the same way at both
  // points it can be violated. No event fires for this — a shuffle should
  // read as silent and immediate to the player, not an announced
  // interruption, per CLAUDE.md's calm-pacing constraint.
  const resolvedBoard = hasLegalMoves(cascadedBoard) ? cascadedBoard : shuffle(cascadedBoard);

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
