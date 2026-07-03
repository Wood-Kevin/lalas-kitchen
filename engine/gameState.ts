import AsyncStorage from '@react-native-async-storage/async-storage';
import { Board, Piece, Position, checkMatches, swapPieces, calculateCascades } from './matrix';
import { generateLevel } from './generator';

// Re-exported so components/ can depend on gameState.ts alone for the
// engine-facing types it needs, instead of also reaching into matrix.ts
// directly — gameState.ts is already the presentation layer's boundary
// for GameState, LevelConfig, etc., so Position belongs on that same seam.
export type { Position };

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
// lets a future skin show different messaging per pause type ("out of
// moves" vs "out of lives") without the engine needing to know what that
// messaging is — same "engine emits data, skin decides presentation"
// separation as the event types below.
export type PauseReason = 'moves' | 'lives' | null;

export interface GameState {
  board: Board;
  movesRemaining: number;
  // Lives live here, not just in SaveData, because a level in progress
  // needs to track its own life spend independently of the persisted
  // between-sessions value — see DECISIONS.md.
  lives: number;
  objective: Objective;
  status: GameStatus;
  pauseReason: PauseReason;
  // Running total of every piece cleared this level, by matchType — feeds
  // the level_summary event. Distinct from objective.currentCount, which
  // only tracks the one matchType the objective cares about.
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
  objective: { targetMatchType: string; targetCount: number };
}

export function createGameState(config: LevelConfig): GameState {
  const board = generateLevel(config.seed, {
    rows: config.rows,
    cols: config.cols,
    pieceTypeIds: config.pieceTypeIds,
  });

  return {
    board,
    movesRemaining: config.movesLimit,
    lives: config.lives,
    objective: {
      type: 'collect',
      targetMatchType: config.objective.targetMatchType,
      targetCount: config.objective.targetCount,
      currentCount: 0,
    },
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

    const allPositions = matches.flatMap((m) => m.positions);
    const withGaps = cloneBoardWithGaps(currentBoard, allPositions);
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

  const swapped = swapPieces(state.board, posA, posB);
  if (checkMatches(swapped).length === 0) {
    // Illegal move: no match, snap back. No move spent, no state change.
    return { state, events: [] };
  }

  const { board: resolvedBoard, cascadeCount, clearedByMatchType } = resolveCascades(
    swapped,
    state.spawnPiece
  );

  const totalCleared = { ...state.totalCleared };
  for (const [matchType, count] of Object.entries(clearedByMatchType)) {
    totalCleared[matchType] = (totalCleared[matchType] ?? 0) + count;
  }

  const objectiveGain = clearedByMatchType[state.objective.targetMatchType] ?? 0;
  const objective: Objective = {
    ...state.objective,
    currentCount: state.objective.currentCount + objectiveGain,
  };

  const movesRemaining = state.movesRemaining - 1;

  let status: GameStatus = state.status;
  let pauseReason: PauseReason = state.pauseReason;
  if (objective.currentCount >= objective.targetCount) {
    status = 'won';
    pauseReason = null;
  } else if (state.lives <= 0) {
    // Checked before movesRemaining: running out of lives is the more
    // severe resource in this design (see DECISIONS.md on why the actual
    // life-spend trigger is deliberately left unbuilt this phase), so if
    // both happen to be exhausted at once, 'lives' is the reason surfaced.
    status = 'paused_awaiting_input';
    pauseReason = 'lives';
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
    objective,
    status,
    pauseReason,
    totalCleared,
  };

  return { state: newState, events };
}

// The engine doesn't know or care what triggers this (rewarded ad, IAP,
// whatever) — that decision lives entirely outside the engine. It only
// knows how to resume play from the paused state. Requires pauseReason to
// specifically be 'moves' — granting the wrong resource must not
// accidentally unstick a lives-exhausted pause.
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

// Sibling to grantBonusMoves — same rule: doesn't know or care what
// triggered it (rewarded ad, timer, debug button), and only resumes a
// pause whose reason is specifically 'lives'.
export function grantBonusLife(state: GameState, n: number): GameState {
  if (state.status !== 'paused_awaiting_input' || state.pauseReason !== 'lives') {
    return state;
  }
  return {
    ...state,
    lives: state.lives + n,
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
