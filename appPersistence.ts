import { Board, GameState, GameStatus, LevelConfig, PauseReason, SaveData } from './engine/gameState';
import { Piece } from './engine/matrix';
import { RecipeCard } from './components/skinConfig';

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
// `powerUpCounts` are always empty — V1 still has nothing that writes to
// them (power-ups remain out of scope per CLAUDE.md; the recipe box meta
// layer is now in scope, but its persisted state is `unlockedRecipeCards`
// below, not `itemsCollected`) — they exist on the type as insurance for
// later, the same way Piece.type does.
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
  seenTutorials: string[],
  unlockedRecipeCards: string[],
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
    seenTutorials,
    unlockedRecipeCards,
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

// How long until the next passive regen tick, purely for display (the
// OutOfLives screen's countdown) — derived from the exact same
// anchor/max/regenMinutes accounting `applyLivesRegen` already trusts, not
// a separately-tracked countdown value. Returns 0 once lives are already
// at max (nothing to count down to). Deliberately does not project past
// the *next* tick: if a player leaves this screen open long enough for
// more than one interval to elapse, the extra intervals are credited for
// real the next time `applyLivesRegen` actually runs (the next
// handlePlayLevel/handleNextLevel/app-foreground call in App.tsx) rather
// than being guessed at here — this function only ever answers "how long
// until the next one", so this screen never displays a lives count that
// disagrees with the account's real persisted value.
export function msUntilNextLifeRegen(
  lives: number,
  livesLastRegenAt: number,
  max: number,
  regenMinutes: number,
  now: number
): number {
  if (lives >= max) return 0;
  const regenMs = regenMinutes * 60 * 1000;
  const elapsedMs = Math.max(0, now - livesLastRegenAt);
  return Math.max(0, regenMs - elapsedMs);
}

// An instant, full refill of the account's persisted lives count to `max`
// — the "watch a video" bonus on the OutOfLives screen (blocking a *new*
// level from starting). Deliberately a full refill, not the genre-standard
// single-life grant: this app already leans calm/generous everywhere else
// (see CLAUDE.md's Design Constraints), and a stingy +1 after sitting
// through an ad would cut against that. Distinct in kind from the old
// grantBonusMoves/grantBonusLife mid-level pause mechanic (see
// engine/gameState.ts's PauseReason comment on why the latter was
// deleted): those mutated a live GameState in progress, this mutates the
// account-level `lives` value App.tsx already owns, the same value
// `applyLivesRegen`/`livesAfterLoss` operate on. Deliberately does not
// touch `livesLastRegenAt` — the passive regen clock keeps counting down
// on its own schedule regardless of this bonus, exactly like a loss only
// resets the anchor when lives were previously at cap (see
// `applyLivesRegen`'s own comment) rather than whenever lives change at
// all. Takes no `lives` argument — unlike the old +1-and-cap shape, the
// result never depends on the current count, only on `max`.
export function grantInstantLife(max: number): number {
  return max;
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

// The one-time blocker tutorial's id in `SaveData.seenTutorials` — a plain
// constant, not re-typed as a string literal at every call site, so
// Board.tsx/App.tsx/tests all agree on the exact same id.
export const BLOCKER_TUTORIAL_ID = 'blocker';

// The matchType of the first blocker piece found on a board, scanned in
// row-major order — used both to decide whether a blocker tutorial is
// relevant (see shouldShowBlockerTutorial below) and, by the overlay
// itself, to resolve the real sprite to show (via the same
// getSpriteForMatchType lookup Board.tsx already uses for every tile).
// Undefined when the board has no blocker at all.
export function findBlockerMatchType(board: Board): string | undefined {
  for (const row of board) {
    for (const piece of row) {
      if (piece.type === 'blocker') return piece.matchType;
    }
  }
  return undefined;
}

// The blocker tutorial should show exactly once ever: the first time a
// level's starting board actually contains a blocker, and only if the
// player hasn't already dismissed it. Deliberately checked against the
// level's initial board (see Board.tsx's mount-time useState initializer),
// not re-checked on every subsequent render as blockers get cleared mid-
// level — this is a one-time "here's what this is" popup, not a status
// that should reappear once the last blocker on screen is gone.
export function shouldShowBlockerTutorial(board: Board, seenTutorials: string[]): boolean {
  return findBlockerMatchType(board) !== undefined && !seenTutorials.includes(BLOCKER_TUTORIAL_ID);
}

// Adds a tutorial id to the seen list if it isn't already there — same
// idempotent-add shape as markLevelCompleted above (dismissing an
// already-seen tutorial, if that ever became reachable, must not grow the
// list with duplicates).
export function markTutorialSeen(seenTutorials: string[], id: string): string[] {
  return seenTutorials.includes(id) ? seenTutorials : [...seenTutorials, id];
}

// The three special-piece tutorials' ids in `SaveData.seenTutorials`. Each id
// is deliberately identical to the engine PieceType string it teaches (see
// engine/matrix.ts's PieceType union) so the board scan below can compare
// `piece.type` straight against the id with no type->id mapping table — the
// same "one shared constant every call site agrees on" reasoning as
// BLOCKER_TUTORIAL_ID.
export const STRIPED_TUTORIAL_ID = 'striped';
export const COLOR_BOMB_TUTORIAL_ID = 'color_bomb';
export const AREA_BOMB_TUTORIAL_ID = 'area_bomb';

// Scanned in this order within a cell is moot (a cell holds one piece); the
// board scan itself is row-major, so this is just the set of piece types that
// have a first-time tutorial.
const SPECIAL_TUTORIAL_IDS: string[] = [
  STRIPED_TUTORIAL_ID,
  COLOR_BOMB_TUTORIAL_ID,
  AREA_BOMB_TUTORIAL_ID,
];

// The matched special piece plus which tutorial it triggers. The piece itself
// is returned (not just its id) so the overlay can resolve its real in-play
// sprite via getSpriteForPiece — a striped piece needs its base matchType to
// pick striped_<sprite>, exactly as BlockerTutorialOverlay needs the real
// blocker matchType. Undefined return means "no unseen special on the board".
export interface SpecialPieceTutorial {
  id: string;
  piece: Piece;
}

// Which special-piece tutorial (if any) should show right now: the first
// special piece on the board, row-major, whose id the player hasn't already
// dismissed. Deliberately NOT the mount-time, initial-board check
// shouldShowBlockerTutorial uses — a striped/color-bomb/area-bomb piece never
// exists on a level's starting board; the player forges it mid-level from a
// 4-run, a 5-run, or a 2x2 square. So Board.tsx re-runs this after every
// committed move (see its post-move effect), showing each special's one-time
// explanation the first time that piece actually comes to rest on the board.
// Returning only the FIRST unseen match keeps two overlays from stacking if a
// single move mints two different specials; the second's tutorial simply shows
// after the next move that leaves it on the board.
export function findSpecialPieceTutorial(
  board: Board,
  seenTutorials: string[]
): SpecialPieceTutorial | undefined {
  for (const row of board) {
    for (const piece of row) {
      if (SPECIAL_TUTORIAL_IDS.includes(piece.type) && !seenTutorials.includes(piece.type)) {
        return { id: piece.type, piece };
      }
    }
  }
  return undefined;
}

// The recipe card (if any) a given level number unlocks — a fixed lookup
// against skinConfig.recipeCards's own milestoneLevel field, not a formula.
// Levels generate indefinitely (buildGeneratedLevelConfig below), but a
// collection needs a completable set, so only the 9 curated milestone
// levels actually resolve to a card; every other level (including every
// hand-built LEVEL_QUEUE entry not chosen as a milestone) returns
// undefined. Undefined is also the correct answer for a duplicate/invalid
// config (two cards sharing a milestoneLevel) — find() just returns
// whichever comes first, and that's a config-authoring bug to fix in
// config.json, not something this function should silently paper over.
export function findRecipeCardForLevel(
  recipeCards: RecipeCard[],
  levelIndex: number
): RecipeCard | undefined {
  return recipeCards.find((card) => card.milestoneLevel === levelIndex);
}

// Adds a recipe card id to the unlocked list if it isn't already there —
// same idempotent-add shape as markTutorialSeen/markLevelCompleted above,
// so replaying an already-unlocked milestone level (Board.tsx's "Play
// Again", or revisiting it from All Levels) never grows the list with
// duplicates.
export function unlockRecipeCard(unlockedRecipeCards: string[], cardId: string): string[] {
  return unlockedRecipeCards.includes(cardId) ? unlockedRecipeCards : [...unlockedRecipeCards, cardId];
}

// One-time catch-up for progress that predates the recipe card system: a
// player could have completed milestone levels (their ids are already in
// `completedLevels`) back when winning one never called unlockRecipeCard,
// leaving `unlockedRecipeCards` empty despite genuine, earned progress.
// Run on every save load (see App.tsx) — it's safe to run repeatedly
// precisely because it composes the same idempotent unlockRecipeCard the
// live win flow uses, so a card already unlocked is never added twice and a
// save with nothing to recover comes back byte-identical.
//
// Iterates the fixed curated card set (not completedLevels) so only real
// milestone completions can ever unlock anything — a completed *non*-
// milestone level has no card to match and is silently, correctly ignored,
// the same "every other level unlocks nothing" rule findRecipeCardForLevel
// already enforces for the live path. Returns the input array unchanged by
// reference when no card is recovered (unlockRecipeCard is a no-op each
// step), so App.tsx's load can treat "same reference back" as "nothing to
// backfill" without a separate diff.
export function backfillUnlockedRecipeCards(
  recipeCards: RecipeCard[],
  completedLevels: number[],
  unlockedRecipeCards: string[]
): string[] {
  return recipeCards.reduce(
    (unlocked, card) =>
      completedLevels.includes(card.milestoneLevel) ? unlockRecipeCard(unlocked, card.id) : unlocked,
    unlockedRecipeCards
  );
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

// Difficulty ramps by GROWING the piece-type pool as generated levels
// continue. This is inverted from an earlier version of this function,
// which shrank the pool on the assumption that fewer distinct types made
// boards harder — backwards for a human player: on a fixed board, fewer
// types means each type is packed more densely, so any given swap has a
// much higher statistical chance of creating a match. Real match-3 games
// add colors for harder difficulty, not remove them, since more types make
// matches genuinely rarer and require more deliberate play. See
// engine/DECISIONS.md's "Difficulty tuning" entry for the full retraction.
// Starts at MIN_TYPES (easy — matches come readily, a gentle introduction)
// and steps up by one every 3 levels, capped at the skin's own full pool
// size so the ramp never asks for more types than the skin actually has.
export function generatedPieceTypeCount(levelNumber: number, availableTypeCount: number): number {
  const MIN_TYPES = 3;
  const step = Math.floor((levelNumber - 1) / 3);
  return Math.min(availableTypeCount, MIN_TYPES + step);
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

// How many simultaneous objectives a generated level asks for. Gated on
// typeCount itself, not levelNumber, since typeCount is what actually
// determines whether a second objective trivializes the level: with only a
// few piece types in play, two simultaneous objectives cover most of the
// pool, and nearly every random match satisfies one target or the other
// almost immediately (levels clearing in ~3 moves — the exact regression
// this rewrite fixes, see engine/DECISIONS.md). Requiring at least
// MIN_TYPES_FOR_SECOND_OBJECTIVE (5) means at least 3 types stay "neutral"
// once 2 objectives are chosen, so most matches on a two-objective board
// still don't progress either target. Capped at `min(2, typeCount)` as a
// structural safety net, not a difficulty knob — the threshold above
// already requires typeCount >= 5 > 2, so the cap never bites in practice,
// but a level can never be asked for more distinct objectives than it has
// distinct piece types to give it.
const MIN_TYPES_FOR_SECOND_OBJECTIVE = 5;
export function generatedObjectiveCount(typeCount: number): number {
  if (typeCount < MIN_TYPES_FOR_SECOND_OBJECTIVE) return 1;
  return Math.min(2, typeCount);
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

// Per-blocker-id entry into the eligible pool, keyed by id rather than a
// positional index so a skin's blockers array can be reordered without
// silently shifting which id this gate applies to. An id with no entry here
// is eligible from whenever blockers start appearing at all —
// generatedBlockerCount's own INTRODUCE_AT_LEVEL gate already covers that
// baseline, so most blockers need nothing added below.
//
// pot_lid (hitsToClear: 2, see skins/lalas-kitchen/config.json) is the one
// exception: a double-hit blocker is meaningfully tougher than the 1-hit
// cling/dish_stack pair, so it stays out of the pool until level 7 — four
// generated levels after blockers first appear at all (level 3), by which
// point generatedBlockerCount has already ramped past its first step (2
// blockers/board, see the level-5 case) and a player has had a real chance
// to learn the easier 1-hit blockers before a tougher one enters the mix.
const BLOCKER_MIN_LEVEL_NUMBER: Record<string, number> = {
  pot_lid: 7,
};

// The dynamic denial-zone spread mechanic (a blocker zone that grows into an
// adjacent cell if left unaddressed — see engine/gameState.ts's
// DenialSpreadState) is gated to generated levels at or past this number, the
// same difficulty-ramp shape pot_lid uses above. Deliberately later than
// pot_lid (7): a zone that actively grows is a tougher idea than a static
// double-hit blocker, so it stays out until the player has met blockers (level
// 3), the tougher pot_lid (level 7), and had generatedBlockerCount ramp to its
// 4-blocker cap (level 9) — by level 10 there's a real, multi-cell zone for the
// mechanic to act on. Below this number, blockers are purely static (a cluster
// is a denial zone that never spreads), which needs zero engine logic — the
// existing blocker contract already IS "cells clearable only by matches landing
// on them." See CLAUDE.md's Data Model Notes.
const DENIAL_SPREAD_MIN_LEVEL_NUMBER = 10;

// Which of a skin's blocker ids are allowed to appear at all at this
// generated-level-number — id order preserved from the input array so
// buildGeneratedLevelConfig's own rotation stays deterministic per level.
export function eligibleBlockerIds(levelNumber: number, blockerIds: string[]): string[] {
  return blockerIds.filter((id) => levelNumber >= (BLOCKER_MIN_LEVEL_NUMBER[id] ?? 1));
}

// Builds a full generator-driven LevelConfig (minus `lives`, same as
// LEVEL_QUEUE's own entries — App.tsx's buildLevelConfig adds that back)
// for any levelIndex past the hand-built queue. Board dimensions stay fixed
// at the hand-built queue's own values — CLAUDE.md's edge-to-edge tile
// sizing is tuned against that grid, and board size was never asked for as
// a difficulty axis here, only piece-type count and move limit.
//
// `blockers` is the skin's full blocker pool (App.tsx passes
// skinConfig.blockers directly — only `id`/`hitsToClear` are read here, so
// a skin's own SkinBlocker shape, sprite field included, satisfies this
// structurally). One generated level still only ever places a single
// blocker *type* (generateLevel's own GeneratorConfig takes one
// blockerMatchType/blockerHitsToClear pair — see engine/generator.ts —
// mixing types within one board was never asked for and isn't built here),
// chosen deterministically per level: filter to whichever ids are eligible
// at this levelNumber (see eligibleBlockerIds above), then rotate through
// just that eligible subset by levelNumber so which type shows up shifts
// level to level instead of always being the pool's first entry. Empty
// `blockers` (a blocker-less skin) means no eligible ids ever, so
// generatedBlockerCount is never even consulted — unchanged behavior from
// before this pool existed.
export function buildGeneratedLevelConfig(
  levelIndex: number,
  handBuiltLevelCount: number,
  allPieceTypeIds: string[],
  rows: number,
  cols: number,
  blockers: Array<{ id: string; hitsToClear: number }> = []
): Omit<LevelConfig, 'lives'> {
  const levelNumber = generatedLevelNumber(levelIndex, handBuiltLevelCount);
  const typeCount = generatedPieceTypeCount(levelNumber, allPieceTypeIds.length);
  const pieceTypeIds = allPieceTypeIds.slice(0, typeCount);

  // Distinct-by-construction: consecutive indices into pieceTypeIds, modulo
  // its own length. objectiveCount is capped at pieceTypeIds.length (see
  // generatedObjectiveCount), so this can never wrap around and repeat a
  // type within the same level.
  const objectiveCount = generatedObjectiveCount(typeCount);
  // generatedTargetCount is the TOTAL piece burden for the level, shared
  // across its objectives, not a per-objective quota. Earlier this handed
  // every objective the full single-objective count independently, so a
  // two-objective level silently demanded double (26 + 26 = 52 pieces
  // against an 18-move floor — effectively unwinnable, see
  // engine/DECISIONS.md's target-sharing entry). Dividing keeps a
  // two-objective level's total in line with a one-objective level of the
  // same number. ceil so an odd total never rounds a level below its
  // intended burden — though in practice two objectives only ever appear
  // once the target has saturated at 26 (both need levelNumber >= 7), so
  // this splits cleanly to 13 + 13.
  const perObjectiveTarget = Math.ceil(generatedTargetCount(levelNumber) / objectiveCount);
  const objectives = Array.from({ length: objectiveCount }, (_, i) => ({
    targetMatchType: pieceTypeIds[(levelNumber - 1 + i) % pieceTypeIds.length],
    targetCount: perObjectiveTarget,
  }));

  const eligibleIds = eligibleBlockerIds(levelNumber, blockers.map((b) => b.id));
  const chosenBlocker =
    eligibleIds.length > 0
      ? blockers.find((b) => b.id === eligibleIds[(levelNumber - 1) % eligibleIds.length])
      : undefined;
  const blockerCount = chosenBlocker ? generatedBlockerCount(levelNumber) : 0;

  // The spread mechanic only means anything with blockers to spread FROM, so
  // it's enabled solely on a gated level that actually placed a zone — never on
  // a blocker-less board, where the flag would be inert anyway.
  const denialSpread =
    blockerCount > 0 && chosenBlocker && levelNumber >= DENIAL_SPREAD_MIN_LEVEL_NUMBER;

  return {
    seed: generatedLevelSeed(levelIndex),
    rows,
    cols,
    pieceTypeIds,
    movesLimit: generatedMovesLimit(levelNumber),
    objectives,
    ...(blockerCount > 0 && chosenBlocker
      ? { blockerCount, blockerMatchType: chosenBlocker.id, blockerHitsToClear: chosenBlocker.hitsToClear }
      : {}),
    ...(denialSpread ? { denialSpread: true } : {}),
  };
}
