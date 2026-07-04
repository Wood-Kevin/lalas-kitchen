import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Board } from './components/Board';
import { Home } from './components/Home';
import { AllLevels, AllLevelsRow } from './components/AllLevels';
import { OutOfLives } from './components/OutOfLives';
import { SkinConfig } from './components/skinConfig';
import { GameState, GameStatus, LevelConfig, loadSave, saveProgress } from './engine/gameState';
import {
  applyLivesRegen,
  buildGeneratedLevelConfig,
  buildSaveData,
  canStartLevel,
  didLevelJustEnd,
  grantInstantLife,
  livesAfterLoss,
  markLevelCompleted,
  markTutorialSeen,
  resolveNextLevelIndex,
  resolveStartLevelIndex,
  resolveStartScreen,
  shouldSpendLifeOnLoss,
  startingLives,
} from './appPersistence';
import {
  buildLevelSummary,
  resolveLevelStatus,
  resolveNextUnplayedLevel,
  resolveVisibleLevelIndices,
} from './components/levelProgress';
import skinConfigJson from './skins/lalas-kitchen/config.json';
import { spriteRegistry } from './skins/lalas-kitchen/spriteRegistry';

const skinConfig = skinConfigJson as SkinConfig;

// The hand-built queue: a small, curated set with light progression (more
// moves and a higher target count each level) and a distinct target piece
// type per level, so advancing actually feels like a different level and
// not just a reshuffled board. Past the end of this queue, buildLevelConfig
// falls through to buildGeneratedLevelConfig (appPersistence.ts) instead of
// dead-ending — a real level-authoring pipeline for more curated content is
// still out of scope for now, but "out of curated levels" no longer means
// "out of game."
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

type Screen = 'loading' | 'home' | 'game' | 'levels' | 'outOfLives';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  // 1-based index into LEVEL_QUEUE for whichever level is currently active
  // (or was last active, while screen is 'home'/'levels').
  const [levelIndex, setLevelIndex] = useState(1);
  const [levelConfig, setLevelConfig] = useState<LevelConfig | null>(null);
  const [completedLevels, setCompletedLevels] = useState<number[]>([]);
  // IDs of one-time tutorial popups already dismissed (e.g. 'blocker') —
  // see engine/gameState.ts's SaveData.seenTutorials comment on why this
  // is a plain string list rather than a bespoke boolean per tutorial.
  const [seenTutorials, setSeenTutorials] = useState<string[]>([]);

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
  const seenTutorialsRef = useRef(seenTutorials);
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

  useEffect(() => {
    let cancelled = false;
    loadSave(skinConfig.skinId).then((save) => {
      if (cancelled) return;
      const startLevelIndex = resolveStartLevelIndex(save);
      const initialCompleted = save?.completedLevels ?? [];
      const initialSeenTutorials = save?.seenTutorials ?? [];

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
      seenTutorialsRef.current = initialSeenTutorials;
      livesRef.current = regenerated.lives;
      livesLastRegenAtRef.current = regenerated.livesLastRegenAt;
      setLives(regenerated.lives);
      setLevelIndex(startLevelIndex);
      setCompletedLevels(initialCompleted);
      setSeenTutorials(initialSeenTutorials);
      // levelConfig stays null here — every session now opens on Home (see
      // resolveStartScreen), not straight into a board, so there's nothing
      // to preload until the player actually taps into a level.
      setScreen(resolveStartScreen());
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        seenTutorialsRef.current,
        { lives: livesRef.current },
        livesLastRegenAtRef.current
      )
    );
  }, []);

  const handleBoardStateChange = useCallback(
    (state: GameState) => {
      latestStateRef.current = state;
      // Captured before prevStatusRef is overwritten below — this is the
      // one moment this transition can be observed. Board's own
      // useEffect(() => onStateChange?.(state), [gameState]) only re-fires
      // when the gameState *object* changes (a real move/grant/restart),
      // never on a plain re-render — so shouldSpendLifeOnLoss below is
      // structurally guaranteed to fire exactly once per loss, the same
      // guarantee didLevelJustEnd already relies on for persistLatestState.
      const prevStatus = prevStatusRef.current;
      const justEnded = didLevelJustEnd(prevStatus, state.status);
      prevStatusRef.current = state.status;
      if (justEnded) {
        if (state.status === 'won') {
          const updated = markLevelCompleted(completedLevelsRef.current, levelIndexRef.current);
          completedLevelsRef.current = updated;
          setCompletedLevels(updated);
        }
        if (shouldSpendLifeOnLoss(prevStatus, state.status, state.pauseReason)) {
          // Apply any regen owed first, then spend the loss — so a player
          // who lost a level, waited past a regen tick, and is only now
          // triggering this (e.g. a delayed background-save flush) gets
          // the most accurate possible final count rather than double
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
          // The regen clock only starts once lives actually drop below
          // max — a loss landing while already below max shouldn't reset
          // whatever progress the existing timer already had toward its
          // next tick (see applyLivesRegen's own comment on this).
          livesLastRegenAtRef.current = wasFull ? now : regenerated.livesLastRegenAt;
          setLives(newLives);
        }
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
  const handleGrantLife = useCallback(() => {
    const newLives = grantInstantLife(skinConfig.lives.max);
    livesRef.current = newLives;
    setLives(newLives);
    saveProgress(
      skinConfig.skinId,
      buildSaveData(
        skinConfig.skinId,
        levelIndexRef.current,
        completedLevelsRef.current,
        seenTutorialsRef.current,
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
        updated,
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
  const allLevelsRows: AllLevelsRow[] = resolveVisibleLevelIndices(LEVEL_QUEUE.length, completedLevels).map(
    (index) => ({
      ...buildLevelSummary(buildLevelConfig(index, lives), index),
      status: resolveLevelStatus(index, completedLevels),
    })
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }}>
        {screen === 'home' ? (
          <Home
            config={skinConfig}
            spriteAssets={spriteRegistry}
            completedLevels={completedLevels}
            nextLevel={nextLevelSummary}
            onStartNext={() => handlePlayLevel(nextLevelIndex)}
            onBrowseAllLevels={handleOpenAllLevels}
          />
        ) : screen === 'levels' ? (
          <AllLevels
            config={skinConfig}
            spriteAssets={spriteRegistry}
            levels={allLevelsRows}
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
            seenTutorials={seenTutorials}
            onTutorialSeen={handleTutorialSeen}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
