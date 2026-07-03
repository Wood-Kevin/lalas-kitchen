import { createGameState, applyMove, createInMemoryStorage, loadSave, saveProgress } from './engine/gameState';
import { Position } from './engine/matrix';
import { buildSaveData, didLevelJustEnd, startingLives } from './appPersistence';

// Exercises the actual call sites App.tsx wires together (loadSave ->
// startingLives -> createGameState -> applyMove -> didLevelJustEnd ->
// buildSaveData -> saveProgress -> loadSave again), using the real engine
// end to end — not hand-built SaveData objects disconnected from gameplay,
// which is what engine/gameState.test.ts's save/load test already covers.
// Proves the wiring, not just that loadSave/saveProgress are correct in
// isolation.

function findFirstLegalMove(
  boardRows: number,
  boardCols: number,
  isLegal: (a: Position, b: Position) => boolean
): { a: Position; b: Position } {
  for (let row = 0; row < boardRows; row++) {
    for (let col = 0; col < boardCols; col++) {
      const neighbors: Position[] = [
        { row: row + 1, col },
        { row, col: col + 1 },
      ];
      for (const b of neighbors) {
        if (b.row >= boardRows || b.col >= boardCols) continue;
        const a = { row, col };
        if (isLegal(a, b)) return { a, b };
      }
    }
  }
  throw new Error('no legal move found on this seeded board — adjust the seed');
}

describe('save/load wiring — real call sites, end to end', () => {
  test('a level-ending move persists lives, and the next session picks them up', async () => {
    const storage = createInMemoryStorage();
    const skinId = 'test-skin';

    // Simulates a save already left behind by an earlier session, with
    // lives already down from the skin's max of 5 — so the round trip
    // below can't accidentally pass just because lives never changes.
    const priorSave = {
      skinId,
      currentLevel: 1,
      lives: 3,
      livesLastRegenAt: 1700000000000,
      itemsCollected: {},
      powerUpCounts: {},
    };
    await saveProgress(skinId, priorSave, storage);

    // --- "App startup" ---
    const loadedSave = await loadSave(skinId, storage);
    const fallbackMax = 5;
    const lives = startingLives(loadedSave, fallbackMax);
    expect(lives).toBe(3); // came from the prior save, not the skin's max

    const levelConfig = {
      seed: 42,
      rows: 6,
      cols: 6,
      pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
      movesLimit: 1,
      lives,
      objective: { targetMatchType: 'A', targetCount: 100 },
    };
    let state = createGameState(levelConfig);
    let prevStatus = state.status;

    // --- "One move is played" — find whatever legal swap exists on this
    // seeded board and take it; movesLimit: 1 means it ends the level.
    const { a, b } = findFirstLegalMove(levelConfig.rows, levelConfig.cols, (posA, posB) => {
      const result = applyMove(state, posA, posB);
      return result.state !== state;
    });
    const result = applyMove(state, a, b);
    state = result.state;

    expect(state.status).toBe('paused_awaiting_input');
    expect(state.pauseReason).toBe('moves');
    expect(state.lives).toBe(3); // nothing in V1 spends lives mid-level yet

    // --- Board's onStateChange -> App's handleBoardStateChange, replayed ---
    const justEnded = didLevelJustEnd(prevStatus, state.status);
    prevStatus = state.status;
    expect(justEnded).toBe(true);

    if (justEnded) {
      await saveProgress(skinId, buildSaveData(skinId, 1, state), storage);
    }

    // --- "App reopened" ---
    const reloadedSave = await loadSave(skinId, storage);
    expect(reloadedSave).not.toBeNull();
    expect(reloadedSave?.lives).toBe(3);
    expect(startingLives(reloadedSave, fallbackMax)).toBe(3);
  });

  test('a mid-level state change (no level end) is not treated as a save trigger', () => {
    // Illegal-move rejection: status stays in_progress -> in_progress.
    expect(didLevelJustEnd('in_progress', 'in_progress')).toBe(false);
  });

  test('a fresh install (no save yet) starts at the skin default', async () => {
    const storage = createInMemoryStorage();
    const loadedSave = await loadSave('never-played-skin', storage);
    expect(loadedSave).toBeNull();
    expect(startingLives(loadedSave, 5)).toBe(5);
  });
});
