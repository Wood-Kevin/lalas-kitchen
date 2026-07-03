import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Board } from './components/Board';
import { SkinConfig } from './components/skinConfig';
import { GameState, GameStatus, LevelConfig, loadSave, saveProgress } from './engine/gameState';
import { buildSaveData, didLevelJustEnd, startingLives } from './appPersistence';
import skinConfigJson from './skins/lalas-kitchen/config.json';
import { spriteRegistry } from './skins/lalas-kitchen/spriteRegistry';

const skinConfig = skinConfigJson as SkinConfig;

// V1 ships exactly one level — this is a placeholder for the field
// SaveData already reserves for a future level roster (see
// engine/gameState.ts's SaveData and CLAUDE.md's out-of-scope list).
const CURRENT_LEVEL = 1;

const baseLevelConfig: Omit<LevelConfig, 'lives'> = {
  seed: 1,
  rows: 8,
  cols: 6,
  pieceTypeIds: skinConfig.pieceTypes.map((pieceType) => pieceType.id),
  movesLimit: 20,
  objective: { targetMatchType: skinConfig.pieceTypes[0].id, targetCount: 15 },
};

export default function App() {
  // null while the save is being read — Board can't mount until it knows
  // how many lives to start with (see appPersistence's startingLives).
  const [levelConfig, setLevelConfig] = useState<LevelConfig | null>(null);

  // Mirrors Board's current GameState so the AppState background handler
  // (below) has something to persist even mid-level, without lifting the
  // whole board into this component. A ref, not state, since nothing here
  // needs to re-render when it changes.
  const latestStateRef = useRef<GameState | null>(null);
  const prevStatusRef = useRef<GameStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSave(skinConfig.skinId).then((save) => {
      if (cancelled) return;
      setLevelConfig({
        ...baseLevelConfig,
        lives: startingLives(save, skinConfig.lives.max),
      });
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
    saveProgress(skinConfig.skinId, buildSaveData(skinConfig.skinId, CURRENT_LEVEL, state));
  }, []);

  const handleBoardStateChange = useCallback(
    (state: GameState) => {
      latestStateRef.current = state;
      const justEnded = didLevelJustEnd(prevStatusRef.current, state.status);
      prevStatusRef.current = state.status;
      if (justEnded) {
        persistLatestState();
      }
    },
    [persistLatestState]
  );

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

  if (!levelConfig) {
    // Brief load gate while the save is read — matches the skin background
    // rather than flashing white while this resolves.
    return <View style={{ flex: 1, backgroundColor: skinConfig.palette.background[0] }} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }}>
        <Board
          levelConfig={levelConfig}
          skinConfig={skinConfig}
          spriteAssets={spriteRegistry}
          onStateChange={handleBoardStateChange}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
