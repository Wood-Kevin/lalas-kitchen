import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Board,
  Piece,
  Position,
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

function resolveCascades(
  board: Board,
  spawnPiece: () => Piece
): { board: Board; cascadeCount: number; clearedByMatchType: Record<string, number> } {
  let currentBoard = board;
  let cascadeCount = 0;
  const clearedByMatchType: Record<string, number> = {};

  while (true) {
    const matches = checkMatches(currentBoard);
    if (matches.length === 0) break;

    cascadeCount += 1;
    for (const match of matches) {
      const key = match.matchType ?? 'unknown';
      clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + match.positions.length;
    }

    const matchPositions = matches.flatMap((m) => m.positions);

    // Blockers don't match directly — they take damage from whatever match
    // clears next to them (see matrix.ts's applyAdjacentDamage and
    // DECISIONS.md). Any blocker that reaches zero hits this pass clears
    // alongside the triggering match and joins the same cascade/refill.
    const { board: damagedBoard, newlyClearedBlockers } = applyAdjacentDamage(currentBoard, matchPositions);
    for (const pos of newlyClearedBlockers) {
      const key = damagedBoard[pos.row][pos.col].matchType ?? 'unknown';
      clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
    }

    const allPositions = [...matchPositions, ...newlyClearedBlockers];
    const withGaps = cloneBoardWithGaps(damagedBoard, allPositions);
    currentBoard = calculateCascades(withGaps, spawnPiece);
  }

  return { board: currentBoard, cascadeCount, clearedByMatchType };
}

// Fires when a single move triggers this many chained cascades or more.
const COMBO_STREAK_THRESHOLD = 4;

export function applyMove(state: GameState, posA: Position, posB: Position): ApplyMoveResult {
  if (state.status !== 'in_progress') {
    return { state, events: [] };
  }

  // Blockers aren't swappable at all — moving one out of its cell would
  // dodge the adjacent-damage mechanic entirely, so this is rejected the
  // same way a no-match swap is: snap back, no move spent, no events.
  const pieceA = state.board[posA.row][posA.col];
  const pieceB = state.board[posB.row][posB.col];
  if (pieceA.type === 'blocker' || pieceB.type === 'blocker') {
    return { state, events: [] };
  }

  const swapped = swapPieces(state.board, posA, posB);
  if (checkMatches(swapped).length === 0) {
    // Illegal move: no match, snap back. No move spent, no state change.
    return { state, events: [] };
  }

  const { board: cascadedBoard, cascadeCount, clearedByMatchType } = resolveCascades(
    swapped,
    state.spawnPiece
  );

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

  return { state: newState, events };
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
