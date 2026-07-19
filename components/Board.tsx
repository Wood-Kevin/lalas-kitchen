import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import {
  Board as BoardMatrix,
  GameState,
  LevelConfig,
  Position,
  applyMove,
  createGameState,
  grantBonusMoves,
  requestManualShuffle,
} from '../engine/gameState';
import {
  canStartLevel,
  findBlockerMatchType,
  shouldShowBlockerTutorial,
  BLOCKER_TUTORIAL_ID,
  shouldShowBoardShapeTutorial,
  BOARD_SHAPE_TUTORIAL_ID,
  findSpecialPieceTutorial,
  findSpreadWarningTutorial,
  findSealedJarTutorial,
  SPECIAL_ONLY_BLOCKER_TUTORIAL_ID,
  SpecialPieceTutorial,
  shouldShowChainReactionTutorial,
  CHAIN_REACTION_TUTORIAL_ID,
  shouldShowOnboardingTutorial,
  HOW_TO_PLAY_TUTORIAL_ID,
  shouldActivateTutorial,
} from '../appPersistence';
import { findAnyLegalMove } from '../engine/matrix';
import { RecipeCard, SkinConfig } from './skinConfig';
import { diffBoards } from './boardDiff';
import { resolveDragTarget } from './dragDirection';
import {
  SpecialEffectDescriptor,
  buildPassAnimation,
  resolveSpecialEffectDescriptor,
} from './specialEffectAnimation';
import { getSpriteForPiece } from './spriteMap';
import { ExitingEntry, buildExitingEntry, exitingTileSprite } from './exitingTile';
import { resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';
import {
  cascadeFallDurationMs,
  terminalOverlayHoldMs,
  SWEEP_TILE_STAGGER_MS,
  COLOR_BOMB_WAVE_MS,
  SUPERCOMBO_CONVERT_MS,
  CHAIN_LINK_STAGGER_MS,
} from './cascadeTiming';
import { Hud } from './Hud';
import { resolveLevelDisplayName } from './levelProgress';
import { BlockerTutorialOverlay } from './BlockerTutorialOverlay';
import { SpecialTutorialOverlay } from './SpecialTutorialOverlay';
import { adService } from '../services/defaultAdService';
import { soundService } from '../services/defaultSoundService';
import { hapticsService } from '../services/defaultHapticsService';
import { PausedOverlay } from './PausedOverlay';
import { ContinueOffer } from './ContinueOffer';
import {
  canUseHint,
  nextAttemptUseCount,
  shouldOfferContinue,
} from './pauseActions';
import { WonOverlay } from './WonOverlay';
import { ExitingTile, Tile } from './Tile';
import { ComboStreakBanner } from './ComboStreakBanner';
import { triggerPassEffects } from './soundEffects';

export interface BoardProps {
  levelConfig: LevelConfig;
  skinConfig: SkinConfig;
  // Per-skin bundled sprite images, keyed by the same filenames
  // skinConfig.pieceTypes/blockers point at. A separate prop from
  // skinConfig because it's built from static require() calls (see
  // skins/lalas-kitchen/spriteRegistry.ts), not JSON-serializable data.
  spriteAssets: SpriteAssetMap;
  // Fired after every gameState change (a resolved move, a bonus grant),
  // including once on mount — a plain state mirror, not an event stream.
  // The app shell uses it to know the current `lives` value at the moment
  // it needs to persist (level end, backgrounding), without Board owning
  // any opinion about when or where saving happens.
  onStateChange?: (state: GameState) => void;
  // WonOverlay's primary action — advances to the next level (hand-built or
  // generated; App.tsx decides which). Distinct from Board's own
  // handlePlayAgain below, which replays this same level and stays
  // entirely internal.
  onNextLevel: () => void;
  // WonOverlay's secondary action — routes to the level-select dashboard.
  // Board has no notion of a level queue or dashboard beyond handing this
  // callback through.
  onOpenDashboard: () => void;
  // Returns to Home immediately, no confirmation — wired to both the
  // persistent HUD close button (visible whenever status is 'in_progress')
  // and PausedOverlay's "Exit" option. Board never calls saveProgress
  // itself (see App.tsx), so leaving this way is a plain unmount: whatever
  // progress this attempt made simply isn't persisted, same as it wasn't
  // before this session.
  onExit: () => void;
  // The account's *current* persisted lives count — kept fresh by App.tsx
  // (regen + loss decrements both happen there), not the frozen
  // `levelConfig.lives` snapshot from whenever this Board instance first
  // mounted. handlePlayAgain reads this (not levelConfig.lives) so a
  // restart after a loss reflects the life that was just spent, and gates
  // on it the same way every other level-start entry point does (see
  // appPersistence.ts's canStartLevel).
  lives: number;
  // Routes to the same "out of lives" screen Home's "Start cooking" and an
  // All Levels row already route to when blocked — Play again is the one
  // level-start entry point that lives entirely inside Board and never
  // otherwise calls back into App.tsx.
  onOutOfLives: () => void;
  // Fired exactly once per attempt, at the moment this attempt's life is
  // actually spent — either a moves-exhausted pause with no rescue left to
  // offer (pauseActions.ts's shouldOfferContinue false), or the player
  // explicitly declining the rescue ContinueOffer still had on offer. App.tsx
  // owns the account-level `lives` count (regen + decrement), so this is
  // mostly a "spend one now" signal, not a state report — but it also
  // returns the fresh count synchronously, since a decline calls this and
  // then handlePlayAgain in the same tick, before the `lives` prop below has
  // re-rendered with the post-spend value (see handleContinueDeclinePlayAgain).
  onLifeLost: () => number;
  // Display-only — App.tsx already keys Board by this value to force a
  // remount per level, so threading it through as a prop too is just
  // exposing existing data to WonOverlay/PausedOverlay for their "LEVEL N"
  // label, not new state.
  levelIndex: number;
  // The account's persisted completed-level history — read once at mount
  // alongside `levelIndex`/`seenTutorials` to decide whether the onboarding
  // tutorial should show (see appPersistence.ts's
  // shouldShowOnboardingTutorial): `levelIndex === 1` alone can't tell a
  // genuinely fresh save from an experienced player replaying level 1, but
  // an empty `completedLevels` can.
  completedLevels: number[];
  // The account's persisted one-time-tutorial-seen list (App.tsx's
  // seenTutorials, loaded from SaveData) — read once at mount to decide
  // whether the blocker tutorial should show (see appPersistence.ts's
  // shouldShowBlockerTutorial), same "real prop, not hardcoded" reasoning
  // as `lives`/`seenTutorials` elsewhere in this file.
  seenTutorials: string[];
  // Fired once, when the blocker tutorial is dismissed — App.tsx adds the
  // id to its own seenTutorials and persists immediately (see App.tsx's
  // handleTutorialSeen), the same "must survive an app close" reasoning as
  // handleGrantLife's explicit save.
  onTutorialSeen: (id: string) => void;
  // The wall-clock moment any tutorial overlay (any of the seven) last
  // actually appeared on screen, or null if none ever has this session — the
  // anchor behind the tutorial-cadence throttle (see appPersistence.ts's
  // shouldActivateTutorial/canShowTutorialNow). Lifted to App.tsx rather than
  // tracked only inside Board because Board fully remounts every level (see
  // App.tsx's key={levelIndex}), but two tutorials landing close together
  // across a level boundary — a mount-time tutorial on level N+1 arriving
  // moments after one shown at the end of level N — is exactly the case this
  // throttle exists to catch. Deliberately NOT persisted into SaveData:
  // this paces a single active play session, not something that should still
  // be counting down after the player has closed and reopened the app.
  lastTutorialShownAt: number | null;
  // Fired the moment a tutorial actually starts showing (not on dismiss) —
  // App.tsx stores the timestamp in lastTutorialShownAtRef so the next
  // Board mount (a new level) inherits the real anchor instead of starting
  // fresh at null every time.
  onTutorialShown: (shownAt: number) => void;
  // The recipe card this exact win unlocked for the first time, or null —
  // computed by App.tsx at the same win transition completedLevels updates
  // from (see App.tsx's handleBoardStateChange), threaded straight through
  // to WonOverlay unchanged. Board has no opinion about milestone mapping
  // or the persisted unlocked-cards list; it only renders whatever App.tsx
  // resolves.
  unlockedRecipeCard: RecipeCard | null;
  // Whether sound effects / haptic feedback should play — App.tsx's
  // soundEnabled/hapticsEnabled, read fresh each render (a toggle flip on
  // Home should take effect on the very next move, not just a future
  // session). See components/soundEffects.ts's triggerPassEffects, called
  // from animateCascade below.
  soundEnabled: boolean;
  hapticsEnabled: boolean;
}

const BOARD_HORIZONTAL_PADDING = 12;

// A drag commits to a neighbour once the finger has travelled this fraction of
// a tile toward it — well short of the neighbour's centre, so a swap doesn't
// require dragging the whole way there, but far enough that a small wobble on a
// tap-turned-drag doesn't fire an unintended swap.
const DRAG_SWAP_THRESHOLD_FRACTION = 0.4;

function isAdjacent(a: Position, b: Position): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

// Reads GameState + the active skin's config and renders the board. Never
// contains a literal piece name — every piece is drawn purely from its engine
// type + matchType id via getSpriteForPiece (both the live tiles and the
// exiting/clearing tiles), so this file would render an entirely different skin
// unchanged.
export function Board({
  levelConfig,
  skinConfig,
  spriteAssets,
  onStateChange,
  onNextLevel,
  onOpenDashboard,
  onExit,
  lives,
  onOutOfLives,
  onLifeLost,
  levelIndex,
  completedLevels,
  seenTutorials,
  onTutorialSeen,
  lastTutorialShownAt,
  onTutorialShown,
  unlockedRecipeCard,
  soundEnabled,
  hapticsEnabled,
}: BoardProps) {
  const [gameState, setGameState] = useState<GameState>(() => createGameState(levelConfig));
  // Computed once at mount, from this level's own starting props — same
  // "genuinely fresh save" gate as appPersistence.ts's
  // shouldShowOnboardingTutorial (levelIndex === 1 and nothing ever
  // completed yet, not re-derived from anything mid-level). Takes priority
  // over every other tutorial (see canAcceptMove/the render order below):
  // it teaches the base mechanic every other tutorial already assumes.
  const [showOnboardingTutorial, setShowOnboardingTutorial] = useState(() =>
    shouldShowOnboardingTutorial(levelIndex, completedLevels, seenTutorials)
  );
  // Computed once at mount, from this level's initial board only — not
  // re-derived on every render as blockers get cleared mid-level (see
  // appPersistence.ts's shouldShowBlockerTutorial for why). Surviving a
  // "Play again" restart mid-session correctly stays false here even
  // though that regenerates `gameState` with a new seed/board, since this
  // is independent state, not something re-derived from `gameState`.
  const [showBlockerTutorial, setShowBlockerTutorial] = useState(() =>
    shouldShowBlockerTutorial(gameState.board, seenTutorials)
  );
  // Same mount-time shape as showBlockerTutorial above, and for the same
  // reason: a level's void cells (see engine/matrix.ts's `'void'` PieceType)
  // are fixed at generation (LevelConfig.voidCells), never introduced
  // mid-level, so the initial board is the correct — and only — place to
  // check.
  const [showBoardShapeTutorial, setShowBoardShapeTutorial] = useState(() =>
    shouldShowBoardShapeTutorial(gameState.board, seenTutorials)
  );
  // Mount-time like showBlockerTutorial (a specialOnly blocker only ever
  // enters a level at generation — see appPersistence.ts's
  // findSealedJarTutorial for why the spread can't mint one on a board that
  // started without any), but holding the found SpecialPieceTutorial rather
  // than a boolean so the overlay can show the real jar piece's own sprite.
  const [sealedJarTutorial, setSealedJarTutorial] = useState<SpecialPieceTutorial | null>(
    () => findSealedJarTutorial(gameState.board, seenTutorials) ?? null
  );
  // The special-piece tutorial currently showing (striped / color bomb / area
  // bomb / spread warning), or null. Unlike showBlockerTutorial this can't be
  // a mount-time check: a special piece never exists on a level's initial
  // board — the player forges it mid-level — and a spread-zone warning is
  // likewise only ever marked after real unaddressed moves, so both are
  // re-derived after every committed move (see the post-move effect below),
  // not once at mount.
  const [specialTutorial, setSpecialTutorial] = useState<SpecialPieceTutorial | null>(null);
  // Ids dismissed during THIS Board's lifetime, folded into the seen check
  // alongside the persisted `seenTutorials` prop. The prop does eventually
  // update (App.tsx's handleTutorialSeen persists immediately), but this ref
  // guarantees a just-dismissed special can't flash back in the render gap
  // before that round-trips down as a fresh prop.
  const dismissedSpecialTutorialsRef = useRef<Set<string>>(new Set());
  // The tutorial-cadence throttle's own anchor: this Board's local copy of
  // "when did any tutorial last actually appear", seeded from the persisted
  // App.tsx prop and updated locally the instant one activates (see the
  // effect below) — same "own ref, bubble up via a callback" shape as
  // dismissedSpecialTutorialsRef above, so this Board's own activation
  // decisions never wait on a round-trip through App.tsx's re-render.
  const lastTutorialShownAtRef = useRef<number | null>(lastTutorialShownAt);
  // Which tutorial (if any) is actually ON SCREEN right now, by id — the
  // single gate every render condition and input check below uses, replacing
  // the raw showOnboardingTutorial/showBoardShapeTutorial/showBlockerTutorial/
  // specialTutorial booleans for that purpose. Those four still track their
  // own "eligible and not yet dismissed" condition exactly as before (see
  // nextEligibleTutorialId below); this is the layer that decides whether the
  // highest-priority eligible one is allowed to actually start showing yet.
  const [activeTutorialId, setActiveTutorialId] = useState<string | null>(null);
  // The highest-priority tutorial that WANTS to show right now, ignoring the
  // cooldown entirely — the same priority order the render JSX has always
  // used (onboarding > board shape > blocker > special-piece/spread/chain-
  // reaction). Recomputed every render, since it's a cheap read of state
  // that's already up to date.
  const nextEligibleTutorialId = showOnboardingTutorial
    ? HOW_TO_PLAY_TUTORIAL_ID
    : showBoardShapeTutorial
    ? BOARD_SHAPE_TUTORIAL_ID
    : showBlockerTutorial
    ? BLOCKER_TUTORIAL_ID
    : sealedJarTutorial
    ? SPECIAL_ONLY_BLOCKER_TUTORIAL_ID
    : specialTutorial
    ? specialTutorial.id
    : null;
  // The actual activation: lets nextEligibleTutorialId become the active,
  // rendered tutorial only once shouldActivateTutorial says the cooldown has
  // cleared (see appPersistence.ts). If it hasn't, this simply does nothing —
  // nextEligibleTutorialId is untouched, so the same candidate is re-offered
  // the next time this effect re-runs. Keyed on `gameState` (alongside the
  // two inputs that can change what's eligible) so a real move commit is what
  // re-checks a deferred tutorial, matching this game's "no ticking timers"
  // design constraint rather than polling on an interval. useLayoutEffect, not
  // useEffect, so an already-clear cooldown activates before the next paint —
  // otherwise a fresh mount would flash one frame of bare board before the
  // onboarding overlay appeared.
  //
  // Guarded on gameState.status === 'in_progress', same as the special-piece
  // scan effect below — a real edge case a fast win/loss surfaced live during
  // this feature's own verification: without deferral, a mount-time tutorial
  // (board_shape/blocker) always rendered on the very first frame, before any
  // move could possibly end the level, so this race never existed. Deferral
  // makes it newly possible for a level to end while a tutorial is still
  // sitting on cooldown; without this guard, the cooldown clearing on the
  // very move that wins or loses the level would pop a tutorial card over the
  // Won/Paused overlay — exactly the "glitchy, not calm" outcome this game's
  // whole tutorial system exists to avoid. A still-eligible mount tutorial
  // that never got its chance on this level isn't lost: shouldShowBoardShape/
  // BlockerTutorial re-derive fresh from scratch on the next level's own
  // mount, so it's naturally re-offered the next time that same trigger
  // condition genuinely recurs.
  useLayoutEffect(() => {
    if (gameState.status !== 'in_progress') return;
    const now = Date.now();
    if (!shouldActivateTutorial(nextEligibleTutorialId, activeTutorialId, lastTutorialShownAtRef.current, now)) {
      return;
    }
    lastTutorialShownAtRef.current = now;
    setActiveTutorialId(nextEligibleTutorialId);
    onTutorialShown(now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextEligibleTutorialId, activeTutorialId, gameState]);
  const [selected, setSelected] = useState<Position | null>(null);
  // The neighbour a live drag is currently pointing at, or null. Drives the
  // destination highlight on the targeted tile (see Tile's dragTargeted). Pure
  // presentation — it never feeds applyMove; the release handler recomputes
  // the target from the final drag vector so a fast release can't act on a
  // stale value.
  const [dragTarget, setDragTarget] = useState<Position | null>(null);
  const [exiting, setExiting] = useState<ExitingEntry[]>([]);
  const [spawnedIds, setSpawnedIds] = useState<Set<string>>(new Set());
  const [swapDurationIds, setSwapDurationIds] = useState<Set<string>>(new Set());
  const [snapBack, setSnapBack] = useState<{ a: Position; b: Position } | null>(null);
  // A unique key per combo_streak event (see engine/gameState.ts), not just
  // a boolean — ComboStreakBanner is keyed by this so back-to-back combos
  // each mount a fresh instance and replay the fade from the start, rather
  // than a second event landing mid-fade doing nothing because the banner
  // was already mounted.
  const [comboKey, setComboKey] = useState<string | null>(null);
  // How many "watch a video for more moves" grants this attempt has taken.
  // Per-attempt state, on purpose: it starts at 0 on every fresh mount (a
  // brand-new entry from Home / All Levels remounts Board, see App.tsx's
  // key={levelIndex} and its game-screen conditional) and is reset to 0 in
  // handlePlayAgain, so the cap is a fresh-chances-this-round limit, never a
  // lifetime or daily one. shouldOfferContinue(reason, bonusGrantsUsed) is
  // what decides whether ContinueOffer (the video CTA) or PausedOverlay (the
  // terminal loss screen) renders on a moves-exhausted pause — and, in
  // runStep above, whether that pause spends this attempt's life immediately.
  // See pauseActions.ts.
  const [bonusGrantsUsed, setBonusGrantsUsed] = useState(0);
  // Measured via onLayout rather than Dimensions.get('window'), since the
  // board area's actual available space is whatever's left after the HUD
  // and safe-area insets are applied — Dimensions.get('window') only knows
  // the raw screen size, not what this component actually has to work with,
  // which is what left the board undersized with empty space below it.
  const [boardArea, setBoardArea] = useState<{ width: number; height: number } | null>(null);
  // Advances on every "play again" tap so a fresh attempt doesn't hand the
  // seeded generator (see engine/generator.ts) the exact same seed it just
  // started from — each replay gets a different, still-deterministic board.
  const nextSeedRef = useRef(levelConfig.seed + 1);
  // While a multi-pass cascade is animating, the tiles render from this
  // intermediate snapshot instead of gameState.board — applyMove now returns
  // one board per cascade pass (see engine/gameState.ts's ApplyMoveResult),
  // and we walk them in sequence so each pass reads as its own beat rather
  // than the whole chain resolving at once. Null whenever nothing is
  // mid-animation, in which case the live gameState.board is shown directly.
  const [displayBoard, setDisplayBoard] = useState<BoardMatrix | null>(null);
  // Gates the terminal (Won / Paused) overlays so they appear only once the
  // final cascade pass has genuinely finished playing, not the instant
  // gameState commits `won`/`paused` at the *start* of that pass (see
  // animateCascade's final branch). Without this the winning move's last
  // cascade — the chain reaction the player most wants to watch — is cut off by
  // the overlay popping over a still-resolving board. Kept separate from
  // gameState.status: the status (and therefore App-level persistence, recipe
  // unlocks, input lockout) still commits with the data on the final pass; only
  // this visual reveal waits the extra beat. Set false at the start of every
  // move so a fresh terminal move always re-gates.
  const [terminalOverlayReady, setTerminalOverlayReady] = useState(false);
  // Synchronous input lock: gameState isn't committed until the cascade
  // finishes animating (so the win/paused overlay doesn't pop mid-chain), so
  // without this a tap during the animation would call applyMove against the
  // stale pre-move state. A ref, not state, because handleTilePress must see
  // the current value the instant it's set, not on the next render.
  const animatingRef = useRef(false);
  // Same reasoning as animatingRef above, for the same class of problem: a
  // rapid double-tap on ContinueOffer's "watch a video" button could fire
  // handleGrant twice before either the real ad SDK responds or React
  // re-renders, requesting two concurrent rewarded ads. A ref (not state)
  // so the very first line of handleGrant sees the in-flight request
  // instantly, before any re-render; grantInFlight (state, right below)
  // exists purely to drive ContinueOffer's disabled/opacity styling, which
  // needs an actual reactive value to render, unlike this ref.
  const grantInFlightRef = useRef(false);
  const [grantInFlight, setGrantInFlight] = useState(false);
  // Pending step/cleanup timers, cleared on unmount and on "play again" so a
  // cascade animation from an abandoned attempt can't fire into a fresh one.
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Monotonic per-move id, used only to key exiting tiles uniquely across
  // moves (a piece clears at most once per move, so id+move is unique).
  const moveCounterRef = useRef(0);
  // The calm stuck-player hint (see CLAUDE.md's Playtest Feedback Protocol's
  // calm-not-frantic principle and engine/DECISIONS.md's stuck-player-hint
  // entry): tapping the HUD hint button glows a real legal move
  // (engine/matrix.ts's findAnyLegalMove) so a player who gets stuck scanning
  // the board has an easy way out. This used to fire automatically after an
  // idle countdown, but that risked interrupting genuine thinking time no
  // matter how the threshold was tuned — a player-initiated button removes
  // the guess entirely. Null whenever no hint is showing.
  const [hintPair, setHintPair] = useState<{ a: Position; b: Position } | null>(null);
  // How many times this attempt has tapped the hint button. Same per-attempt
  // shape as bonusGrantsUsed just below — starts at 0 on a fresh mount, reset
  // in handlePlayAgain — via the same shared nextAttemptUseCount/
  // AttemptUseEvent pauseActions.ts already provides for the bonus-moves
  // grant, rather than a second copy of "increment, or reset on restart."
  const [hintUsesUsed, setHintUsesUsed] = useState(0);

  // The board actually drawn: the mid-cascade snapshot when animating, else
  // the committed game state. Grid dimensions are identical either way, so
  // deriving rows/cols/tileSize from this is always correct.
  const renderBoard = displayBoard ?? gameState.board;
  const rows = renderBoard.length;
  const cols = renderBoard[0]?.length ?? 0;

  const tileSize = useMemo(() => {
    if (!boardArea) return 0;
    const availableWidth = boardArea.width - BOARD_HORIZONTAL_PADDING * 2;
    const byWidth = Math.floor(availableWidth / cols);
    const byHeight = Math.floor(boardArea.height / rows);
    // Bounded by whichever axis is tighter, so the board fills the taller
    // available height on a phone-shaped screen instead of only ever being
    // sized off screen width (see CLAUDE.md's edge-to-edge board constraint).
    // On a wide/short viewport (desktop), height is the tighter axis, so the
    // rendered board ends up narrower than boardArea itself.
    return Math.max(0, Math.min(byWidth, byHeight));
  }, [boardArea, rows, cols]);

  const boardWidth = cols * tileSize;

  useEffect(() => {
    onStateChange?.(gameState);
    // Only gameState identity should retrigger this — onStateChange is
    // frequently a fresh closure per parent render, and re-firing on that
    // alone would report the same state repeatedly for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  // Show a special piece's one-time tutorial the first time it comes to rest on
  // the committed board — or, failing that, the spread-warning tutorial the
  // first time a cell actually carries the denial-zone's warning crack (see
  // findSpreadWarningTutorial; same "re-derived after every move" reasoning as
  // a special piece, since a warning is only ever marked by a real unaddressed
  // move, never present on a level's initial board). Keyed on gameState (the
  // same identity onStateChange uses) so it fires exactly when a move settles,
  // never mid-cascade — the player watches the piece land, then the calm
  // explanation appears. Skipped once the level has ended (status !==
  // in_progress) so it never pops over the Won/Paused overlay, and while
  // another tutorial is already up so two never stack. Both the persisted prop
  // and this session's dismissals feed the seen check, keeping the once-ever
  // guarantee honest across the persist round-trip.
  useEffect(() => {
    if (gameState.status !== 'in_progress') return;
    if (showOnboardingTutorial || showBoardShapeTutorial || showBlockerTutorial || sealedJarTutorial || specialTutorial) return;
    const seen = [...seenTutorials, ...dismissedSpecialTutorialsRef.current];
    const match = findSpecialPieceTutorial(gameState.board, seen) ?? findSpreadWarningTutorial(gameState.board, seen);
    if (match) setSpecialTutorial(match);
    // Only a committed gameState change should retrigger this — see the
    // onStateChange effect above for the same deps reasoning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  const cascadeDurationMs = cascadeFallDurationMs(skinConfig.animationProfile.cascadeFallSpeed);
  const swapDurationMs = skinConfig.animationProfile.swapDurationMs;
  const matchDurationMs = skinConfig.animationProfile.matchDurationMs;
  // How long the swap-specific duration should apply to the just-tapped
  // pair before falling back to the (longer-lived) cascade duration for any
  // subsequent move — bounds the bookkeeping Sets below instead of letting
  // them grow for the life of the level.
  const transitionWindowMs = Math.max(cascadeDurationMs, swapDurationMs);
  // Delay between one cascade pass's clears settling and the next pass's
  // clears beginning. Reuses the existing per-pass fall duration as the beat
  // rather than inventing a new number or stretching one value across the
  // whole chain — each pass gets the same calm, legible pacing a single
  // cascade already has (see CLAUDE.md's calm-not-frantic constraint).
  const cascadeStepIntervalMs = cascadeDurationMs;
  // How long after the final cascade pass commits before the terminal overlay
  // is revealed — one full between-pass beat, so the last pass gets the same
  // play time every earlier pass already got (see cascadeTiming.ts).
  const terminalOverlayHold = terminalOverlayHoldMs(cascadeStepIntervalMs);

  useEffect(() => {
    // Clear any in-flight cascade timers if this Board unmounts mid-animation
    // (e.g. the player exits to Home), so a queued step can't fire into a
    // torn-down component. stepTimersRef is a ref, so this effect needs no
    // deps — it only ever runs its cleanup on unmount.
    return () => {
      stepTimersRef.current.forEach((timer) => clearTimeout(timer));
      stepTimersRef.current = [];
    };
  }, []);

  // True only when a fresh move may be started: the level is live, nothing is
  // mid-animation, and no overlay is up. Both input methods (tap and drag)
  // gate on this identically. animatingRef is a ref (not state) so the check
  // sees the in-flight cascade the instant it starts, before a re-render.
  function canAcceptMove(): boolean {
    return (
      gameState.status === 'in_progress' &&
      !snapBack &&
      !activeTutorialId &&
      !animatingRef.current
    );
  }

  // Hides any showing hint any time the "can a move even be made right now"
  // gate changes for any reason: a move settles (gameState changes), an
  // illegal swap snaps back (still real input — attemptSwap's own immediate
  // hide below covers the gap before that state change lands), or an
  // overlay/tutorial opens or closes. A stale hint glow surviving into a
  // state where it no longer applies (e.g. a tutorial covering the board) is
  // exactly the "glitchy, not calm" moment this feature exists to avoid; the
  // button itself only requests a fresh hint on demand, so there's no
  // countdown left to re-arm here — just the same clearing this effect always
  // did.
  useEffect(() => {
    setHintPair(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, snapBack, activeTutorialId]);

  // The single move-commit path shared by tap-to-select and drag-to-swap: run
  // applyMove for an adjacent pair and either snap back (rejected) or animate
  // the resulting cascade. Both callers have already established the two cells
  // are adjacent and a move is allowed.
  function attemptSwap(posA: Position, posB: Position) {
    // Hide any showing hint the moment a player actually makes a move, not
    // after this move's cascade finishes settling (gameState doesn't commit
    // until animateCascade's final pass, well below) — a stale glow surviving
    // into an already-outdated board is the same "glitchy, not calm" case the
    // effect above guards against.
    setHintPair(null);

    const result = applyMove(gameState, posA, posB);

    if (result.state === gameState) {
      // Illegal move: applyMove's contract returns the identical state
      // object for a rejected swap (see engine/DECISIONS.md), which is what
      // makes this reference check a reliable "was this legal?" signal.
      // Play a brief visual swap-and-snap-back; no state change underneath.
      setSnapBack({ a: posA, b: posB });
      setTimeout(() => setSnapBack(null), swapDurationMs * 2);
      return;
    }

    const tappedIds = new Set([
      gameState.board[posA.row][posA.col].id,
      gameState.board[posB.row][posB.col].id,
    ]);
    // result.events surfaces combo_streak the same way the step diffs surface
    // cleared/spawned pieces — both are derived from the same applyMove call.
    // Fired when the chain finishes animating (see animateCascade), so the
    // acknowledgment lands on the completed streak, not its first pass.
    const hasCombo = result.events.some((event) => event.type === 'combo_streak');
    // Which swap-triggered effect (if any) this move fired — derived purely
    // from the pre-move board's two swapped cells (see
    // specialEffectAnimation.ts), the same read-only classification
    // isBlockerClear/isPowderBurst already use. Only ever meaningful for the
    // first cascade pass (see animateCascade/runStep).
    const effectDescriptor = resolveSpecialEffectDescriptor(gameState.board, posA, posB);

    animateCascade(
      gameState.board,
      result.state,
      result.steps,
      tappedIds,
      hasCombo,
      result.multiSpecialFired,
      effectDescriptor,
      result.chainWaveByPieceId
    );
  }

  function handleTilePress(pos: Position) {
    if (!canAcceptMove()) return;

    if (!selected) {
      setSelected(pos);
      return;
    }
    if (selected.row === pos.row && selected.col === pos.col) {
      setSelected(null);
      return;
    }
    if (!isAdjacent(selected, pos)) {
      setSelected(pos);
      return;
    }

    const posA = selected;
    const posB = pos;
    setSelected(null);
    attemptSwap(posA, posB);
  }

  // Maps a drag vector originating on `origin` to the neighbour it points at,
  // or null if it's below threshold or would run off the board edge. Shared by
  // the live-highlight and release handlers so both agree on the target. The
  // threshold scales with tileSize (see the Tile props below), so "far enough"
  // stays proportional across screen sizes.
  function dragNeighbor(origin: Position, dx: number, dy: number): Position | null {
    // Same decision Tile's onFinalize makes on release (see resolveDragTarget) —
    // one geometry, so the live highlight, the committed swap, and the tile's
    // spring-back-or-not can never disagree.
    return resolveDragTarget(dx, dy, origin, rows, cols, tileSize * DRAG_SWAP_THRESHOLD_FRACTION);
  }

  // Live during a drag: light up whichever neighbour the finger currently
  // points at (or clear the highlight if none). Presentation only.
  function handleDragMove(origin: Position, dx: number, dy: number) {
    if (!canAcceptMove()) return;
    const target = dragNeighbor(origin, dx, dy);
    setDragTarget((prev) =>
      target && prev && prev.row === target.row && prev.col === target.col ? prev : target
    );
  }

  // On release: recompute the target from the final vector and, if there is
  // one, run it through the exact same attemptSwap path a tap-swap uses.
  function handleDragEnd(origin: Position, dx: number, dy: number) {
    setDragTarget(null);
    if (!canAcceptMove()) return;
    const target = dragNeighbor(origin, dx, dy);
    if (!target) return;
    // Clear any half-finished tap selection so the two input methods can't
    // leave a stale highlight behind after a drag commits a move.
    setSelected(null);
    attemptSwap(origin, target);
  }

  // Walks the per-pass board snapshots applyMove returned, animating each as
  // its own beat: pass i's clears/refill are diffed against the previously
  // shown board, played, then a fixed interval later pass i+1 begins. The
  // committed gameState (and any win/paused overlay it implies) is deferred
  // to the final pass so overlays never appear over a still-resolving board.
  // A single-pass move (steps.length === 1) collapses to exactly the prior
  // one-shot behavior: one diff from the pre-move board straight to the
  // settled board, gameState committed immediately.
  function animateCascade(
    fromBoard: BoardMatrix,
    finalState: GameState,
    steps: BoardMatrix[],
    tappedIds: Set<string>,
    hasCombo: boolean,
    multiSpecialFired: boolean,
    effectDescriptor: SpecialEffectDescriptor | undefined,
    chainWaveByPieceId: Record<string, number>
  ) {
    animatingRef.current = true;
    // The final pass's chain-staging hold (see PassAnimation.chainHoldMs) —
    // set by runStep before it calls commitFinalState synchronously, so the
    // terminal-overlay hold below can stretch to cover a chain's late links.
    // Stays 0 for a chainless move (and the zero-steps dropdown case), so
    // the overlay timing is byte-identical to before.
    let finalPassChainHoldMs = 0;
    // Re-gate the terminal overlay for this move: even if a prior move left it
    // revealed, the win/pause for THIS move must wait for THIS move's final
    // pass to finish animating.
    setTerminalOverlayReady(false);
    const moveId = moveCounterRef.current++;
    let previous = fromBoard;

    // Final pass: commit the real game state (its board is this exact last
    // snapshot, or — for the zero-pass case below — fromBoard itself, since
    // applyMove already confirmed nothing changed it) and drop the
    // intermediate display board in the same render, so nothing jumps. Fire
    // the combo ack here, on the settled chain. Extracted out of runStep so
    // the genuinely-nothing-cleared case (see steps.length === 0 below) can
    // reach this same commit logic without diffing/animating a step that
    // doesn't exist.
    const commitFinalState = () => {
      if (hasCombo) setComboKey(`combo-${moveId}`);
      setGameState(finalState);
      // Life-spend timing lives here now, not in App.tsx's generic state-
      // transition check (see appPersistence.ts's now-removed
      // shouldSpendLifeOnLoss): a fresh moves-exhausted pause only costs a
      // life immediately if no rescue is left to offer (shouldOfferContinue
      // false — see pauseActions.ts). When a rescue IS still available,
      // ContinueOffer renders instead of PausedOverlay below and the life
      // is spent only if the player explicitly declines it (see
      // handleContinueDeclinePlayAgain/handleContinueDeclineExit) — never
      // here, and never twice for the same pause.
      if (
        finalState.status === 'paused_awaiting_input' &&
        !shouldOfferContinue(finalState.pauseReason, bonusGrantsUsed)
      ) {
        onLifeLost();
      }
      // The chain_reaction tutorial's trigger (unlike the three per-piece
      // ones) isn't a board scan — the specials that fired are already
      // cleared by the time the chain settles, so there's no piece left on
      // the board to find. It's a plain boolean carried straight from this
      // move's applyMove result (see gameState.ts's ApplyMoveResult.
      // multiSpecialFired), checked here, on the same settled chain the
      // combo ack above fires on. Skipped once the level has ended, same as
      // the per-piece post-move effect below, so it never pops over the
      // Won/Paused overlay. Setting specialTutorial HERE, synchronously
      // alongside setGameState, gives this natural priority over that
      // effect's own board-scan candidate: React batches both updates from
      // this same tick, so by the time the effect runs (after render) it
      // sees specialTutorial already set and defers to next move — the
      // existing "two tutorials never stack" guarantee, with no new
      // priority logic needed.
      if (
        finalState.status === 'in_progress' &&
        shouldShowChainReactionTutorial(multiSpecialFired, [
          ...seenTutorials,
          ...dismissedSpecialTutorialsRef.current,
        ])
      ) {
        setSpecialTutorial({ id: CHAIN_REACTION_TUTORIAL_ID, piece: null });
      }
      setDisplayBoard(null);
      animatingRef.current = false;
      // A won/paused move commits its terminal status right here, but this
      // final pass's clears are only just *starting* to animate. Hold the
      // overlay one more beat so the player watches this last pass resolve
      // before it appears — the overlay is driven by animation completion,
      // not by the data landing. Non-terminal moves never schedule this, so
      // the flag simply stays false and gates nothing (status is in_progress).
      if (finalState.status === 'won' || finalState.status === 'paused_awaiting_input') {
        stepTimersRef.current.push(
          setTimeout(() => setTerminalOverlayReady(true), terminalOverlayHold + finalPassChainHoldMs)
        );
      }
      stepTimersRef.current.push(
        setTimeout(() => {
          setSwapDurationIds(new Set());
          setSpawnedIds(new Set());
        }, transitionWindowMs)
      );
    };

    // A real, committed move that cleared nothing at all this pass —
    // reachable only via a dropdown (escort) swap that neither forms a match
    // nor lands the piece at its column's bottom (engine/gameState.ts's
    // applyMove dropdown branch is the one path that can commit with zero
    // cascade passes — every other committed move guarantees at least one,
    // since an ordinary swap that clears nothing is rejected as illegal
    // before ever reaching here). Caught live: steps[0] is undefined in this
    // case, and diffBoards(previous, undefined) threw. Nothing to
    // diff/animate — skip straight to the commit, matching a plain
    // relocation with no visual effect beyond the two tiles swapping (the
    // Tile components' own swap-position animation already handles that
    // part, driven by the board data itself, not this step pipeline).
    if (steps.length === 0) {
      commitFinalState();
      return;
    }

    const runStep = (i: number) => {
      const next = steps[i];
      const diff = diffBoards(previous, next);

      // Which cleared tiles belong to a striped piece's line sweep, a color
      // bomb's radial ripple, or the supercombo's convert-then-sweep-together
      // beats, and how long each should wait — all derived from this pass's
      // diff alone, so this stays presentation-only (see
      // specialEffectAnimation.ts's buildPassAnimation). effectDescriptor only
      // ever applies to the first pass (i === 0) — every swap-triggered effect
      // activates on the swap itself; later passes are always ordinary
      // cascade refills.
      const passAnimation = buildPassAnimation(
        diff.cleared,
        i,
        effectDescriptor,
        {
          perTileStaggerMs: SWEEP_TILE_STAGGER_MS,
          radialWaveMs: COLOR_BOMB_WAVE_MS,
          supercomboConvertMs: SUPERCOMBO_CONVERT_MS,
          chainLinkStaggerMs: CHAIN_LINK_STAGGER_MS,
        },
        chainWaveByPieceId
      );

      // Sound/haptic cue for this pass, fired in the same tick the visual
      // pop begins (not deferred to the terminal-overlay timeout below,
      // which is specifically about the overlay card not popping over
      // still-animating tiles — a win jingle should land with the winning
      // clear itself). See components/soundEffects.ts's triggerPassEffects.
      const isFinalPass = i + 1 === steps.length;
      const finalOutcome = isFinalPass
        ? finalState.status === 'won' || finalState.status === 'paused_awaiting_input'
          ? finalState.status
          : undefined
        : undefined;
      triggerPassEffects(i, isFinalPass, finalOutcome, {
        soundEnabled,
        hapticsEnabled,
        soundService,
        hapticsService,
      });

      // Only the first pass carries the just-tapped pair, which uses the
      // snappier swap duration; every later pass is a passive fall.
      setSwapDurationIds(i === 0 ? tappedIds : new Set());
      setSpawnedIds(new Set(diff.spawned.map((s) => s.piece.id)));
      // Append (don't replace): a pass's exit tiles keep animating out while
      // the next pass's clears begin, giving the layered, sequential read.
      // Each ExitingTile removes itself on completion (see removeExiting).
      setExiting((current) => [
        ...current,
        ...diff.cleared.map(({ piece, from }) =>
          buildExitingEntry(
            piece,
            from,
            moveId,
            passAnimation.sweepDelays.get(piece.id),
            passAnimation.radialDelays.get(piece.id),
            passAnimation.convertedFlashIds.has(piece.id)
          )
        ),
      ]);

      previous = next;

      // A pass whose chain staged its clears out by chainHoldMs needs the
      // next beat (or, on the final pass, the terminal overlay) pushed out by
      // the same amount, so a late link is never cut off mid-fire. 0 for a
      // chainless pass — the schedule is then exactly the pre-staging one.
      if (i + 1 < steps.length) {
        setDisplayBoard(next);
        stepTimersRef.current.push(
          setTimeout(() => runStep(i + 1), cascadeStepIntervalMs + passAnimation.chainHoldMs)
        );
      } else {
        finalPassChainHoldMs = passAnimation.chainHoldMs;
        commitFinalState();
      }
    };

    runStep(0);
  }

  async function handleGrant(amount: number) {
    // Synchronous re-entrancy guard — see grantInFlightRef's own comment.
    // Without this, a rapid double-tap could fire two concurrent
    // adService.requestRewardedAd() calls before either the real ad SDK
    // responds or the disabled prop below ever gets a chance to render.
    if (grantInFlightRef.current) return;
    grantInFlightRef.current = true;
    setGrantInFlight(true);
    try {
      // Watch the rewarded ad first — services/adService.ts resolves to
      // whichever real provider (or, today, stub) this platform uses, and the
      // grant only proceeds if it resolves true (reward earned). A dismissed-
      // early ad (false) leaves ContinueOffer exactly as it was: no grant,
      // no cap spent, no life spent.
      const completed = await adService.requestRewardedAd('moves');
      if (!completed) return;
      // Count the grant before applying it. ContinueOffer only ever renders
      // while canGrantBonusMoves is true, but incrementing here (not relying on
      // the screen being hidden) keeps the cap honest even if it's re-entered
      // before this render settles.
      setBonusGrantsUsed((used) => nextAttemptUseCount(used, 'use'));
      setGameState((current) => grantBonusMoves(current, amount));
    } finally {
      grantInFlightRef.current = false;
      setGrantInFlight(false);
    }
  }

  // The hint button's own tap handler (see the hintPair/hintUsesUsed
  // declarations above). Guarded by both canAcceptMove (no point hinting a
  // move that can't be made right now — mirrors every other input path's
  // gate) and canUseHint (the button itself only renders while this is true,
  // but the check is repeated here so a stray tap during the render gap can't
  // sneak past the cap). Calls the exact same findAnyLegalMove the old
  // automatic timer used — no new detection logic, only a new trigger.
  function handleRequestHint() {
    if (!canAcceptMove() || !canUseHint(hintUsesUsed)) return;
    setHintUsesUsed((used) => nextAttemptUseCount(used, 'use'));
    setHintPair(findAnyLegalMove(gameState.board));
  }

  // The free, always-available "fresh board" button — distinct from the
  // removed purchasable power-up tray (nothing to buy here) and from the
  // hint above (this doesn't reveal a move, it just rearranges the board).
  // Reuses engine/gameState.ts's requestManualShuffle, which itself reuses
  // the exact shuffle() the stuck-board rescue already trusts, so "the
  // board is always playable after a shuffle" stays one guarantee. Gated
  // by canAcceptMove for the same reason the hint is — no point reshuffling
  // mid-cascade or while paused — but uncapped otherwise: a reshuffle only
  // permutes the existing piece multiset, so repeated taps can't manufacture
  // any advantage a single tap couldn't, and this player's calm/no-pressure
  // design brief (CLAUDE.md) argues against inventing a use-limit nobody
  // asked for. Clears any hint currently showing — a hinted pair is a
  // position pair on the pre-shuffle board, meaningless after one.
  function handleRequestShuffle() {
    if (!canAcceptMove()) return;
    setHintPair(null);
    setGameState((current) => requestManualShuffle(current));
  }

  // ContinueOffer's two decline paths — restarting or leaving instead of
  // accepting the rescue. Both spend the life this attempt owes before
  // running the underlying action (see the runStep comment above on why
  // life-spend can no longer happen automatically once a rescue is on offer).
  // handlePlayAgain/onExit themselves stay generic — WonOverlay calls the
  // same handlePlayAgain on a win, where no life should ever be spent — so
  // the spend lives in these two thin wrappers, not inside those functions.
  function handleContinueDeclinePlayAgain() {
    // Pass the freshly-spent count through explicitly rather than letting
    // handlePlayAgain fall back to the `lives` prop below — that prop hasn't
    // re-rendered with this spend yet (onLifeLost and this call happen in the
    // same tick), so reading it here would bake the pre-spend count into the
    // new attempt's GameState.lives display snapshot.
    const livesAfterSpend = onLifeLost();
    handlePlayAgain(livesAfterSpend);
  }

  function handleContinueDeclineExit() {
    onLifeLost();
    onExit();
  }

  function handleDismissOnboardingTutorial() {
    setShowOnboardingTutorial(false);
    setActiveTutorialId(null);
    onTutorialSeen(HOW_TO_PLAY_TUTORIAL_ID);
  }

  function handleDismissBoardShapeTutorial() {
    setShowBoardShapeTutorial(false);
    setActiveTutorialId(null);
    onTutorialSeen(BOARD_SHAPE_TUTORIAL_ID);
  }

  function handleDismissBlockerTutorial() {
    setShowBlockerTutorial(false);
    setActiveTutorialId(null);
    onTutorialSeen(BLOCKER_TUTORIAL_ID);
  }

  function handleDismissSealedJarTutorial() {
    setSealedJarTutorial(null);
    setActiveTutorialId(null);
    onTutorialSeen(SPECIAL_ONLY_BLOCKER_TUTORIAL_ID);
  }

  function handleDismissSpecialTutorial() {
    if (specialTutorial) {
      // Record it locally first (the post-move effect reads this ref), then
      // persist through the same App-level path the blocker tutorial uses.
      dismissedSpecialTutorialsRef.current.add(specialTutorial.id);
      onTutorialSeen(specialTutorial.id);
    }
    setSpecialTutorial(null);
    setActiveTutorialId(null);
  }

  function removeExiting(key: string) {
    setExiting((current) => current.filter((entry) => entry.key !== key));
  }

  // livesOverride is only ever passed by handleContinueDeclinePlayAgain,
  // for the exact same-tick-stale-prop reason documented there — every other
  // caller (the secondary "Play Again" link, WonOverlay's onPlayAgain) omits
  // it and this falls back to the ordinary `lives` prop, unchanged.
  //
  // A real bug (confirmed live, see docs/verification/play-again-event-arg/)
  // proved `livesOverride ?? lives` isn't a safe guard on its own: Pressable
  // always calls onPress(event), so a caller that ever wires this function
  // in unwrapped (onPlayAgain={handlePlayAgain}, as PausedOverlay/WonOverlay
  // both once did) hands the click event itself as livesOverride — truthy,
  // so `??` never falls back to `lives`. canStartLevel(eventObject) then
  // reads as `object > 0`, always false, wrongly routing to OutOfLives
  // regardless of the real lives count. Both call sites are now wrapped
  // (() => handlePlayAgain()) so this can't happen today, but this explicit
  // `typeof` check is the durable guard: it only ever trusts a real number,
  // so a future caller wired the same unwrapped way falls back to `lives`
  // instead of silently misreading an event object as a lives count.
  function handlePlayAgain(livesOverride?: number) {
    const currentLives = typeof livesOverride === 'number' ? livesOverride : lives;
    if (!canStartLevel(currentLives)) {
      onOutOfLives();
      return;
    }
    const seed = nextSeedRef.current;
    nextSeedRef.current += 1;
    // Cancel any cascade animation still in flight (from the attempt being
    // replayed) so its queued steps can't commit the old state or exit tiles
    // over the fresh board.
    stepTimersRef.current.forEach((timer) => clearTimeout(timer));
    stepTimersRef.current = [];
    animatingRef.current = false;
    // Seeds the fresh attempt with the current lives count, not
    // `levelConfig.lives` — the level's original mount-time snapshot could
    // be stale if this restart follows a loss (see the `lives` prop's doc
    // comment above).
    setGameState(createGameState({ ...levelConfig, seed, lives: currentLives }));
    setDisplayBoard(null);
    setTerminalOverlayReady(false);
    setSelected(null);
    setDragTarget(null);
    setExiting([]);
    setSpawnedIds(new Set());
    setSwapDurationIds(new Set());
    setSnapBack(null);
    setComboKey(null);
    // A restart is a brand-new attempt, so both per-attempt caps start over —
    // same reasoning as a fresh mount, just without the remount (Play Again
    // keeps this Board instance and rebuilds its state in place).
    setBonusGrantsUsed((used) => nextAttemptUseCount(used, 'restart'));
    setHintUsesUsed((used) => nextAttemptUseCount(used, 'restart'));
  }

  return (
    <View style={[styles.container, { backgroundColor: skinConfig.palette.background[0] }]}>
      {gameState.status === 'in_progress' && (
        // Persistent exit, not just a paused-state option — a small corner
        // button rather than a fourth HUD panel, so it never competes with
        // Target/Moves/Lives for width. Immediate, no confirmation dialog,
        // matching this app's calm/low-friction tone everywhere else. The
        // hint button lives in this same row for the same reason — flex-end
        // keeps both anchored together at the top-right regardless of
        // whether the hint button is currently rendered, so the exit button
        // never shifts position once the hint cap is reached and it drops
        // away (see canUseHint below).
        <View style={styles.topBar}>
          <Pressable
            onPress={handleRequestShuffle}
            disabled={!canAcceptMove()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[
              styles.hintButton,
              {
                borderColor: skinConfig.palette.accent,
                backgroundColor: skinConfig.palette.panel,
                opacity: canAcceptMove() ? 1 : 0.5,
              },
            ]}
          >
            <Text style={[styles.hintButtonLabel, { color: skinConfig.palette.accent }]}>🔀 Shuffle</Text>
          </Pressable>
          {canUseHint(hintUsesUsed) && (
            <Pressable
              onPress={handleRequestHint}
              disabled={!canAcceptMove()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[
                styles.hintButton,
                {
                  borderColor: skinConfig.palette.accent,
                  backgroundColor: skinConfig.palette.panel,
                  opacity: canAcceptMove() ? 1 : 0.5,
                },
              ]}
            >
              <Text style={[styles.hintButtonLabel, { color: skinConfig.palette.accent }]}>💡 Hint</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onExit}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.exitButton, { borderColor: skinConfig.palette.accent, backgroundColor: skinConfig.palette.panel }]}
          >
            {/* A symbolic icon glyph, not prose content — scaling it with system
                text size would just distort the circular button, so it opts out. */}
            <Text style={[styles.exitLabel, { color: skinConfig.palette.accent }]} allowFontScaling={false}>
              ✕
            </Text>
          </Pressable>
        </View>
      )}
      <Hud
        objectives={gameState.objectives}
        movesRemaining={gameState.movesRemaining}
        lives={gameState.lives}
        config={skinConfig}
        spriteAssets={spriteAssets}
        levelLabel={resolveLevelDisplayName(levelConfig.displayName, levelIndex)}
      />
      <View
        style={styles.boardArea}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setBoardArea((current) =>
            current && current.width === width && current.height === height
              ? current
              : { width, height }
          );
        }}
      >
        {tileSize > 0 && (
          <View style={[styles.board, { width: boardWidth, height: rows * tileSize }]}>
            {renderBoard.flatMap((rowPieces, r) =>
              rowPieces.map((piece, c) => {
                // A void is a hole in the board's shape — render nothing, so the
                // board background shows through as the cutout. Every tile is
                // absolutely positioned by row/col, so skipping one just leaves
                // an empty cell; no layout shifts. A void has no tap/drag
                // handlers either (there's no Tile), and the engine rejects any
                // swap that would target one (see gameState.ts's applyMove).
                if (piece.type === 'void') return null;
                let displayRow = r;
                let displayCol = c;
                if (snapBack) {
                  if (r === snapBack.a.row && c === snapBack.a.col) {
                    displayRow = snapBack.b.row;
                    displayCol = snapBack.b.col;
                  } else if (r === snapBack.b.row && c === snapBack.b.col) {
                    displayRow = snapBack.a.row;
                    displayCol = snapBack.a.col;
                  }
                }
                const duration =
                  snapBack || swapDurationIds.has(piece.id) ? swapDurationMs : cascadeDurationMs;
                const isSpawn = spawnedIds.has(piece.id);

                return (
                  <Tile
                    key={piece.id}
                    pieceId={piece.id}
                    row={displayRow}
                    col={displayCol}
                    tileSize={tileSize}
                    sprite={resolveSpriteAsset(getSpriteForPiece(piece, skinConfig), spriteAssets)}
                    accentColor={skinConfig.palette.accent}
                    panelColor={skinConfig.palette.panel}
                    selected={!!selected && selected.row === r && selected.col === c}
                    durationMs={duration}
                    enterFromRow={isSpawn ? r - 2 : undefined}
                    // Only a striped piece carries a direction; every other
                    // piece passes undefined, so Tile renders no badge. This
                    // is the one place the row/column sweep a striped piece
                    // will perform is made visible before the player commits.
                    direction={piece.type === 'striped' ? piece.direction : undefined}
                    // Set on the ordinary cell a denial zone is about to spread
                    // into, for the one move before the spread (engine sets it in
                    // stepDenialZone). Drives the calm crack/dimming warning so a
                    // spread is never silent. Undefined on levels without the
                    // mechanic and on every non-warned tile.
                    spreadWarning={piece.spreadWarning}
                    // Only an area bomb carries the ambient powder wisp; every
                    // other piece passes false so no wisp renders. Same
                    // per-type-from-engine pattern as `direction` above — the
                    // wisp is presentation only, the engine never sees it.
                    powderWisp={piece.type === 'area_bomb'}
                    // True on exactly the two cells the calm stuck-player
                    // hint picked (see hintPair above), or on neither tile
                    // while no hint is showing.
                    hint={
                      !!hintPair &&
                      ((hintPair.a.row === r && hintPair.a.col === c) ||
                        (hintPair.b.row === r && hintPair.b.col === c))
                    }
                    // Only present (and only ever >0) for a clearance-layers
                    // cell that still has a layer left — see
                    // engine/gameState.ts's GameState.layerCells. A cell with
                    // no entry, or one already decremented to 0, passes
                    // undefined so Tile renders no wash.
                    layersRemaining={gameState.layerCells[`${r},${c}`] || undefined}
                    onPress={() => handleTilePress({ row: r, col: c })}
                    // Drag-to-swap, added alongside tap: a live drag from this
                    // tile highlights and (on release) swaps toward the
                    // neighbour it points at, reusing handleTilePress's exact
                    // applyMove path. Enabled on the same conditions
                    // canAcceptMove gates on that persist across a finger-down
                    // (in progress, no overlay, no snap-back, not mid-cascade),
                    // so a drag that can start is always one whose release will
                    // be accepted — which is what lets Tile treat "resolves to a
                    // neighbour" as "will re-render" when deciding whether to
                    // fold its own offset. A plain tap is unaffected either way.
                    dragEnabled={
                      gameState.status === 'in_progress' &&
                      !activeTutorialId &&
                      !snapBack &&
                      !displayBoard
                    }
                    dragTargeted={!!dragTarget && dragTarget.row === r && dragTarget.col === c}
                    onDragMove={(dx, dy) => handleDragMove({ row: r, col: c }, dx, dy)}
                    onDragEnd={(dx, dy) => handleDragEnd({ row: r, col: c }, dx, dy)}
                    // Board's grid bounds + the commit distance, so Tile's
                    // release handler can decide on the UI thread whether this
                    // drag will commit a swap (and therefore re-render) — the
                    // same geometry dragNeighbor uses on the JS thread.
                    rows={rows}
                    cols={cols}
                    dragSwapThresholdPx={tileSize * DRAG_SWAP_THRESHOLD_FRACTION}
                  />
                );
              })
            )}
            {exiting.map((entry) => (
              <ExitingTile
                key={entry.key}
                pieceId={entry.pieceId}
                row={entry.row}
                col={entry.col}
                tileSize={tileSize}
                sprite={resolveSpriteAsset(exitingTileSprite(entry, skinConfig), spriteAssets)}
                accentColor={skinConfig.palette.accent}
                panelColor={skinConfig.palette.panel}
                durationMs={matchDurationMs}
                isBlockerClear={entry.isBlockerClear}
                sweepDelayMs={entry.sweepDelayMs}
                // A detonating area bomb lands in diff.cleared carrying its
                // type, so its exit tile puffs powder outward as the 3×3 it
                // fired clears alongside it. Derived from the cleared piece's
                // type, the same way isBlockerClear is — no new engine data.
                isPowderBurst={entry.pieceType === 'area_bomb'}
                radialDelayMs={entry.radialDelayMs}
                convertedFlash={entry.convertedFlash}
                onExited={() => removeExiting(entry.key)}
              />
            ))}
            {comboKey && (
              <ComboStreakBanner
                key={comboKey}
                accentColor={skinConfig.palette.accent}
                panelColor={skinConfig.palette.panel}
                onDone={() => setComboKey(null)}
              />
            )}
          </View>
        )}
      </View>
      {/* Each of the four branches below renders only when it's the one
          active, throttle-cleared tutorial (see activeTutorialId above) —
          priority among simultaneously-eligible ones (onboarding > board
          shape > blocker > special-piece/spread/chain-reaction) is already
          baked into nextEligibleTutorialId's own priority chain, so at most
          one of these conditions is ever true at once with no extra nesting
          needed here. */}
      {activeTutorialId === HOW_TO_PLAY_TUTORIAL_ID && (
        <SpecialTutorialOverlay
          config={skinConfig}
          spriteAssets={spriteAssets}
          tutorialId={HOW_TO_PLAY_TUTORIAL_ID}
          piece={null}
          onDismiss={handleDismissOnboardingTutorial}
        />
      )}
      {activeTutorialId === BOARD_SHAPE_TUTORIAL_ID && (
        <SpecialTutorialOverlay
          config={skinConfig}
          spriteAssets={spriteAssets}
          tutorialId={BOARD_SHAPE_TUTORIAL_ID}
          piece={null}
          onDismiss={handleDismissBoardShapeTutorial}
        />
      )}
      {activeTutorialId === BLOCKER_TUTORIAL_ID && (
        <BlockerTutorialOverlay
          config={skinConfig}
          spriteAssets={spriteAssets}
          blockerMatchType={findBlockerMatchType(gameState.board)}
          onDismiss={handleDismissBlockerTutorial}
        />
      )}
      {sealedJarTutorial && activeTutorialId === SPECIAL_ONLY_BLOCKER_TUTORIAL_ID && (
        <SpecialTutorialOverlay
          config={skinConfig}
          spriteAssets={spriteAssets}
          tutorialId={SPECIAL_ONLY_BLOCKER_TUTORIAL_ID}
          piece={sealedJarTutorial.piece}
          onDismiss={handleDismissSealedJarTutorial}
        />
      )}
      {specialTutorial && activeTutorialId === specialTutorial.id && (
        <SpecialTutorialOverlay
          config={skinConfig}
          spriteAssets={spriteAssets}
          tutorialId={specialTutorial.id}
          piece={specialTutorial.piece}
          onDismiss={handleDismissSpecialTutorial}
        />
      )}
      {gameState.status === 'paused_awaiting_input' && terminalOverlayReady && (
        shouldOfferContinue(gameState.pauseReason, bonusGrantsUsed) ? (
          // The life this attempt owes hasn't been spent yet — see the
          // runStep comment above. Accepting keeps playing for free;
          // declining (either link below) spends it before proceeding.
          <ContinueOffer
            movesRemaining={gameState.movesRemaining}
            levelIndex={levelIndex}
            config={skinConfig}
            adAvailable={adService.isRewardedAdAvailable()}
            grantPending={grantInFlight}
            onContinue={handleGrant}
            onPlayAgain={handleContinueDeclinePlayAgain}
            onExit={handleContinueDeclineExit}
          />
        ) : (
          // No rescue left to offer — the life was already spent the moment
          // this pause committed (see runStep above), so this is the plain
          // terminal loss screen.
          <PausedOverlay
            reason={gameState.pauseReason}
            movesRemaining={gameState.movesRemaining}
            levelIndex={levelIndex}
            config={skinConfig}
            // Wrapped, not passed directly: PausedOverlay's Pressable calls
            // onPress(event), and handlePlayAgain's own livesOverride param
            // would otherwise receive that event object instead of being
            // left undefined (see handlePlayAgain's own comment on why that
            // silently broke canStartLevel's gate).
            onPlayAgain={() => handlePlayAgain()}
            onExit={onExit}
          />
        )
      )}
      {gameState.status === 'won' && terminalOverlayReady && (
        <WonOverlay
          objectives={gameState.objectives}
          levelIndex={levelIndex}
          movesRemaining={gameState.movesRemaining}
          movesLimit={levelConfig.movesLimit}
          config={skinConfig}
          spriteAssets={spriteAssets}
          // Wrapped for the same reason as PausedOverlay's onPlayAgain above.
          onPlayAgain={() => handlePlayAgain()}
          onNext={onNextLevel}
          onOpenDashboard={onOpenDashboard}
          unlockedRecipeCard={unlockedRecipeCard}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: BOARD_HORIZONTAL_PADDING,
    paddingTop: 12,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  exitButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  hintButton: {
    minHeight: 28,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  boardArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  board: {
    position: 'relative',
  },
});
