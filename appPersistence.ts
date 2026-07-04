import { GameState, GameStatus, LevelConfig, PauseReason, SaveData } from './engine/gameState';

// Pure decision logic behind App.tsx's save/load wiring, split out the same
// way pauseActions.ts sits beside PausedOverlay.tsx — so the actual rules
// (what counts as "a level ending", what a save looks like) can be tested
// directly against the real engine instead of only through a mounted React
// tree, which this project has no test harness for yet (see
// DEFERRED_COMPLEXITY.md).

// What a fresh session should start a level with: the persisted lives count
// if a save exists, otherwise the skin's configured max. This is the only
// piece of SaveData that actually feeds back into starting a level in V1 —
// currentLevel/itemsCollected/powerUpCounts round-trip unchanged because
// nothing reads them yet (multi-level, recipe box, and power-ups are all
// out of scope for V1 per CLAUDE.md).
export function startingLives(save: SaveData | null, fallbackMax: number): number {
  return save?.lives ?? fallbackMax;
}

// Mirrors the exact transition applyMove's `level_summary` event represents
// (see engine/gameState.ts): a resource hit zero, or the objective was
// met, while the level was previously still in progress. Re-derived from
// `status` here rather than threading the transient `events` array up
// through Board's onStateChange, since the two are equivalent and this
// avoids widening Board's prop surface for something App.tsx can already
// tell from the state snapshot it's given.
export function didLevelJustEnd(prevStatus: GameStatus | null, nextStatus: GameStatus): boolean {
  return prevStatus === 'in_progress' && (nextStatus === 'won' || nextStatus === 'paused_awaiting_input');
}

// Builds the SaveData for the current moment. `itemsCollected` and
// `powerUpCounts` are always empty — V1 has nothing that writes to them
// (recipe box meta layer and power-ups are both out of scope per
// CLAUDE.md) — they exist on the type as insurance for later, the same way
// Piece.type does.
//
// `state.lives` is read here for backward-compat with call sites that only
// have a GameState-shaped object handy, but the real source of truth as of
// this session is App.tsx's own persisted lives count (see
// `livesAfterLoss`/`applyLivesRegen` below) — `GameState.lives` is a
// per-level snapshot that never changes during play, not the account-level
// value that actually decrements on a loss. App.tsx passes `{ lives:
// <authoritative count> }` here, not its real GameState.
//
// `livesLastRegenAt` is optional and falls back to `now()` only so this
// function's pre-regen callers (and the existing test that predates regen
// math) keep working unchanged. The real call site always passes the
// current authoritative anchor explicitly — see `applyLivesRegen` — rather
// than letting every save silently reset the regen clock to "now", which
// would erase progress toward the next tick on every single save.
export function buildSaveData(
  skinId: string,
  currentLevel: number,
  completedLevels: number[],
  state: Pick<GameState, 'lives'>,
  livesLastRegenAt?: number,
  now: () => number = Date.now
): SaveData {
  return {
    skinId,
    currentLevel,
    lives: state.lives,
    livesLastRegenAt: livesLastRegenAt ?? now(),
    itemsCollected: {},
    powerUpCounts: {},
    completedLevels,
  };
}

// The loss condition: moves hit zero without the objective met. Exactly one
// life is spent per loss — this is intentionally simple (no scaling, no
// difficulty-based cost) since nothing in CLAUDE.md or this session's brief
// asks for anything richer.
export function livesAfterLoss(lives: number): number {
  return Math.max(0, lives - 1);
}

// Whether a given GameState transition is *the* moment a life should be
// spent — a loss, not any other reason a level might pause or end. Reuses
// `didLevelJustEnd` (the same "did a level just end" check that already
// gates saving) rather than re-deriving that condition, then narrows to
// specifically the moves-exhausted pause. Constructed this way so App.tsx's
// existing prevStatus/nextStatus snapshot (already computed once per
// onStateChange call, see handleBoardStateChange) is the only input needed
// — nothing here re-checks status by polling or re-rendering, so this
// naturally fires exactly once per loss and never again for the same
// paused state sitting unchanged across re-renders.
export function shouldSpendLifeOnLoss(
  prevStatus: GameStatus | null,
  nextStatus: GameStatus,
  pauseReason: PauseReason
): boolean {
  return didLevelJustEnd(prevStatus, nextStatus) && nextStatus === 'paused_awaiting_input' && pauseReason === 'moves';
}

// The one gate every level-start entry point shares — Home's "Start
// cooking", an All Levels row, and Board's internal "Play again" (reused
// unchanged from WonOverlay, per this session's investigation) all call
// this exact function rather than three copies of `lives > 0`.
export function canStartLevel(lives: number): boolean {
  return lives > 0;
}

// Basic regen: one life every `regenMinutes`, capped at `max`, computed
// fresh from elapsed wall-clock time rather than a running timer — there is
// no ticking clock anywhere in this app (see Home's own "No timers. No
// rush." footer copy), just a recompute whenever it matters (app boot,
// starting a level, and right before a loss is applied). `now` is passed in
// (not read internally via Date.now()) so this stays a pure, directly
// testable function, same reasoning as `calculateCascades`'s injected
// `spawnPiece` in engine/matrix.ts.
//
// Deliberately does not solve the known clock-spoofing tradeoff already
// documented on `SaveData.livesLastRegenAt` (winding the device clock
// forward grants free regen) — CLAUDE.md's Data Model Notes call this an
// accepted tradeoff at this project's scale, not something to fix here.
//
// Once lives are already at `max`, the anchor is reset to `now` rather than
// left to keep accumulating elapsed time — otherwise a long-idle player who
// then loses a life later would appear to have banked far more regen
// credit than `regenMinutes` ever actually allows, which is exactly the
// "doesn't grant extra lives for elapsed time beyond what regenMinutes and
// max allow" behavior this session's tests require. Below the cap, only
// enough elapsed time to grant the intervals actually used is consumed from
// the anchor — the remainder carries forward toward the next tick, rather
// than being discarded, so a check-in slightly before a tick is due doesn't
// unfairly reset progress.
export function applyLivesRegen(
  lives: number,
  livesLastRegenAt: number,
  max: number,
  regenMinutes: number,
  now: number
): { lives: number; livesLastRegenAt: number } {
  if (lives >= max) {
    return { lives: max, livesLastRegenAt: now };
  }

  const regenMs = regenMinutes * 60 * 1000;
  const elapsedMs = Math.max(0, now - livesLastRegenAt);
  const intervalsElapsed = Math.floor(elapsedMs / regenMs);
  if (intervalsElapsed <= 0) {
    return { lives, livesLastRegenAt };
  }

  const neededToCap = max - lives;
  const grantedIntervals = Math.min(intervalsElapsed, neededToCap);
  const newLives = lives + grantedIntervals;
  const newLivesLastRegenAt = newLives >= max ? now : livesLastRegenAt + grantedIntervals * regenMs;

  return { lives: newLives, livesLastRegenAt: newLivesLastRegenAt };
}

// Adds levelIndex to the completed set if it isn't already there, kept
// sorted for the dashboard's display order. A level can be won more than
// once (see "Play again" replaying an already-won level), so this must
// stay idempotent rather than pushing a duplicate entry each time.
export function markLevelCompleted(completedLevels: number[], levelIndex: number): number[] {
  return completedLevels.includes(levelIndex)
    ? completedLevels
    : [...completedLevels, levelIndex].sort((a, b) => a - b);
}

// The hand-built queue (App.tsx's LEVEL_QUEUE) is no longer the end of the
// game — past it, generator-driven levels continue indefinitely (see
// buildGeneratedLevelConfig below), so there's no ceiling left to hit.
// "No next level" isn't a real state anymore, which is what used to leave
// the win overlay's primary action routing to a dashboard placeholder with
// no way back into a board.
export function resolveNextLevelIndex(currentLevel: number): number {
  return currentLevel + 1;
}

// Which level a fresh session's `levelIndex` state should start seeded
// with — whichever level the player was last on, or level 1 for a fresh
// install. This used to double as "which screen to land on" (hence the old
// name), back when the app always resumed straight into gameplay; it's now
// just the "last active level" continuity value App.tsx carries into
// SaveData and into lives carryover, independent of which screen the
// player actually lands on (see resolveStartScreen below). Clamped to at
// least 1 in case of a corrupt/hand-edited save, with no upper clamp since
// there's no fixed queue length to clamp against.
export function resolveStartLevelIndex(save: SaveData | null): number {
  const requested = save?.currentLevel ?? 1;
  return Math.max(requested, 1);
}

// Every session now opens on the Home screen — a deliberate product change
// from the old "always resume straight into gameplay" boot behavior (see
// resolveStartLevelIndex above for what replaced its old responsibility).
// Playing requires an explicit tap ("Start cooking" on Home, or a level row
// on All Levels), so there's no branching left on save state here; kept as
// its own named function (rather than inlined in App.tsx) so the boot
// policy has one obvious place to read, the same way resolveNextLevelIndex
// is the one place "what does advancing mean" lives.
export function resolveStartScreen(): 'home' {
  return 'home';
}

// Levels beyond the hand-built queue are generator-driven, but still fully
// deterministic and replayable from their level index alone: seed spacing
// continues the exact +100-per-level pattern LEVEL_QUEUE already uses (see
// App.tsx), the same "derive a seed, don't hand-author a board" idea
// Board.tsx's own handlePlayAgain applies when it increments its seed by 1
// per replay.
export function generatedLevelSeed(levelIndex: number): number {
  return 1 + (levelIndex - 1) * 100;
}

// 1-based count of generator-driven levels played so far: 1 for the first
// level past the hand-built queue, 2 for the next, etc. Every difficulty
// knob below is a function of this, not of the raw level index, so the ramp
// starts fresh at the hand-built queue's end regardless of how long that
// queue is.
export function generatedLevelNumber(levelIndex: number, handBuiltLevelCount: number): number {
  return levelIndex - handBuiltLevelCount;
}

// Difficulty ramps by shrinking the piece-type pool as generated levels
// continue — per engine/DECISIONS.md, fewer distinct types is the
// generator's actual difficulty lever ("constrain the randomness, don't rig
// the luck"), since it means fewer safe choices per cell and denser boards.
// Steps down by one every 3 levels; floored at 3 (not generateLevel's own
// hard minimum of 2) so there's always a little headroom before the board
// becomes maximally constrained.
export function generatedPieceTypeCount(levelNumber: number, availableTypeCount: number): number {
  const MIN_TYPES = 3;
  const step = Math.floor((levelNumber - 1) / 3);
  return Math.max(MIN_TYPES, availableTypeCount - step);
}

// The other difficulty lever: engine/DECISIONS.md is explicit that a move
// limit isn't part of GeneratorConfig (it doesn't affect what board gets
// generated), so it's tightened here in gameState terms instead. Steps down
// by one every 2 levels from the hand-built queue's own last value (24, see
// LEVEL_QUEUE), floored at 18 so a long session never becomes mechanically
// unwinnable.
export function generatedMovesLimit(levelNumber: number): number {
  const BASE_MOVES = 24;
  const MIN_MOVES = 18;
  const step = Math.floor((levelNumber - 1) / 2);
  return Math.max(MIN_MOVES, BASE_MOVES - step);
}

// Mirrors LEVEL_QUEUE's own light per-level growth in target count, capped
// well below generatedMovesLimit's floor so the objective stays reachable
// even at max difficulty.
export function generatedTargetCount(levelNumber: number): number {
  const BASE_TARGET = 20;
  const MAX_TARGET = 26;
  return Math.min(MAX_TARGET, BASE_TARGET + levelNumber);
}

// The blocker-count difficulty lever, same shape as generatedPieceTypeCount/
// generatedMovesLimit above: a function of levelNumber alone. No blockers on
// the first couple of generated levels — a brand-new obstacle shouldn't show
// up in the very board that's also tightening move limits and piece-type
// variety for the first time — then one every two levels, capped at 4 so an
// obstacle-heavy board never crowds out the board itself (generator.ts's own
// hasLegalMoves guarantee still holds regardless, but a wall-to-wall board of
// blockers would be a bad player experience even if technically playable).
export function generatedBlockerCount(levelNumber: number): number {
  const INTRODUCE_AT_LEVEL = 3;
  const MAX_BLOCKERS = 4;
  if (levelNumber < INTRODUCE_AT_LEVEL) return 0;
  const step = Math.floor((levelNumber - INTRODUCE_AT_LEVEL) / 2);
  return Math.min(MAX_BLOCKERS, 1 + step);
}

// Builds a full generator-driven LevelConfig (minus `lives`, same as
// LEVEL_QUEUE's own entries — App.tsx's buildLevelConfig adds that back)
// for any levelIndex past the hand-built queue. Board dimensions stay fixed
// at the hand-built queue's own values — CLAUDE.md's edge-to-edge tile
// sizing is tuned against that grid, and board size was never asked for as
// a difficulty axis here, only piece-type count and move limit.
//
// blockerMatchType/blockerHitsToClear are optional and passed straight
// through from the skin's own blocker config (App.tsx reads
// skinConfig.blockers[0]) — if a skin defines no blockers at all, omitting
// blockerMatchType here means generatedBlockerCount is never even consulted,
// so a blocker-less skin sees no behavior change.
export function buildGeneratedLevelConfig(
  levelIndex: number,
  handBuiltLevelCount: number,
  allPieceTypeIds: string[],
  rows: number,
  cols: number,
  blockerMatchType?: string,
  blockerHitsToClear?: number
): Omit<LevelConfig, 'lives'> {
  const levelNumber = generatedLevelNumber(levelIndex, handBuiltLevelCount);
  const typeCount = generatedPieceTypeCount(levelNumber, allPieceTypeIds.length);
  const pieceTypeIds = allPieceTypeIds.slice(0, typeCount);
  const targetMatchType = pieceTypeIds[(levelNumber - 1) % pieceTypeIds.length];
  const blockerCount = blockerMatchType ? generatedBlockerCount(levelNumber) : 0;

  return {
    seed: generatedLevelSeed(levelIndex),
    rows,
    cols,
    pieceTypeIds,
    movesLimit: generatedMovesLimit(levelNumber),
    objective: { targetMatchType, targetCount: generatedTargetCount(levelNumber) },
    ...(blockerCount > 0 ? { blockerCount, blockerMatchType, blockerHitsToClear: blockerHitsToClear ?? 1 } : {}),
  };
}
