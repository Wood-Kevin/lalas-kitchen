// Must be the first import so gesture-handler installs its native handlers
// before anything renders (its setup requirement on both native and web).
import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Board } from './components/Board';
import { Home } from './components/Home';
import { LevelMap, LevelMapRow } from './components/LevelMap';
import { OutOfLives } from './components/OutOfLives';
import { RecipeCard, SkinConfig } from './components/skinConfig';
import { RecipeBook } from './components/RecipeBook';
import {
  GameState,
  GameStatus,
  LevelConfig,
  Position,
  SaveData,
  clearSave,
  loadSave,
  saveProgress,
} from './engine/gameState';
import {
  applyLivesRegen,
  backfillUnlockedRecipeCards,
  buildGeneratedLevelConfig,
  buildSaveData,
  canStartLevel,
  didLevelJustEnd,
  findRecipeCardForLevel,
  grantInstantLife,
  livesAfterLoss,
  markLevelCompleted,
  markTutorialSeen,
  recordLevelStars,
  resolveNextLevelIndex,
  resolveStartLevelIndex,
  resolveStartScreen,
  startingLives,
  unlockRecipeCard,
} from './appPersistence';
import {
  buildLevelSummary,
  resolveLevelMapIndices,
  resolveLevelStatus,
  resolveNextUnplayedLevel,
} from './components/levelProgress';
import skinConfigJson from './skins/lalas-kitchen/config.json';
import { spriteRegistry } from './skins/lalas-kitchen/spriteRegistry';
import { adService } from './services/defaultAdService';
import { computeStarRating, StarRating } from './components/wonActions';

const skinConfig = skinConfigJson as SkinConfig;

// The hand-built queue: a small, curated set with light progression (more
// moves and a higher target count each level) and a distinct target piece
// type per level, so advancing actually feels like a different level and
// not just a reshuffled board. Past the end of this queue, buildLevelConfig
// falls through to buildGeneratedLevelConfig (appPersistence.ts) instead of
// dead-ending — a real level-authoring pipeline for more curated content is
// still out of scope for now, but "out of curated levels" no longer means
// "out of game."
// The showcase non-rectangular level's shape: a bold plus on a 7x7 grid — the
// four 2x2 corner blocks are carved out as void cells, leaving a plus of 33
// playable cells. Hand-authored to prove board-shape variety end-to-end (see
// engine/DECISIONS.md's void-cell entry); generator-driven shapes are a
// deliberately separate later step (DEFERRED_COMPLEXITY.md).
const PLUS_SHOWCASE_VOIDS: Position[] = ([0, 1, 5, 6] as const).flatMap((row) =>
  ([0, 1, 5, 6] as const).map((col) => ({ row, col }))
);

// The showcase clearance-layers level's hidden layer placement — a scattered
// handful of cells (see engine/DECISIONS.md's clearance-layers entry), mostly
// 1 layer with two 2-layer cells so a player genuinely encounters both the
// "one clear and it's gone" and "needs a second pass" cases. Total 8 layers,
// which becomes the 'clearance' objective's targetCount automatically (see
// createGameState) — never hand-authored as a separate number.
const DUSTY_COUNTER_LAYERS: Array<{ position: Position; layers: number }> = [
  { position: { row: 1, col: 1 }, layers: 2 },
  { position: { row: 1, col: 3 }, layers: 1 },
  { position: { row: 3, col: 0 }, layers: 1 },
  { position: { row: 3, col: 4 }, layers: 1 },
  { position: { row: 5, col: 2 }, layers: 2 },
  { position: { row: 6, col: 1 }, layers: 1 },
];

const LEVEL_QUEUE: Array<Omit<LevelConfig, 'lives'>> = [
  {
    seed: 1,
    rows: 8,
    cols: 5,
    pieceTypeIds: skinConfig.pieceTypes.map((pieceType) => pieceType.id),
    movesLimit: 20,
    objectives: [{ targetMatchType: skinConfig.pieceTypes[0].id, targetCount: 15 }],
    displayName: 'Tomato Toss',
  },
  {
    seed: 101,
    rows: 8,
    cols: 5,
    pieceTypeIds: skinConfig.pieceTypes.map((pieceType) => pieceType.id),
    movesLimit: 22,
    objectives: [{ targetMatchType: skinConfig.pieceTypes[1].id, targetCount: 18 }],
    displayName: 'Lemon Squeeze',
  },
  {
    seed: 201,
    rows: 8,
    cols: 5,
    pieceTypeIds: skinConfig.pieceTypes.map((pieceType) => pieceType.id),
    movesLimit: 24,
    objectives: [{ targetMatchType: skinConfig.pieceTypes[2].id, targetCount: 20 }],
    displayName: 'Herb Garden',
  },
  {
    // First non-rectangular level: a plus-shaped 7x7 board (the corners are
    // carved out as voids). A calm, generous showcase — the shape is the star,
    // not the difficulty. Fewer piece types than a full board so the shorter
    // arms still offer matches. See PLUS_SHOWCASE_VOIDS above.
    seed: 314,
    rows: 7,
    cols: 7,
    voidCells: PLUS_SHOWCASE_VOIDS,
    pieceTypeIds: skinConfig.pieceTypes.slice(0, 5).map((pieceType) => pieceType.id),
    movesLimit: 25,
    objectives: [{ targetMatchType: skinConfig.pieceTypes[3].id, targetCount: 18 }],
    displayName: 'Cutting Board',
  },
  {
    // First 'score'-type objective level (see engine/gameState.ts's
    // ObjectiveType and the scoring-system entry in engine/DECISIONS.md):
    // reach a target cumulative score, rather than collect a target count of
    // one piece type. 1000 is a judgment call, not derived from a formula —
    // an ordinary 3-match alone nets 30, so it's comfortably reachable across
    // 24 moves of ordinary play, with cascades/specials pulling it in faster,
    // without being trivially won in the first few swaps.
    seed: 401,
    rows: 8,
    cols: 5,
    pieceTypeIds: skinConfig.pieceTypes.map((pieceType) => pieceType.id),
    movesLimit: 24,
    objectives: [{ type: 'score', targetCount: 1000 }],
    displayName: 'Score Rush',
  },
  {
    // First 'clearance'-type objective level (see engine/gameState.ts's
    // ObjectiveType and the clearance-layers entry in engine/DECISIONS.md):
    // win by clearing every hidden per-cell layer, rather than collecting a
    // piece-type count or reaching a score threshold. Hand-built content only
    // this session — generator integration is a separate, later step (see
    // DEFERRED_COMPLEXITY.md).
    seed: 501,
    rows: 8,
    cols: 5,
    pieceTypeIds: skinConfig.pieceTypes.map((pieceType) => pieceType.id),
    movesLimit: 24,
    objectives: [{ type: 'clearance' }],
    layerCells: DUSTY_COUNTER_LAYERS,
    displayName: 'Dusty Counter',
  },
];

function buildLevelConfig(levelIndex: number, lives: number): LevelConfig {
  const base =
    levelIndex <= LEVEL_QUEUE.length
      ? LEVEL_QUEUE[levelIndex - 1]
      : buildGeneratedLevelConfig(
          levelIndex,
          LEVEL_QUEUE.length,
          skinConfig.pieceTypes.map((pieceType) => pieceType.id),
          LEVEL_QUEUE[0].rows,
          LEVEL_QUEUE[0].cols,
          skinConfig.blockers
        );
  return { ...base, lives };
}

// Sound defaults OFF per CLAUDE.md's Design Constraints — real user
// research found the target player finds game sound distracting. Haptics
// defaults off too, for the same calm-by-default reasoning, even though no
// equivalent documented complaint exists specifically about haptics — see
// engine/DECISIONS.md's sound/haptics stub-layer entry. Named constants
// (not inlined) so either default is a one-line change later.
const SOUND_ENABLED_DEFAULT = false;
const HAPTICS_ENABLED_DEFAULT = false;

type Screen = 'loading' | 'home' | 'game' | 'levels' | 'outOfLives' | 'recipeBook';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  // 1-based index into LEVEL_QUEUE for whichever level is currently active
  // (or was last active, while screen is 'home'/'levels').
  const [levelIndex, setLevelIndex] = useState(1);
  const [levelConfig, setLevelConfig] = useState<LevelConfig | null>(null);
  const [completedLevels, setCompletedLevels] = useState<number[]>([]);
  // Best-ever star rating per completed level (1-based level number -> 1-3)
  // — see engine/gameState.ts's SaveData.levelStars comment and
  // appPersistence.ts's recordLevelStars. Feeds the level map's per-node
  // star row; WonOverlay's own in-the-moment star display is unaffected,
  // it already derives fresh from that attempt's movesRemaining/movesLimit.
  const [levelStars, setLevelStars] = useState<Record<number, StarRating>>({});
  // IDs of one-time tutorial popups already dismissed (e.g. 'blocker') —
  // see engine/gameState.ts's SaveData.seenTutorials comment on why this
  // is a plain string list rather than a bespoke boolean per tutorial.
  const [seenTutorials, setSeenTutorials] = useState<string[]>([]);
  // IDs of recipe cards (skinConfig.recipeCards) unlocked so far — see
  // engine/gameState.ts's SaveData.unlockedRecipeCards comment. Feeds both
  // Home's recipe-book teaser card and the RecipeBook collection screen.
  const [unlockedRecipeCards, setUnlockedRecipeCards] = useState<string[]>([]);
  // Whether sound effects / haptic feedback should play — see
  // engine/gameState.ts's SaveData.soundEnabled/hapticsEnabled comments.
  // Real, re-rendering state (not ref-only) since Home's toggle rows read
  // these directly to draw their on/off state.
  const [soundEnabled, setSoundEnabled] = useState<boolean>(SOUND_ENABLED_DEFAULT);
  const [hapticsEnabled, setHapticsEnabled] = useState<boolean>(HAPTICS_ENABLED_DEFAULT);
  // The card the most recent win transition newly unlocked, or null for an
  // ordinary win — recomputed at every won transition in
  // handleBoardStateChange below, never left stale across levels (see that
  // computation for why no separate reset is needed elsewhere). Threaded
  // through Board -> WonOverlay to decide whether to show the reveal.
  const [revealedRecipeCard, setRevealedRecipeCard] = useState<RecipeCard | null>(null);

  // Mirrors Board's current GameState so the AppState background handler
  // (below) has something to persist even mid-level, without lifting the
  // whole board into this component. A ref, not state, since nothing here
  // needs to re-render when it changes.
  const latestStateRef = useRef<GameState | null>(null);
  const prevStatusRef = useRef<GameStatus | null>(null);
  // Mirror levelIndex/completedLevels into refs too, so persistLatestState
  // (called from the AppState background listener, which is subscribed
  // once on mount) always reads the current value instead of whatever was
  // current when that listener closure was created.
  const levelIndexRef = useRef(levelIndex);
  const completedLevelsRef = useRef(completedLevels);
  const levelStarsRef = useRef(levelStars);
  const seenTutorialsRef = useRef(seenTutorials);
  const unlockedRecipeCardsRef = useRef(unlockedRecipeCards);
  const soundEnabledRef = useRef(soundEnabled);
  const hapticsEnabledRef = useRef(hapticsEnabled);
  // The account's persisted lives count — the single source of truth for
  // every level-start gate (Home's "Start cooking", an All Levels row, and
  // Board's internal "Play again") and the value that actually decrements
  // on a loss. Deliberately *not* read from GameState.lives (a per-level
  // snapshot that never changes during play — see engine/gameState.ts's
  // PauseReason comment) or from a ref alone: this needs to be real state
  // so Board re-renders with the fresh value after a decrement, since it's
  // passed down as a prop for Board's own internal restart to read.
  const [lives, setLives] = useState<number>(skinConfig.lives.max);
  // Mirrors `lives` for the same reason levelIndexRef/completedLevelsRef
  // exist below — callbacks below are stable (empty dep arrays) and must
  // read the current value, not whatever was current when the closure was
  // created. Kept in sync manually at every setLives call, matching this
  // file's existing convention rather than introducing a useEffect.
  const livesRef = useRef(skinConfig.lives.max);
  // The regen anchor backing applyLivesRegen — ref-only since nothing ever
  // renders off this value directly, only off `lives` itself.
  const livesLastRegenAtRef = useRef(Date.now());

  // Initialize all session state from a loaded save (or `null` for a fresh
  // install). Factored out of the mount effect so the dev reset can reuse the
  // EXACT first-run path by calling it with null — no second copy of the
  // "what does a fresh game look like" defaults that could drift from this one.
  const applyLoadedSave = useCallback((save: SaveData | null) => {
    const startLevelIndex = resolveStartLevelIndex(save);
    const initialCompleted = save?.completedLevels ?? [];
    const initialLevelStars = save?.levelStars ?? {};
    const initialSeenTutorials = save?.seenTutorials ?? [];
    // Reconcile the persisted card list against completed-level history on
    // every load: progress made before the recipe card system existed left
    // milestone levels in completedLevels with no matching unlocked card,
    // and this is the one-time catch-up that recovers them (idempotent, so
    // it's a no-op once caught up — see appPersistence.ts's
    // backfillUnlockedRecipeCards). The live win flow below still owns
    // *new* unlocks; this only heals old saves.
    const initialUnlockedRecipeCards = backfillUnlockedRecipeCards(
      skinConfig.recipeCards,
      initialCompleted,
      save?.unlockedRecipeCards ?? []
    );
    const initialSoundEnabled = save?.soundEnabled ?? SOUND_ENABLED_DEFAULT;
    const initialHapticsEnabled = save?.hapticsEnabled ?? HAPTICS_ENABLED_DEFAULT;

    // Regen is computed once here from whatever the save last recorded —
    // a session could have been closed for hours or days, and this is
    // the first real opportunity to credit any lives that regenerated
    // while the app wasn't running. `save.livesLastRegenAt` is only
    // absent on a genuinely fresh install (no save yet), where "now" is
    // the only sensible anchor to start counting from.
    const now = Date.now();
    const regenerated = applyLivesRegen(
      startingLives(save, skinConfig.lives.max),
      save?.livesLastRegenAt ?? now,
      skinConfig.lives.max,
      skinConfig.lives.regenMinutes,
      now
    );

    levelIndexRef.current = startLevelIndex;
    completedLevelsRef.current = initialCompleted;
    levelStarsRef.current = initialLevelStars;
    seenTutorialsRef.current = initialSeenTutorials;
    unlockedRecipeCardsRef.current = initialUnlockedRecipeCards;
    soundEnabledRef.current = initialSoundEnabled;
    hapticsEnabledRef.current = initialHapticsEnabled;
    livesRef.current = regenerated.lives;
    livesLastRegenAtRef.current = regenerated.livesLastRegenAt;
    setLives(regenerated.lives);
    setLevelIndex(startLevelIndex);
    setCompletedLevels(initialCompleted);
    setLevelStars(initialLevelStars);
    setSeenTutorials(initialSeenTutorials);
    setUnlockedRecipeCards(initialUnlockedRecipeCards);
    setSoundEnabled(initialSoundEnabled);
    setHapticsEnabled(initialHapticsEnabled);
    setLevelConfig(null);
    // levelConfig stays null here — every session now opens on Home (see
    // resolveStartScreen), not straight into a board, so there's nothing
    // to preload until the player actually taps into a level.
    setScreen(resolveStartScreen());
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSave(skinConfig.skinId).then((save) => {
      if (cancelled) return;
      applyLoadedSave(save);
    });
    return () => {
      cancelled = true;
    };
  }, [applyLoadedSave]);

  // Dev-only "wipe everything and start fresh" — wired in below ONLY when
  // __DEV__ is true (see the Home onDevReset prop), so it is compiled out of
  // any release build and a real player can never reach it. It exists so the
  // save can be reset from inside the app during testing instead of digging
  // through the OS's app-storage settings. clearSave deletes the persisted
  // blob; applyLoadedSave(null) then rebuilds session state via the same path a
  // genuine fresh install takes, landing back on Home.
  const handleDevReset = useCallback(() => {
    const doReset = () => {
      clearSave(skinConfig.skinId)
        .then(() => applyLoadedSave(null))
        .catch((err) => console.error('[dev] reset failed to clear save', err));
    };
    // Guard against a fat-fingered long-press nuking progress mid-test.
    // react-native-web's Alert can't render a two-button confirm, so use the
    // browser's native confirm on web and RN's Alert on device.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('[DEV] Reset all saved progress?')) {
        doReset();
      }
    } else {
      Alert.alert('[DEV] Reset all progress?', 'This wipes the save and starts fresh.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: doReset },
      ]);
    }
  }, [applyLoadedSave]);

  const persistLatestState = useCallback(() => {
    const state = latestStateRef.current;
    if (!state) return;
    // Fire-and-forget: the in-memory storage backing this today writes
    // synchronously under its async signature (see gameState.ts), and a
    // real AsyncStorage swap later is exactly what AsyncStorageLike exists
    // to make a non-event — see DEFERRED_COMPLEXITY.md.
    //
    // `{ lives: livesRef.current }`, not the real `state` — buildSaveData's
    // `state` param only ever reads `.lives`, and the account's actual
    // persisted lives count lives in livesRef, not on GameState (see the
    // `lives` state's doc comment above). livesLastRegenAtRef is passed
    // explicitly too, so a save doesn't silently reset the regen clock to
    // "now" (see appPersistence.ts's buildSaveData comment).
    saveProgress(
      skinConfig.skinId,
      buildSaveData(
        skinConfig.skinId,
        levelIndexRef.current,
        completedLevelsRef.current,
        levelStarsRef.current,
        seenTutorialsRef.current,
        unlockedRecipeCardsRef.current,
        soundEnabledRef.current,
        hapticsEnabledRef.current,
        { lives: livesRef.current },
        livesLastRegenAtRef.current
      )
    );
  }, []);

  // Fired by Board.tsx exactly once per attempt, at the moment that
  // attempt's life is actually spent (see Board.tsx's onLifeLost prop and its
  // runStep/handleContinueDecline* comments for exactly when that is — no
  // longer derivable from a GameState transition alone, since a moves-out
  // pause might still have a rescue on offer via ContinueOffer). Replaces the
  // old shouldSpendLifeOnLoss check this callback used to run inline: that
  // fired on *every* moves-exhausted transition, which is what let a single
  // attempt lose more than one life if the player took a bonus-moves grant
  // and then ran out again (see engine/DECISIONS.md's continue-offer entry).
  //
  // Returns the fresh account lives count synchronously (not just via
  // setLives) because handleContinueDeclinePlayAgain calls this and then
  // Board's own handlePlayAgain in the very same tick, before this
  // component's `lives` prop has re-rendered into Board — reading the stale
  // prop there would bake the pre-loss count into the new attempt's
  // GameState.lives display snapshot. Returning the real value lets that
  // restart pass it through explicitly instead.
  const handleLifeLost = useCallback(() => {
    // Apply any regen owed first, then spend the loss — so a player who lost
    // a level, waited past a regen tick, and is only now triggering this
    // gets the most accurate possible final count rather than double
    // penalizing them for elapsed time.
    const now = Date.now();
    const regenerated = applyLivesRegen(
      livesRef.current,
      livesLastRegenAtRef.current,
      skinConfig.lives.max,
      skinConfig.lives.regenMinutes,
      now
    );
    const wasFull = regenerated.lives >= skinConfig.lives.max;
    const newLives = livesAfterLoss(regenerated.lives);
    livesRef.current = newLives;
    // The regen clock only starts once lives actually drop below max — a
    // loss landing while already below max shouldn't reset whatever progress
    // the existing timer already had toward its next tick (see
    // applyLivesRegen's own comment on this).
    livesLastRegenAtRef.current = wasFull ? now : regenerated.livesLastRegenAt;
    setLives(newLives);
    // Explicit immediate save, same reasoning as handleGrantLife's own —
    // persistLatestState only ever reads `.lives` from livesRef (see its own
    // comment), so this is safe to call right away rather than waiting for
    // whatever gameState transition happens to follow (a decline may not
    // produce one that reaches the justEnded branch below, e.g. exiting).
    persistLatestState();
    return newLives;
  }, [persistLatestState]);

  const handleBoardStateChange = useCallback(
    (state: GameState) => {
      latestStateRef.current = state;
      const prevStatus = prevStatusRef.current;
      const justEnded = didLevelJustEnd(prevStatus, state.status);
      prevStatusRef.current = state.status;
      if (justEnded) {
        if (state.status === 'won') {
          const updated = markLevelCompleted(completedLevelsRef.current, levelIndexRef.current);
          completedLevelsRef.current = updated;
          setCompletedLevels(updated);

          // Same star formula WonOverlay derives for its own in-the-moment
          // display (see wonActions.ts's computeStarRating) — movesLimit
          // isn't on GameState itself (see LevelConfig.movesLimit's own
          // comment), so it's re-derived here from the same buildLevelConfig
          // every other level-progress computation on this screen already
          // calls; `lives` only affects the returned config's own `.lives`
          // field, never movesLimit, so livesRef.current's exact value here
          // is inconsequential.
          const movesLimit = buildLevelConfig(levelIndexRef.current, livesRef.current).movesLimit;
          const stars = computeStarRating(state.movesRemaining, movesLimit);
          const updatedStars = recordLevelStars(levelStarsRef.current, levelIndexRef.current, stars);
          levelStarsRef.current = updatedStars;
          setLevelStars(updatedStars);

          // Recomputed fresh on every won transition (not just the first
          // time) so a replay of an already-unlocked milestone level, or a
          // win on a non-milestone level, correctly clears any reveal left
          // over from a previous win rather than showing it again — see
          // this state's own doc comment above for why no separate reset
          // elsewhere is needed.
          const card = findRecipeCardForLevel(skinConfig.recipeCards, levelIndexRef.current);
          const isNewUnlock = !!card && !unlockedRecipeCardsRef.current.includes(card.id);
          if (isNewUnlock && card) {
            const updatedCards = unlockRecipeCard(unlockedRecipeCardsRef.current, card.id);
            unlockedRecipeCardsRef.current = updatedCards;
            setUnlockedRecipeCards(updatedCards);
          }
          setRevealedRecipeCard(isNewUnlock ? card! : null);
        }
        // Life-spend used to happen right here (shouldSpendLifeOnLoss), keyed
        // purely off this transition — but a moves-exhausted pause might
        // still have a rescue on offer (see Board.tsx's ContinueOffer), so
        // that decision moved to Board.tsx, which calls handleLifeLost
        // directly and explicitly instead (see its own comment above).
        persistLatestState();
      }
    },
    [persistLatestState]
  );

  // WonOverlay's primary action, wired through Board — advances to the next
  // level, carrying over whatever lives are left (lives are a cross-level
  // resource, not a per-level one). Always has somewhere to go now: past
  // the hand-built queue, buildLevelConfig falls through to generated
  // levels, so this never needs to route to the dashboard instead (that
  // used to be the dead end — see DEFERRED_COMPLEXITY.md). Distinct from
  // Board's own "Play again", which stays entirely internal to Board.
  //
  // Deliberately *not* gated on canStartLevel, unlike every other
  // level-start entry point: reaching a win already required lives > 0 to
  // start this same level, and winning never spends a life — so this can
  // never legitimately fire at zero lives. Regen is still applied so the
  // next level starts with the freshest possible count.
  const handleNextLevel = useCallback(() => {
    const next = resolveNextLevelIndex(levelIndexRef.current);
    const regenerated = applyLivesRegen(
      livesRef.current,
      livesLastRegenAtRef.current,
      skinConfig.lives.max,
      skinConfig.lives.regenMinutes,
      Date.now()
    );
    livesRef.current = regenerated.lives;
    livesLastRegenAtRef.current = regenerated.livesLastRegenAt;
    setLives(regenerated.lives);
    levelIndexRef.current = next;
    setLevelIndex(next);
    setLevelConfig(buildLevelConfig(next, regenerated.lives));
    // A new level is starting in_progress — reset so the next won/paused
    // transition on it is correctly detected as a fresh level ending, not
    // read against the previous level's leftover 'won' status.
    prevStatusRef.current = null;
  }, []);

  // WonOverlay's secondary "Levels" action, and Home's "Browse all levels"
  // button — both land on the same All Levels screen. levelConfig is
  // deliberately left as-is (not cleared) so handlePlayLevel below always
  // has a valid fallback to carry lives from even if the player backs out
  // without picking a row.
  const handleOpenAllLevels = useCallback(() => {
    setScreen('levels');
  }, []);

  // Home's "Your recipe book" card — the collection view's one entry
  // point (see this session's brief). No gating: unlike level-start, there
  // is no lives cost or lock to check before just looking at a collection.
  const handleOpenRecipeBook = useCallback(() => {
    setScreen('recipeBook');
  }, []);

  const handleGoHome = useCallback(() => {
    setScreen('home');
  }, []);

  // Home's "Start cooking" button and All Levels' per-row action both call
  // this exact function (confirmed in this session's investigation — they
  // were never two separate code paths), which is what makes gating both
  // at once a one-function change. Jumps straight into any level, hand-built
  // or previously-completed generated — the same way handleNextLevel does.
  // This is the "way back into an actual board" the old dashboard was
  // missing (see DEFERRED_COMPLEXITY.md's now-resolved dead-end note).
  //
  // Regen is applied fresh here (not just at boot) since a player can sit
  // on Home or All Levels for a while — mid-session, not just at cold
  // start — before actually tapping into a level.
  const handlePlayLevel = useCallback((targetLevelIndex: number) => {
    const regenerated = applyLivesRegen(
      livesRef.current,
      livesLastRegenAtRef.current,
      skinConfig.lives.max,
      skinConfig.lives.regenMinutes,
      Date.now()
    );
    livesRef.current = regenerated.lives;
    livesLastRegenAtRef.current = regenerated.livesLastRegenAt;
    setLives(regenerated.lives);

    if (!canStartLevel(regenerated.lives)) {
      setScreen('outOfLives');
      return;
    }

    levelIndexRef.current = targetLevelIndex;
    setLevelIndex(targetLevelIndex);
    setLevelConfig(buildLevelConfig(targetLevelIndex, regenerated.lives));
    prevStatusRef.current = null;
    setScreen('game');
  }, []);

  // OutOfLives' "Watch a video to refill your lives" action — the
  // instant-grant mechanism this session's investigation confirmed didn't
  // exist yet for this context (see appPersistence.ts's grantInstantLife
  // comment on how this differs from the deleted mid-level
  // grantBonusMoves/grantBonusLife pair, and on why it's a full refill
  // rather than the genre-standard +1). Deliberately does not touch
  // livesLastRegenAtRef — the passive regen clock keeps counting down on
  // its own schedule regardless of this bonus, same reasoning as
  // grantInstantLife's own comment.
  //
  // Persists immediately, unlike every other lives change in this file —
  // persistLatestState (used everywhere else) reads latestStateRef, which
  // is only ever populated once a level has actually been played this
  // session, and OutOfLives can be reached (fresh boot, blocked at Home)
  // before that ref is ever set. Without an explicit save here, a granted
  // life would show correctly on screen and then silently vanish if the
  // player backgrounds the app before starting a level.
  const handleGrantLife = useCallback(async () => {
    // Watch the rewarded ad first — services/adService.ts resolves to
    // whichever real provider (or, today, stub) this platform uses. A
    // dismissed-early ad (false) leaves lives untouched, nothing saved.
    const completed = await adService.requestRewardedAd();
    if (!completed) return;
    const newLives = grantInstantLife(skinConfig.lives.max);
    livesRef.current = newLives;
    setLives(newLives);
    saveProgress(
      skinConfig.skinId,
      buildSaveData(
        skinConfig.skinId,
        levelIndexRef.current,
        completedLevelsRef.current,
        levelStarsRef.current,
        seenTutorialsRef.current,
        unlockedRecipeCardsRef.current,
        soundEnabledRef.current,
        hapticsEnabledRef.current,
        { lives: newLives },
        livesLastRegenAtRef.current
      )
    );
  }, []);

  // Board's blocker tutorial dismiss action — persists immediately for the
  // exact same reason handleGrantLife does above: a level in progress
  // doesn't "end" just because the tutorial was dismissed, so waiting for
  // persistLatestState's usual didLevelJustEnd/background triggers would
  // leave the dismissal unsaved if the player backgrounds the app mid-level.
  // Requirement was that this survive a real app close/reopen, not just
  // this session's in-memory state.
  const handleTutorialSeen = useCallback((id: string) => {
    const updated = markTutorialSeen(seenTutorialsRef.current, id);
    seenTutorialsRef.current = updated;
    setSeenTutorials(updated);
    saveProgress(
      skinConfig.skinId,
      buildSaveData(
        skinConfig.skinId,
        levelIndexRef.current,
        completedLevelsRef.current,
        levelStarsRef.current,
        updated,
        unlockedRecipeCardsRef.current,
        soundEnabledRef.current,
        hapticsEnabledRef.current,
        { lives: livesRef.current },
        livesLastRegenAtRef.current
      )
    );
  }, []);

  // Home's Sound/Haptics toggle rows — persists immediately, the same
  // shape as handleTutorialSeen above: a toggle flip must survive an app
  // close on its own, not wait for a level to end (persistLatestState's
  // usual didLevelJustEnd/background triggers).
  const handleToggleSound = useCallback((next: boolean) => {
    soundEnabledRef.current = next;
    setSoundEnabled(next);
    saveProgress(
      skinConfig.skinId,
      buildSaveData(
        skinConfig.skinId,
        levelIndexRef.current,
        completedLevelsRef.current,
        levelStarsRef.current,
        seenTutorialsRef.current,
        unlockedRecipeCardsRef.current,
        next,
        hapticsEnabledRef.current,
        { lives: livesRef.current },
        livesLastRegenAtRef.current
      )
    );
  }, []);

  const handleToggleHaptics = useCallback((next: boolean) => {
    hapticsEnabledRef.current = next;
    setHapticsEnabled(next);
    saveProgress(
      skinConfig.skinId,
      buildSaveData(
        skinConfig.skinId,
        levelIndexRef.current,
        completedLevelsRef.current,
        levelStarsRef.current,
        seenTutorialsRef.current,
        unlockedRecipeCardsRef.current,
        soundEnabledRef.current,
        next,
        { lives: livesRef.current },
        livesLastRegenAtRef.current
      )
    );
  }, []);

  useEffect(() => {
    // Expo's web target has no reliable "app is closing" hook — a browser
    // tab can be closed with no guarantee an async callback finishes (see
    // DEFERRED_COMPLEXITY.md). AppState's background/inactive transition is
    // the best available substitute: on native (iOS/Android) it fires
    // reliably when the app is backgrounded, which is the realistic
    // "closing" moment on mobile anyway; on web, react-native-web backs it
    // with the Page Visibility API, which fires before a tab actually
    // closes too, not just on tab-switch/minimize.
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        persistLatestState();
      }
    });
    return () => subscription.remove();
  }, [persistLatestState]);

  if (screen === 'loading' || (screen === 'game' && !levelConfig)) {
    // Brief load gate while the save is read — matches the skin background
    // rather than flashing white while this resolves.
    return <View style={{ flex: 1, backgroundColor: skinConfig.palette.background[0] }} />;
  }

  // Real derived state for Home/All Levels — computed fresh each render
  // (cheap: buildLevelConfig never runs the board generator itself, see
  // appPersistence.ts's buildGeneratedLevelConfig) rather than the
  // mockup's illustrative "11 of 24"/"Wooden Spoon" placeholder values.
  const nextLevelIndex = resolveNextUnplayedLevel(completedLevels);
  const nextLevelSummary = buildLevelSummary(buildLevelConfig(nextLevelIndex, lives), nextLevelIndex);
  // resolveLevelMapIndices (not the old resolveVisibleLevelIndices) is what
  // guarantees the current level — and a few genuinely reachable locked
  // levels past it — always appear on the map, even when nextLevelIndex is
  // an unplayed generated level past the hand-built queue (see that
  // function's own comment on why the old rule would have hidden it).
  const levelMapRows: LevelMapRow[] = resolveLevelMapIndices(LEVEL_QUEUE.length, completedLevels, nextLevelIndex).map(
    (index) => ({
      ...buildLevelSummary(buildLevelConfig(index, lives), index),
      status: resolveLevelStatus(index, completedLevels, nextLevelIndex),
      stars: levelStars[index],
    })
  );

  return (
    // GestureHandlerRootView must sit at the very top of the tree for the
    // drag-to-swap Pan gestures in Board's tiles to receive touches.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1 }}>
        {screen === 'home' ? (
          <Home
            config={skinConfig}
            spriteAssets={spriteRegistry}
            nextLevel={nextLevelSummary}
            unlockedRecipeCardCount={unlockedRecipeCards.length}
            totalRecipeCardCount={skinConfig.recipeCards.length}
            onStartNext={() => handlePlayLevel(nextLevelIndex)}
            onBrowseAllLevels={handleOpenAllLevels}
            onOpenRecipeBook={handleOpenRecipeBook}
            soundEnabled={soundEnabled}
            hapticsEnabled={hapticsEnabled}
            onToggleSound={handleToggleSound}
            onToggleHaptics={handleToggleHaptics}
            // Dev-only: passed only in development so Home's hidden long-press
            // reset affordance exists solely for testing, never in a release
            // build a real player runs. See handleDevReset.
            onDevReset={__DEV__ ? handleDevReset : undefined}
          />
        ) : screen === 'recipeBook' ? (
          <RecipeBook
            config={skinConfig}
            spriteAssets={spriteRegistry}
            unlockedCardIds={unlockedRecipeCards}
            onBack={handleGoHome}
          />
        ) : screen === 'levels' ? (
          <LevelMap
            config={skinConfig}
            levels={levelMapRows}
            completedCount={completedLevels.length}
            onBack={handleGoHome}
            onPlayLevel={handlePlayLevel}
          />
        ) : screen === 'outOfLives' ? (
          <OutOfLives
            config={skinConfig}
            spriteAssets={spriteRegistry}
            lives={lives}
            livesLastRegenAt={livesLastRegenAtRef.current}
            onGrantLife={handleGrantLife}
            adAvailable={adService.isRewardedAdAvailable()}
            onBack={handleGoHome}
          />
        ) : (
          <Board
            // Keyed by levelIndex so advancing to a new level fully remounts
            // Board — createGameState only runs once per mount (see
            // Board.tsx's useState initializer), so a fresh mount is what
            // resets its internal moves/objective/board state instead of
            // replaying the level just won.
            key={levelIndex}
            levelIndex={levelIndex}
            levelConfig={levelConfig as LevelConfig}
            skinConfig={skinConfig}
            spriteAssets={spriteRegistry}
            onStateChange={handleBoardStateChange}
            onNextLevel={handleNextLevel}
            onOpenDashboard={handleOpenAllLevels}
            // Reuses handleGoHome exactly — the persistent HUD close button
            // and PausedOverlay's "Exit" option both just return to Home,
            // same as WonOverlay's "Levels" detour reuses handleOpenAllLevels.
            // No new "leave the level" function was written.
            onExit={handleGoHome}
            // The account's current lives, kept fresh across re-renders —
            // Board's own internal "Play again" gates and restarts against
            // this, not its frozen levelConfig.lives (see Board.tsx).
            lives={lives}
            onOutOfLives={() => setScreen('outOfLives')}
            onLifeLost={handleLifeLost}
            // Threaded through so Board can tell a genuinely fresh save's
            // level 1 (completedLevels empty) apart from an experienced
            // player replaying it later — see appPersistence.ts's
            // shouldShowOnboardingTutorial.
            completedLevels={completedLevels}
            seenTutorials={seenTutorials}
            onTutorialSeen={handleTutorialSeen}
            unlockedRecipeCard={revealedRecipeCard}
            soundEnabled={soundEnabled}
            hapticsEnabled={hapticsEnabled}
          />
        )}
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
