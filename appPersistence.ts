import { GameState, GameStatus, SaveData } from './engine/gameState';

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
export function buildSaveData(
  skinId: string,
  currentLevel: number,
  state: Pick<GameState, 'lives'>,
  now: () => number = Date.now
): SaveData {
  return {
    skinId,
    currentLevel,
    lives: state.lives,
    livesLastRegenAt: now(),
    itemsCollected: {},
    powerUpCounts: {},
  };
}
