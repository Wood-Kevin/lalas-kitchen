import { BOARD_SHAPE_ROTATION, BOARD_SHAPE_TEMPLATES, BoardShapeId, playableCellRatio } from './engine/boardShapes';
import { Board, CrashRecord, GameState, GameStatus, LevelConfig, SaveData } from './engine/gameState';
import { Piece, Position } from './engine/matrix';
import { RecipeCard } from './components/skinConfig';
import { StarRating } from './components/wonActions';

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
// `consecutiveLosses` is appended after `now` (rather than inserted amongst
// the other progress fields above) purely so every pre-existing positional
// call site — this repo has many, in both App.tsx and its tests — keeps
// working unchanged rather than silently shifting `state`/`livesLastRegenAt`
// into the wrong slot. Defaults to 0, the same "not tracked yet" fallback
// SaveData.consecutiveLosses itself resolves to on read.
export function buildSaveData(
  skinId: string,
  currentLevel: number,
  completedLevels: number[],
  levelStars: Record<number, StarRating>,
  seenTutorials: string[],
  unlockedRecipeCards: string[],
  soundEnabled: boolean,
  hapticsEnabled: boolean,
  state: Pick<GameState, 'lives'>,
  livesLastRegenAt?: number,
  now: () => number = Date.now,
  consecutiveLosses: number = 0,
  // Threaded through from App.tsx's lastCrashRef (loaded from the previous
  // save at boot — see engine/gameState.ts's recordCrash) so an ordinary
  // gameplay save doesn't silently drop a crash record that was written by
  // a completely different code path. Every call site passes its current
  // ref value, same shape as consecutiveLosses above.
  lastCrash?: CrashRecord
): SaveData {
  return {
    skinId,
    currentLevel,
    lives: state.lives,
    livesLastRegenAt: livesLastRegenAt ?? now(),
    itemsCollected: {},
    powerUpCounts: {},
    completedLevels,
    levelStars,
    seenTutorials,
    unlockedRecipeCards,
    soundEnabled,
    hapticsEnabled,
    consecutiveLosses,
    lastCrash,
  };
}

// The loss condition: moves hit zero without the objective met. Exactly one
// life is spent per loss — this is intentionally simple (no scaling, no
// difficulty-based cost) since nothing in CLAUDE.md or this session's brief
// asks for anything richer.
export function livesAfterLoss(lives: number): number {
  return Math.max(0, lives - 1);
}

// The difficulty-breather streak counter (see shouldApplyBreather/
// buildGeneratedLevelConfig below): every real life-loss — hand-built or
// generated level, the streak doesn't care which — increments it by one.
// It's reset to 0 on any win (see App.tsx's handleBoardStateChange) and
// consumed back to 0 the moment a breather is actually granted (see
// shouldApplyBreather's own comment), so this is a plain unbounded counter,
// not itself gated at a max.
export function consecutiveLossesAfterLoss(consecutiveLosses: number): number {
  return consecutiveLosses + 1;
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

// Records a level's best-ever star rating (see engine/gameState.ts's
// SaveData.levelStars) — a worse replay never overwrites an already-earned
// higher rating, so the level map always shows the best the player has
// genuinely achieved, not just whatever the last attempt happened to score.
// Same idempotent-update shape as markLevelCompleted/markTutorialSeen above:
// returns the input unchanged by reference when this attempt doesn't beat
// the existing record, so App.tsx's win handler never re-renders or
// re-saves for a no-op update.
export function recordLevelStars(
  levelStars: Record<number, StarRating>,
  levelIndex: number,
  stars: StarRating
): Record<number, StarRating> {
  const existing = levelStars[levelIndex];
  if (existing !== undefined && existing >= stars) return levelStars;
  return { ...levelStars, [levelIndex]: stars };
}

// The one-time onboarding tutorial's id in `SaveData.seenTutorials` — the
// genuine first-time "how to play" card, teaching the base swap-to-match
// mechanic itself. Distinct from every tutorial below: those all assume the
// player already knows how to swap tiles (a covered dish, a striped piece,
// a color bomb — each explains one specific obstacle or special on top of
// that base mechanic). This is the one that comes before all of them.
export const HOW_TO_PLAY_TUTORIAL_ID = 'how_to_play';

// The onboarding tutorial should show exactly once ever: the very first time
// a genuinely fresh account's level 1 loads, before the player has completed
// anything. Deliberately NOT just `levelIndex === 1` — a player who has
// already finished level 1 (or further) and later replays it from All Levels
// or Board's "Play again" would also have levelIndex === 1, despite already
// knowing how to play. `completedLevels.length === 0` is the actual
// "genuinely fresh save" signal: a returning player's completedLevels is
// never empty once they've won anything, even if they navigate back to
// level 1, so this can never resurface for someone who already knows the
// mechanic. Checked at mount, from the level's starting props, the same
// shape as shouldShowBlockerTutorial below (not re-derived mid-level).
export function shouldShowOnboardingTutorial(
  levelIndex: number,
  completedLevels: number[],
  seenTutorials: string[]
): boolean {
  return levelIndex === 1 && completedLevels.length === 0 && !seenTutorials.includes(HOW_TO_PLAY_TUTORIAL_ID);
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

// The one-time board-shape tutorial's id in `SaveData.seenTutorials` — shown
// the first time a level's board actually contains a non-playable void cell
// (see engine/matrix.ts's `'void'` PieceType and engine/boardShapes.ts). A
// plain static blocker cluster looks and behaves like an obstacle the player
// already understands from BLOCKER_TUTORIAL_ID; a gap in the grid itself is
// the genuinely new thing worth explaining, since otherwise it could read as
// a rendering bug rather than an intentional board shape.
export const BOARD_SHAPE_TUTORIAL_ID = 'board_shape';

function boardHasVoidCell(board: Board): boolean {
  return board.some((row) => row.some((piece) => piece.type === 'void'));
}

// Same shape and reasoning as shouldShowBlockerTutorial above: a void cell is
// fixed at level generation (LevelConfig.voidCells), never introduced
// mid-level, so this is a mount-time check against the level's initial board,
// not a re-derived post-move scan.
export function shouldShowBoardShapeTutorial(board: Board, seenTutorials: string[]): boolean {
  return boardHasVoidCell(board) && !seenTutorials.includes(BOARD_SHAPE_TUTORIAL_ID);
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
//
// `piece` is `Piece | null` (not always a real Piece) because Board.tsx also
// reuses this exact shape for the chain_reaction tutorial (see
// shouldShowChainReactionTutorial below) — that tutorial celebrates a MOMENT
// (multiple specials firing together in one move), not any single resting
// piece, so there's no one piece to point the overlay's icon at. It's null
// only for that case; findSpecialPieceTutorial below always returns a real one.
export interface SpecialPieceTutorial {
  id: string;
  piece: Piece | null;
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

// The one-time spread-warning tutorial's id in `SaveData.seenTutorials` —
// shown the first time the dynamic denial-zone spread mechanic's transient
// `spreadWarning` flag (see engine/matrix.ts's Piece and
// engine/gameState.ts's stepDenialZone) actually marks a cell. A static
// denial zone needs no explanation beyond BLOCKER_TUTORIAL_ID's "match
// ingredients next to it" — the warning crack is the genuinely new behavior,
// since it means this ordinary cell is about to become another blocker
// unless matched first.
export const SPREAD_WARNING_TUTORIAL_ID = 'spread_warning';

// Same re-derived-after-every-move shape as findSpecialPieceTutorial above,
// not a mount-time check: a warned cell never exists on a level's initial
// board (the earliest possible warning is spreadInterval - 1 unaddressed
// moves in), and it can be cleared and re-marked elsewhere as play
// continues, so this has to be scanned fresh each time rather than latched
// once. Returns the warned piece itself (its real in-play sprite, the same
// "show the real thing being explained" convention every other tutorial
// icon follows) so the overlay can resolve its icon via getSpriteForPiece,
// exactly like findSpecialPieceTutorial's own returned piece.
export function findSpreadWarningTutorial(
  board: Board,
  seenTutorials: string[]
): SpecialPieceTutorial | undefined {
  if (seenTutorials.includes(SPREAD_WARNING_TUTORIAL_ID)) return undefined;
  for (const row of board) {
    for (const piece of row) {
      if (piece.spreadWarning) return { id: SPREAD_WARNING_TUTORIAL_ID, piece };
    }
  }
  return undefined;
}

// The fourth tutorial's id — the actual differentiator of this whole game:
// the moment more than one special piece fires TOGETHER from a single move
// (a chain reaction catching another special, or a striped+striped/
// striped+bomb combo). Distinct from the three ids above in one load-bearing
// way: those are engine `PieceType` strings matched against a piece sitting
// on the board; this one has no piece to match against a board scan at all —
// the specials that fired are, by definition, already cleared by the time the
// move settles. So its trigger isn't a board scan like
// findSpecialPieceTutorial above; it's a plain boolean gate over
// engine/gameState.ts's ApplyMoveResult.multiSpecialFired, which already
// reuses the exact same originKeys/expandChainClears chaining bookkeeping to
// compute whether 2+ specials fired within one pass — no new detection here.
export const CHAIN_REACTION_TUTORIAL_ID = 'chain_reaction';

// Whether the chain_reaction tutorial should show for the move that just
// resolved: it fired 2+ specials together (see ApplyMoveResult.
// multiSpecialFired) and the player hasn't already dismissed it. Same shape
// as shouldShowBlockerTutorial (a plain once-ever boolean gate), not a board
// scan like findSpecialPieceTutorial — see CHAIN_REACTION_TUTORIAL_ID's
// comment for why a board scan can't apply here.
export function shouldShowChainReactionTutorial(multiSpecialFired: boolean, seenTutorials: string[]): boolean {
  return multiSpecialFired && !seenTutorials.includes(CHAIN_REACTION_TUTORIAL_ID);
}

// The tutorial cadence throttle: a real playtest concern, not a hypothetical
// one — all seven trigger functions above are each individually correct (once
// ever, first genuine encounter), and Board.tsx already guarantees only one
// overlay is ever ON SCREEN at a time, but nothing previously stopped a second
// genuine first (a different id) from appearing the INSTANT the first one was
// dismissed, with zero real playtime between them — e.g. a level whose initial
// board is both shaped (board_shape) and blockered (blocker) is eligible for
// both the moment it mounts, and forming a striped piece then a color bomb on
// consecutive moves fires both within seconds. That reads as several pieces of
// homework stacking up, not the calm, spaced-out introductions this game is
// built around (see CLAUDE.md's Design Constraints).
//
// Enforced as a minimum real-time gap since any tutorial last actually
// appeared, not a move count or a level count: a move count has no stable
// "long enough" value across levels with very different move budgets, and a
// level count can't fix the same-level cases above (board_shape and blocker
// are both eligible on the SAME level, zero levels apart no matter what the
// threshold is) or the mid-level striped-then-bomb case (same level, same
// count). Real elapsed time is the one axis that actually separates "just
// shown" from "genuinely new moment", regardless of which level or how many
// moves occurred in between.
//
// 60 seconds: long enough that two tutorials essentially never land in the
// same short burst of attention (a few real moves at this player's own
// unhurried pace, per the hint-timing research that already settled on an 18s
// idle threshold for a single thinking pause — a tutorial-to-tutorial gap
// should read as noticeably longer than one pause, not a fixed multiple of
// it), short enough that it's a small fraction of a typical level's playtime
// and so rarely reads as withholding a genuinely new explanation.
export const TUTORIAL_MIN_GAP_MS = 60_000;

// Pure elapsed-time check backing the throttle: true once `minGapMs` has
// passed since `lastTutorialShownAt`, or immediately (true) if no tutorial has
// ever been shown yet (`null`) — the very first tutorial a player ever sees
// should never wait on a cooldown that hasn't started ticking. `now` is
// injected (not read internally) for the same testability reasons every other
// time-based function in this file takes it as a parameter (see
// applyLivesRegen).
export function canShowTutorialNow(
  lastTutorialShownAt: number | null,
  now: number,
  minGapMs: number = TUTORIAL_MIN_GAP_MS
): boolean {
  return lastTutorialShownAt === null || now - lastTutorialShownAt >= minGapMs;
}

// The one decision Board.tsx's activation effect needs: given the
// highest-priority tutorial id that's currently eligible-and-undismissed
// (`nextEligibleTutorialId`, or null if none), whether one is already on
// screen (`activeTutorialId`), and the cooldown state, should the next one
// actually start showing right now? False means "not yet" — the caller
// changes nothing, so the same eligible id is re-offered the next time this
// is checked (Board.tsx re-checks on every committed move, the natural
// "next reasonable opportunity" in a game with no ticking clock elsewhere —
// see CLAUDE.md's Design Constraints and Home's own "No timers. No rush."
// footer copy — rather than a background timer counting down to reveal it).
// This is why a blocked tutorial defers gracefully instead of vanishing: its
// own eligibility flag is untouched by a false answer here, so it simply
// asks again later, until this finally returns true.
export function shouldActivateTutorial(
  nextEligibleTutorialId: string | null,
  activeTutorialId: string | null,
  lastTutorialShownAt: number | null,
  now: number,
  minGapMs: number = TUTORIAL_MIN_GAP_MS
): boolean {
  if (activeTutorialId || !nextEligibleTutorialId) return false;
  return canShowTutorialNow(lastTutorialShownAt, now, minGapMs);
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
//
// `playableRatio` (see engine/boardShapes.ts's playableCellRatio) scales this
// down further for a shaped board — real playtesting on a `ring` level (55%
// playable) reported it as unfair, and confirmed this number was computed
// with zero awareness of voidCells. Defaults to 1 (a plain rectangle) so
// every pre-existing call site is unaffected. The MIN_MOVES floor is
// re-applied after scaling, not just before, so a heavily-voided board still
// can't drop below the same mechanically-unwinnable guarantee a full board
// gets.
//
// `breather` (see shouldApplyBreather below) is the difficulty-breather
// lever's own scale-up, same shape and same default-off convention as
// playableRatio — composed with it rather than replacing it, so a breather
// on a shaped board still gets both adjustments. BREATHER_MOVES_RATIO is a
// flat +30%: by the level range where a real losing streak is likely (past
// ~13), this function has already flatlined at MIN_MOVES, so the boost has
// to be large enough to read as a genuine, felt difference rather than a
// rounding blip.
export function generatedMovesLimit(
  levelNumber: number,
  playableRatio: number = 1,
  breather: boolean = false
): number {
  const BASE_MOVES = 24;
  const MIN_MOVES = 18;
  const BREATHER_MOVES_RATIO = 1.3;
  const step = Math.floor((levelNumber - 1) / 2);
  const fullBoardMoves = Math.max(MIN_MOVES, BASE_MOVES - step);
  const scaled = fullBoardMoves * playableRatio * (breather ? BREATHER_MOVES_RATIO : 1);
  return Math.max(MIN_MOVES, Math.round(scaled));
}

// Mirrors LEVEL_QUEUE's own light per-level growth in target count, capped
// well below generatedMovesLimit's floor so the objective stays reachable
// even at max difficulty.
//
// `playableRatio` (see engine/boardShapes.ts's playableCellRatio) scales this
// down for a shaped board, same reasoning and same default as
// generatedMovesLimit above: a smaller board has fewer cells to generate
// matches on, so the same total-pieces burden a full board can absorb is
// disproportionately harder on a board that's lost, say, 45% of its cells to
// a `ring` template. MIN_TARGET floors the result so a heavily-voided board
// never asks for a degenerately trivial handful of pieces.
//
// `breather` (see shouldApplyBreather below) is the difficulty-breather
// lever's own scale-down, same shape as generatedMovesLimit's own breather
// param above — composed with playableRatio, defaults off. BREATHER_TARGET_
// RATIO is a flat -30%, matching generatedMovesLimit's +30% in magnitude so
// the breather reads as one coherent easier level, not one lever moving far
// more than the other.
export function generatedTargetCount(
  levelNumber: number,
  playableRatio: number = 1,
  breather: boolean = false
): number {
  const BASE_TARGET = 20;
  const MAX_TARGET = 26;
  const MIN_TARGET = 10;
  const BREATHER_TARGET_RATIO = 0.7;
  const fullBoardTarget = Math.min(MAX_TARGET, BASE_TARGET + levelNumber);
  const scaled = fullBoardTarget * playableRatio * (breather ? BREATHER_TARGET_RATIO : 1);
  return Math.max(MIN_TARGET, Math.round(scaled));
}

// Teaching the generator to occasionally place a 'score' objective instead
// of the usual 'collect' one, reusing the same gate+cadence rotation shape
// every other generated-level lever already uses (generatedShapeId,
// eligibleBlockerIds' BLOCKER_MIN_LEVEL_NUMBER, DENIAL_SPREAD_MIN_LEVEL_
// NUMBER) rather than inventing a new gating mechanism. SCORE_OBJECTIVE_
// MIN_LEVEL_NUMBER is deliberately low (3, matching blockers' own
// introduce-at-level-3) rather than requiring a long ramp-up first: unlike
// blockers or board shapes, a player has already SEEN a 'score' objective
// by the time they ever reach a generated level at all — the hand-built
// LEVEL_QUEUE's own "Score Rush" (level 5) teaches it before the generator
// starts at level 8 (generatedLevelNumber 1) — so there's no new mechanic
// to ease a player into here, only variety to introduce. SCORE_OBJECTIVE_
// CADENCE (3) keeps it an occasional flavor, not a replacement for
// 'collect' objectives in general.
const SCORE_OBJECTIVE_MIN_LEVEL_NUMBER = 3;
const SCORE_OBJECTIVE_CADENCE = 3;

// Deliberately only ever consulted by buildGeneratedLevelConfig when
// objectiveCount === 1 (see generatedObjectiveCount below) — a generated
// level's multi-objective case (levelNumber >= 7, several distinct
// targetMatchTypes) is a separate, already-solved question, and mixing a
// score objective into that array was never asked for; keeping this
// function itself objectiveCount-agnostic (it just answers "is this
// levelNumber a score-flavored one," not "should THIS level use it") keeps
// that guard at the one real call site instead of being duplicated here.
export function isScoreObjectiveLevel(levelNumber: number): boolean {
  if (levelNumber < SCORE_OBJECTIVE_MIN_LEVEL_NUMBER) return false;
  return (levelNumber - SCORE_OBJECTIVE_MIN_LEVEL_NUMBER) % SCORE_OBJECTIVE_CADENCE === 0;
}

// The score-target equivalent of generatedTargetCount above, for a
// generated level chosen (via isScoreObjectiveLevel) to use a 'score'
// objective instead of 'collect'. Calibrated against the one real
// precedent this game has, the hand-built "Score Rush" (App.tsx's
// LEVEL_QUEUE, level 5): 1000 points across a 24-move level, ~41.7
// points/move — comfortably reachable from ordinary matches alone (a plain
// 3-match nets 30), with cascades/specials pulling it in faster.
//
// Density is deliberately calibrated against the level's UNSCALED moves
// limit (breather omitted from this inner call) rather than its final,
// already-breather-inflated one: generatedMovesLimit's own `breather` param
// already grants +30% MORE moves under a breather, so scaling the score
// target by that SAME inflated value would leave the points-per-move
// density — and therefore the real difficulty — completely unchanged,
// silently defeating the whole point of a breather. Applying
// BREATHER_SCORE_RATIO (a flat -30%, matching generatedTargetCount's own
// BREATHER_TARGET_RATIO) directly to the target, on top of the
// non-breather move count, is what actually makes a breather-granted score
// level easier.
//
// No separate MIN_SCORE_TARGET floor: generatedMovesLimit's own MIN_MOVES
// floor (18) already guarantees baseMovesLimit never drops below 18, so any
// additional floor here at or below round(18 * SCORE_POINTS_PER_MOVE) (750)
// could never actually bind — an unreachable safety net is worse than none,
// since it reads as protecting against a case that can't happen.
const SCORE_POINTS_PER_MOVE = 1000 / 24;
const BREATHER_SCORE_RATIO = 0.7;
export function generatedScoreTarget(
  levelNumber: number,
  playableRatio: number = 1,
  breather: boolean = false
): number {
  const baseMovesLimit = generatedMovesLimit(levelNumber, playableRatio);
  const scaled = baseMovesLimit * SCORE_POINTS_PER_MOVE * (breather ? BREATHER_SCORE_RATIO : 1);
  return Math.round(scaled);
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
// sealed_jar (specialOnly: true — see skins/lalas-kitchen/config.json and
// engine/DECISIONS.md's blocker-depth entry) is a genuinely different idea
// from a tougher hit-count, not just "harder pot_lid": it teaches "ordinary
// matches don't work here at all, you need a special piece." Gated later
// than every other blocker gate below (pot_lid at 7, denial-spread at 10),
// so a player has already met the base blocker concept, the tougher 2-hit
// variant, and a full-cap 4-blocker board before meeting one that outright
// ignores ordinary matches.
const BLOCKER_MIN_LEVEL_NUMBER: Record<string, number> = {
  pot_lid: 7,
  sealed_jar: 12,
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

// The difficulty-breather gate: the ramp above climbs then flatlines for
// good (generatedMovesLimit hits MIN_MOVES by level 13, generatedTargetCount
// hits MAX_TARGET by level 6), applying the same pressure forever regardless
// of how a player is actually doing. Two or more consecutive level losses in
// a row (App.tsx's consecutiveLossesRef, incremented by
// consecutiveLossesAfterLoss above on every real life-loss, hand-built or
// generated) earns the very next GENERATED level a temporary easier
// movesLimit/targetCount (see generatedMovesLimit/generatedTargetCount's own
// `breather` param) — never a hand-built LEVEL_QUEUE level, which has no
// formula-driven difficulty to relax. This is deliberately a one-off dip,
// not a ramp change: the moment it's granted, App.tsx consumes it by
// resetting the streak to 0, so the level immediately after resumes the
// exact same numbers the ramp would have given it anyway. A win also resets
// the streak to 0 regardless of whether a breather fired, per this
// session's brief.
export const BREATHER_LOSS_THRESHOLD = 2;
export function shouldApplyBreather(
  consecutiveLosses: number,
  levelIndex: number,
  handBuiltLevelCount: number
): boolean {
  return levelIndex > handBuiltLevelCount && consecutiveLosses >= BREATHER_LOSS_THRESHOLD;
}

// Which of a skin's blocker ids are allowed to appear at all at this
// generated-level-number — id order preserved from the input array so
// buildGeneratedLevelConfig's own rotation stays deterministic per level.
export function eligibleBlockerIds(levelNumber: number, blockerIds: string[]): string[] {
  return blockerIds.filter((id) => levelNumber >= (BLOCKER_MIN_LEVEL_NUMBER[id] ?? 1));
}

// Generator-driven board shapes: same gate shape as BLOCKER_MIN_LEVEL_NUMBER/
// DENIAL_SPREAD_MIN_LEVEL_NUMBER above, a levelNumber threshold plus a
// cadence, rather than a new gating mechanism.
//
// This was originally gated behind the full blocker roster (pot_lid, level
// 7) on the reasoning that reduced playable area meant fewer places for a
// match to land — a real difficulty concern at the time. That concern is now
// resolved: generatedMovesLimit/generatedTargetCount both scale against the
// shape's own playableCellRatio (see boardShapes.ts), so a shaped board is no
// longer harder than a rectangle at the same levelNumber, just smaller. With
// the difficulty reason gone, the real goal driving this gate is now purely
// "the game should read as visually distinctive within the first few minutes
// of play," not "protect an advanced player from an edge case" — so this is
// deliberately as aggressive as that goal calls for: eligible from the very
// first generated level (SHAPE_MIN_LEVEL_NUMBER = 1), and appearing on fully
// half of all generated levels (SHAPE_CADENCE = 2) rather than the original
// 1-in-4 "rare surprise" rate. Below the threshold (now never, since generated
// levels start at 1), or on an off-cadence level, a generated level is still
// a plain rectangle exactly as before this feature existed.
const SHAPE_MIN_LEVEL_NUMBER = 1;
const SHAPE_CADENCE = 2;

// A real playtest report ("the same board shape keeps appearing") traced back
// to a disclosed, deliberately-accepted coincidence (see engine/DECISIONS.md's
// "A disclosed, accepted cosmetic overlap" entry): SHAPE_MIN_LEVEL_NUMBER = 1
// always starts the rotation at BOARD_SHAPE_ROTATION[0] (cut_corners) on the
// generator's very first shaped level (raw level 8, generatedLevelNumber 1) —
// and hand-built level 7 "Pantry Corners" (App.tsx's LEVEL_QUEUE) was
// independently, deliberately given cut_corners too, as the gentlest template
// for a guaranteed early level. Those two independent choices collided,
// producing the same shape silhouette on two consecutive levels. Pantry
// Corners' own choice is left untouched — it's a reasonable pick on its own
// merits — so instead the generator's rotation is offset by 1 step, landing
// its first shaped level on BOARD_SHAPE_ROTATION[1] (plus) instead. plus, not
// ring, specifically: ring is the most severe template (55% playable, vs.
// plus's 80% and cut_corners' 70% — see boardShapes.ts's playableCellRatio
// doc), and easing a brand-new generated-level player into shapes via the
// gentler of the two remaining templates matches the same "gentlest first"
// reasoning Pantry Corners itself used. The offset only rotates the starting
// point — every template still appears exactly once per 3 shaped levels, in
// the same round-robin order, just starting one step in.
const SHAPE_ROTATION_OFFSET = 1;

// Which curated template (see engine/boardShapes.ts), if any, a generated
// level at this levelNumber should use. undefined means "plain rectangle".
// Cycles through BOARD_SHAPE_ROTATION by how many cadence steps have elapsed
// since the threshold, the same deterministic-by-levelNumber rotation
// eligibleBlockerIds/objective-target selection already use, so which shape
// appears is reproducible and doesn't repeat the same one twice in a row.
export function generatedShapeId(levelNumber: number): BoardShapeId | undefined {
  if (levelNumber < SHAPE_MIN_LEVEL_NUMBER) return undefined;
  const stepsSinceThreshold = levelNumber - SHAPE_MIN_LEVEL_NUMBER;
  if (stepsSinceThreshold % SHAPE_CADENCE !== 0) return undefined;
  const shapeIndex =
    (Math.floor(stepsSinceThreshold / SHAPE_CADENCE) + SHAPE_ROTATION_OFFSET) % BOARD_SHAPE_ROTATION.length;
  return BOARD_SHAPE_ROTATION[shapeIndex];
}

// Teaching the generator to occasionally place a 'clearance' objective
// (hidden per-cell layers — see engine/DECISIONS.md's clearance-layers
// entry), the other still-open "generator never produces this objective
// type" gap logged in DEFERRED_COMPLEXITY.md alongside score objectives
// above. Same gate+cadence shape as isScoreObjectiveLevel/generatedShapeId.
// A later threshold (5) than score's (3) and a wider cadence (4, vs. score's
// 3) — clearance is a structurally bigger ask than score (it changes what
// the BOARD looks like, hidden layers under specific tiles, not just a HUD
// number), so it stays rarer.
const CLEARANCE_MIN_LEVEL_NUMBER = 5;
const CLEARANCE_CADENCE = 4;

// Only ever consulted by buildGeneratedLevelConfig when `!useScoreObjective
// && objectiveCount === 1` — a 'clearance' objective never mixes with
// 'score' or a second 'collect' target, the exact same "objective types
// never combine" rule isScoreObjectiveLevel's own call site establishes.
export function isClearanceObjectiveLevel(levelNumber: number): boolean {
  if (levelNumber < CLEARANCE_MIN_LEVEL_NUMBER) return false;
  return (levelNumber - CLEARANCE_MIN_LEVEL_NUMBER) % CLEARANCE_CADENCE === 0;
}

// Which cells get a hidden layer, on a clearance-gated generated level.
// Calibrated against the one hand-built precedent, "Dusty Counter" (App.tsx's
// LEVEL_QUEUE, level 6): 6 layered cells on a 40-cell (8x5) board (15%), a
// third of them (2 of 6) at 2 layers, the rest at 1 — CLEARANCE_CELL_RATIO/
// CLEARANCE_DOUBLE_LAYER_FRACTION reproduce that same density on whatever
// board size/shape is actually passed in, rather than a hardcoded count.
//
// voidCells are excluded from candidacy (a layered cell never coexists with
// a void — see the clearance-layers entry's own confirmed scope line) —
// straightforward here since a shaped level's voidCells are already fully
// known before this runs (engine/boardShapes.ts's templates are pure
// functions of rows/cols, unlike blocker positions below). Blockers are a
// harder case: generateLevel places them via its own seeded RNG, genuinely
// unknown to this function ahead of time, so buildGeneratedLevelConfig
// sidesteps the ordering problem entirely by forcing blockerCount to 0 on
// any level this selects for — the same no-blockers shape "Dusty Counter"
// itself already uses, not a new restriction invented for the generator.
//
// Position selection is a deterministic stride over the playable cells
// (row-major order), offset by levelNumber so consecutive clearance levels
// don't always light up the identical cells — still fully deterministic
// per level (same levelNumber/rows/cols/voidCells always yields the same
// result), matching every other generated-level lever's own guarantee.
const CLEARANCE_CELL_RATIO = 6 / 40;
const CLEARANCE_DOUBLE_LAYER_FRACTION = 2 / 6;
export function generatedLayerCells(
  levelNumber: number,
  rows: number,
  cols: number,
  voidCells: Position[] = []
): Array<{ position: Position; layers: number }> {
  const voidKeys = new Set(voidCells.map((p) => `${p.row},${p.col}`));
  const playable: Position[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!voidKeys.has(`${row},${col}`)) playable.push({ row, col });
    }
  }
  if (playable.length === 0) return [];

  const targetCount = Math.max(1, Math.round(playable.length * CLEARANCE_CELL_RATIO));
  const stride = Math.max(1, Math.floor(playable.length / targetCount));
  const offset = levelNumber % stride;

  const chosen: Position[] = [];
  for (let i = offset; i < playable.length && chosen.length < targetCount; i += stride) {
    chosen.push(playable[i]);
  }

  const doubleLayerCount = Math.round(chosen.length * CLEARANCE_DOUBLE_LAYER_FRACTION);
  return chosen.map((position, i) => ({ position, layers: i < doubleLayerCount ? 2 : 1 }));
}

// Builds a full generator-driven LevelConfig (minus `lives`, same as
// LEVEL_QUEUE's own entries — App.tsx's buildLevelConfig adds that back)
// for any levelIndex past the hand-built queue. Board dimensions (rows/cols)
// stay fixed at the hand-built queue's own values — CLAUDE.md's edge-to-edge
// tile sizing is tuned against that grid, and board size itself was never
// asked for as a difficulty axis here, only piece-type count and move limit.
// Board *shape* is a separate lever from size: past SHAPE_MIN_LEVEL_NUMBER, an
// occasional level carves voidCells out of that same fixed rows/cols
// rectangle via generatedShapeId/engine/boardShapes.ts, rather than resizing
// the grid itself.
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
//
// `breather` (see shouldApplyBreather above) is decided and consumed by the
// caller (App.tsx, at the moment a level actually starts), never derived in
// here — this function stays a pure projection of levelIndex plus whatever
// the caller passes, with no knowledge of loss streaks. Defaults false so
// every pre-existing call site (tests, the level-map preview calls) is
// unaffected.
export function buildGeneratedLevelConfig(
  levelIndex: number,
  handBuiltLevelCount: number,
  allPieceTypeIds: string[],
  rows: number,
  cols: number,
  blockers: Array<{ id: string; hitsToClear: number; specialOnly?: boolean }> = [],
  breather: boolean = false
): Omit<LevelConfig, 'lives'> {
  const levelNumber = generatedLevelNumber(levelIndex, handBuiltLevelCount);
  const typeCount = generatedPieceTypeCount(levelNumber, allPieceTypeIds.length);
  const pieceTypeIds = allPieceTypeIds.slice(0, typeCount);

  // Computed before objectives/movesLimit below — real playtesting on a
  // `ring`-shaped level (55% playable at this board's fixed size) reported it
  // as genuinely unfair, and confirmed the two functions below were computing
  // difficulty from levelNumber alone, with zero awareness that a shape
  // template had just removed nearly half the board. playableRatio (see
  // engine/boardShapes.ts's playableCellRatio) feeds that awareness in.
  // Independent of every gate below — a shaped board and a blocker/
  // denial-spread level can coexist freely, since placeBlockers/the spread
  // logic already exclude void cells structurally (see engine/generator.ts
  // and engine/gameState.ts's stepDenialZone, both void-aware from the
  // hand-built showcase level onward).
  const shapeId = generatedShapeId(levelNumber);
  const voidCells = shapeId ? BOARD_SHAPE_TEMPLATES[shapeId](rows, cols) : undefined;
  const playableRatio = playableCellRatio(rows, cols, voidCells);

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
  // this splits cleanly to 13 + 13 on a full board (scaled down together by
  // playableRatio on a shaped one).
  const perObjectiveTarget = Math.ceil(generatedTargetCount(levelNumber, playableRatio, breather) / objectiveCount);
  // A 'score' objective only ever replaces a level's single 'collect'
  // objective (objectiveCount === 1) — never mixed alongside a second,
  // distinct-matchType 'collect' objective, which is a separate, already-
  // solved multi-objective question this wasn't asked to touch. See
  // isScoreObjectiveLevel's own comment for why the gate is levelNumber-only.
  const useScoreObjective = objectiveCount === 1 && isScoreObjectiveLevel(levelNumber);
  // A 'clearance' objective follows the exact same "only ever alone" rule as
  // 'score' above — !useScoreObjective keeps the two from ever both firing
  // on the same on-cadence level (their thresholds/cadences differ, 3/3 vs.
  // 5/4, so they COULD otherwise coincide; 'score' wins deterministically
  // when they do, simply by being checked first).
  const useClearanceObjective =
    !useScoreObjective && objectiveCount === 1 && isClearanceObjectiveLevel(levelNumber);
  const objectives = useScoreObjective
    ? [{ type: 'score' as const, targetCount: generatedScoreTarget(levelNumber, playableRatio, breather) }]
    : useClearanceObjective
      ? [{ type: 'clearance' as const }]
      : Array.from({ length: objectiveCount }, (_, i) => ({
          targetMatchType: pieceTypeIds[(levelNumber - 1 + i) % pieceTypeIds.length],
          targetCount: perObjectiveTarget,
        }));
  const layerCells = useClearanceObjective ? generatedLayerCells(levelNumber, rows, cols, voidCells) : undefined;

  const eligibleIds = eligibleBlockerIds(levelNumber, blockers.map((b) => b.id));
  const chosenBlocker =
    eligibleIds.length > 0
      ? blockers.find((b) => b.id === eligibleIds[(levelNumber - 1) % eligibleIds.length])
      : undefined;
  // Forced to 0 on a clearance level, regardless of what the blocker rotation
  // above would otherwise choose — see generatedLayerCells' own comment on
  // why (blocker positions are chosen by generateLevel's own seeded RNG,
  // genuinely unknown here, so a layered cell can't be guaranteed to avoid
  // one; sidestepped by simply not placing blockers on these levels at all,
  // the same no-blockers shape the hand-built "Dusty Counter" already uses).
  const blockerCount = useClearanceObjective ? 0 : chosenBlocker ? generatedBlockerCount(levelNumber) : 0;

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
    movesLimit: generatedMovesLimit(levelNumber, playableRatio, breather),
    objectives,
    ...(blockerCount > 0 && chosenBlocker
      ? {
          blockerCount,
          blockerMatchType: chosenBlocker.id,
          blockerHitsToClear: chosenBlocker.hitsToClear,
          ...(chosenBlocker.specialOnly ? { blockerSpecialOnly: true as const } : {}),
        }
      : {}),
    ...(denialSpread ? { denialSpread: true } : {}),
    ...(voidCells ? { voidCells } : {}),
    ...(layerCells && layerCells.length > 0 ? { layerCells } : {}),
  };
}
