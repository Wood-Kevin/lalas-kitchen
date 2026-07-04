import { createGameState, applyMove, createInMemoryStorage, loadSave, saveProgress } from './engine/gameState';
import { Board, Piece, Position } from './engine/matrix';
import {
  applyLivesRegen,
  BLOCKER_TUTORIAL_ID,
  buildGeneratedLevelConfig,
  buildSaveData,
  canStartLevel,
  didLevelJustEnd,
  eligibleBlockerIds,
  findBlockerMatchType,
  generatedLevelSeed,
  generatedMovesLimit,
  generatedObjectiveCount,
  generatedPieceTypeCount,
  generatedTargetCount,
  grantInstantLife,
  livesAfterLoss,
  markLevelCompleted,
  markTutorialSeen,
  msUntilNextLifeRegen,
  resolveNextLevelIndex,
  resolveStartLevelIndex,
  resolveStartScreen,
  shouldShowBlockerTutorial,
  shouldSpendLifeOnLoss,
  startingLives,
} from './appPersistence';

function piece(id: string, matchType: string): Piece {
  return { id, type: 'normal', matchType };
}

function blockerPiece(id: string, matchType: string): Piece {
  return { id, type: 'blocker', matchType, hitsRemaining: 1 };
}

function boardOf(rows: Piece[][]): Board {
  return rows;
}

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
      objectives: [{ targetMatchType: 'A', targetCount: 100 }],
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
      await saveProgress(skinId, buildSaveData(skinId, 1, [], [], state), storage);
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

  test('restarting a paused level (Play Again, reused from WonOverlay) is not treated as a save trigger', () => {
    // Board's handlePlayAgain — the exact same function passed to both
    // WonOverlay and PausedOverlay — replaces gameState via a fresh
    // createGameState(), landing on 'in_progress' regardless of what the
    // status was before. didLevelJustEnd only fires on a transition *out
    // of* 'in_progress' (see the test above), so restarting out of a
    // stuck paused_awaiting_input level must not persist — the player
    // abandoned that attempt, they didn't end it.
    expect(didLevelJustEnd('paused_awaiting_input', 'in_progress')).toBe(false);
  });

  test('a fresh install (no save yet) starts at the skin default', async () => {
    const storage = createInMemoryStorage();
    const loadedSave = await loadSave('never-played-skin', storage);
    expect(loadedSave).toBeNull();
    expect(startingLives(loadedSave, 5)).toBe(5);
  });
});

describe('markLevelCompleted', () => {
  test('adds a new level number, sorted', () => {
    expect(markLevelCompleted([1], 2)).toEqual([1, 2]);
    expect(markLevelCompleted([2], 1)).toEqual([1, 2]);
  });

  test('is idempotent — replaying an already-won level does not duplicate it', () => {
    expect(markLevelCompleted([1, 2], 1)).toEqual([1, 2]);
  });
});

describe('resolveNextLevelIndex', () => {
  test('returns the next level while still inside the hand-built queue', () => {
    expect(resolveNextLevelIndex(1)).toBe(2);
    expect(resolveNextLevelIndex(2)).toBe(3);
  });

  test('keeps advancing past the hand-built queue instead of dead-ending', () => {
    expect(resolveNextLevelIndex(3)).toBe(4);
    expect(resolveNextLevelIndex(4)).toBe(5);
    expect(resolveNextLevelIndex(50)).toBe(51);
  });
});

describe('resolveStartLevelIndex', () => {
  test('a fresh install starts on level 1', () => {
    expect(resolveStartLevelIndex(null)).toBe(1);
  });

  test('resumes the in-progress level from a prior save', () => {
    const save = {
      skinId: 'test',
      currentLevel: 2,
      lives: 5,
      livesLastRegenAt: 0,
      itemsCollected: {},
      powerUpCounts: {},
      completedLevels: [1],
    };
    expect(resolveStartLevelIndex(save)).toBe(2);
  });

  test('resumes a generated level past the hand-built queue, not a dashboard dead end', () => {
    const save = {
      skinId: 'test',
      currentLevel: 7,
      lives: 5,
      livesLastRegenAt: 0,
      itemsCollected: {},
      powerUpCounts: {},
      completedLevels: [1, 2, 3, 4, 5, 6],
    };
    expect(resolveStartLevelIndex(save)).toBe(7);
  });

  test('clamps a corrupt currentLevel of 0 or below up to 1', () => {
    const save = {
      skinId: 'test',
      currentLevel: 0,
      lives: 5,
      livesLastRegenAt: 0,
      itemsCollected: {},
      powerUpCounts: {},
      completedLevels: [],
    };
    expect(resolveStartLevelIndex(save)).toBe(1);
  });

  test('treats a save with no completedLevels field (pre-queue save) as nothing completed', () => {
    const save = {
      skinId: 'test',
      currentLevel: 1,
      lives: 5,
      livesLastRegenAt: 0,
      itemsCollected: {},
      powerUpCounts: {},
    };
    expect(resolveStartLevelIndex(save)).toBe(1);
  });
});

describe('resolveStartScreen', () => {
  test('every session opens on Home now, regardless of save state', () => {
    expect(resolveStartScreen()).toBe('home');
  });
});

describe('generatedLevelSeed', () => {
  test('continues LEVEL_QUEUE\'s own +100-per-level seed spacing', () => {
    // LEVEL_QUEUE (App.tsx): level 1 -> seed 1, level 2 -> seed 101, level 3 -> seed 201
    expect(generatedLevelSeed(4)).toBe(301);
    expect(generatedLevelSeed(5)).toBe(401);
  });

  test('is deterministic — the same level index always yields the same seed', () => {
    expect(generatedLevelSeed(12)).toBe(generatedLevelSeed(12));
  });
});

describe('generatedPieceTypeCount', () => {
  test('starts at the full available pool for the first generated level', () => {
    expect(generatedPieceTypeCount(1, 6)).toBe(6);
  });

  test('steps down by one every 3 levels', () => {
    expect(generatedPieceTypeCount(3, 6)).toBe(6);
    expect(generatedPieceTypeCount(4, 6)).toBe(5);
    expect(generatedPieceTypeCount(7, 6)).toBe(4);
  });

  test('floors at 3 types no matter how far the ramp continues', () => {
    expect(generatedPieceTypeCount(500, 6)).toBe(3);
  });
});

describe('generatedMovesLimit', () => {
  test('starts at the hand-built queue\'s own last value', () => {
    expect(generatedMovesLimit(1)).toBe(24);
  });

  test('steps down by one every 2 levels', () => {
    expect(generatedMovesLimit(2)).toBe(24);
    expect(generatedMovesLimit(3)).toBe(23);
  });

  test('floors at 18 moves no matter how far the ramp continues', () => {
    expect(generatedMovesLimit(500)).toBe(18);
  });
});

describe('generatedTargetCount', () => {
  test('grows a little each level, capped at 26', () => {
    expect(generatedTargetCount(1)).toBe(21);
    expect(generatedTargetCount(6)).toBe(26);
    expect(generatedTargetCount(500)).toBe(26);
  });
});

describe('generatedObjectiveCount', () => {
  test('a single objective before the introduction threshold', () => {
    expect(generatedObjectiveCount(1, 6)).toBe(1);
    expect(generatedObjectiveCount(3, 6)).toBe(1);
  });

  test('two objectives from the threshold level onward, given enough pool variety', () => {
    expect(generatedObjectiveCount(4, 6)).toBe(2);
    expect(generatedObjectiveCount(500, 6)).toBe(2);
  });

  test('never asks for more objectives than the level has distinct piece types', () => {
    expect(generatedObjectiveCount(500, 1)).toBe(1);
  });
});

describe('buildGeneratedLevelConfig', () => {
  test('builds a full LevelConfig (minus lives) for the first level past the hand-built queue', () => {
    // Generated level number 1 is below INTRODUCE_SECOND_OBJECTIVE_AT_LEVEL,
    // so this is still a single-objective level — an array of length one,
    // not a special case.
    const config = buildGeneratedLevelConfig(4, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    expect(config).toEqual({
      seed: 301,
      rows: 8,
      cols: 6,
      pieceTypeIds: ['A', 'B', 'C', 'D', 'E', 'F'],
      movesLimit: 24,
      objectives: [{ targetMatchType: 'A', targetCount: 21 }],
    });
  });

  test('shrinks the piece-type pool and rotates the objective targets as levels continue', () => {
    // Level 10 -> generated level number 7 -> 6 - floor(6/3) = 4 types.
    // Level number 7 is past INTRODUCE_SECOND_OBJECTIVE_AT_LEVEL (4), so
    // this level now asks for two distinct objectives.
    const config = buildGeneratedLevelConfig(10, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    expect(config.pieceTypeIds).toEqual(['A', 'B', 'C', 'D']);
    expect(config.objectives).toEqual([
      { targetMatchType: 'C', targetCount: 26 },
      { targetMatchType: 'D', targetCount: 26 },
    ]);
  });

  test('is fully deterministic — the same level index always produces the same config', () => {
    const a = buildGeneratedLevelConfig(9, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    const b = buildGeneratedLevelConfig(9, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    expect(a).toEqual(b);
  });

  test('never targets the same piece type twice on a level with two objectives', () => {
    // Scans well past the two-objective threshold — every level in range
    // must have distinct targetMatchTypes across its own objectives array,
    // regardless of how the piece-type pool has shrunk by that point.
    for (let levelIndex = 4; levelIndex <= 60; levelIndex++) {
      const config = buildGeneratedLevelConfig(levelIndex, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
      const targetTypes = config.objectives.map((o) => o.targetMatchType);
      expect(new Set(targetTypes).size).toBe(targetTypes.length);
    }
  });

  const ALL_BLOCKERS = [
    { id: 'cling', hitsToClear: 1 },
    { id: 'dish_stack', hitsToClear: 1 },
    { id: 'pot_lid', hitsToClear: 2 },
  ];
  const PIECE_TYPES = ['A', 'B', 'C', 'D', 'E', 'F'];
  const HAND_BUILT_COUNT = 3; // mirrors App.tsx's LEVEL_QUEUE.length

  test('never places pot_lid below its difficulty threshold, even once blockers start appearing at all', () => {
    // levelIndex 4..9 -> generated level number 1..6, all below
    // BLOCKER_MIN_LEVEL_NUMBER.pot_lid (7) but at/past generatedBlockerCount's
    // own INTRODUCE_AT_LEVEL (3), so blockers are genuinely being placed
    // here — just never pot_lid specifically.
    for (let levelIndex = 4; levelIndex <= 9; levelIndex++) {
      const config = buildGeneratedLevelConfig(levelIndex, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, ALL_BLOCKERS);
      expect(config.blockerMatchType).not.toBe('pot_lid');
    }
  });

  test('can place pot_lid once past its difficulty threshold', () => {
    // levelIndex 10.. -> generated level number 7.. (>= BLOCKER_MIN_LEVEL_NUMBER.pot_lid).
    // Rotation through the eligible pool means not every level in range
    // picks pot_lid, but scanning enough of them must surface it at least
    // once — otherwise the threshold would be silently unreachable.
    const chosen = new Set<string | undefined>();
    for (let levelIndex = 10; levelIndex <= 21; levelIndex++) {
      const config = buildGeneratedLevelConfig(levelIndex, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, ALL_BLOCKERS);
      chosen.add(config.blockerMatchType);
    }
    expect(chosen.has('pot_lid')).toBe(true);
  });

  test('a blocker-less skin (empty blockers array) never places any blocker, at any level', () => {
    for (const levelIndex of [4, 10, 21]) {
      const config = buildGeneratedLevelConfig(levelIndex, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, []);
      expect(config.blockerMatchType).toBeUndefined();
      expect(config.blockerCount).toBeUndefined();
    }
  });
});

describe('eligibleBlockerIds', () => {
  const ids = ['cling', 'dish_stack', 'pot_lid'];

  test('excludes pot_lid below its threshold, keeping ids with no gate eligible from level 1', () => {
    expect(eligibleBlockerIds(1, ids)).toEqual(['cling', 'dish_stack']);
    expect(eligibleBlockerIds(6, ids)).toEqual(['cling', 'dish_stack']);
  });

  test('includes pot_lid from its threshold level onward', () => {
    expect(eligibleBlockerIds(7, ids)).toEqual(['cling', 'dish_stack', 'pot_lid']);
    expect(eligibleBlockerIds(50, ids)).toEqual(['cling', 'dish_stack', 'pot_lid']);
  });

  test('an id with no configured gate is eligible at level 1', () => {
    expect(eligibleBlockerIds(1, ['cling'])).toEqual(['cling']);
  });
});

describe('canStartLevel', () => {
  test('blocks at zero lives', () => {
    expect(canStartLevel(0)).toBe(false);
  });

  test('allows starting with at least one life', () => {
    expect(canStartLevel(1)).toBe(true);
    expect(canStartLevel(5)).toBe(true);
  });
});

describe('livesAfterLoss', () => {
  test('decrements by exactly one', () => {
    expect(livesAfterLoss(5)).toBe(4);
    expect(livesAfterLoss(1)).toBe(0);
  });

  test('never goes negative — a loss at zero lives stays at zero', () => {
    expect(livesAfterLoss(0)).toBe(0);
  });
});

describe('shouldSpendLifeOnLoss', () => {
  test('fires on the exact transition a moves-exhausted loss produces', () => {
    expect(shouldSpendLifeOnLoss('in_progress', 'paused_awaiting_input', 'moves')).toBe(true);
  });

  test('does not fire again for the same paused state sitting unchanged across a re-render', () => {
    // The second render App.tsx's handleBoardStateChange would see for the
    // same loss: prevStatus is now already 'paused_awaiting_input', not
    // 'in_progress' — this is the exact guard that makes a second call for
    // an unchanged state a no-op, proving a loss can't double-decrement.
    expect(shouldSpendLifeOnLoss('paused_awaiting_input', 'paused_awaiting_input', 'moves')).toBe(false);
  });

  test('does not fire for a win', () => {
    expect(shouldSpendLifeOnLoss('in_progress', 'won', null)).toBe(false);
  });

  test('does not fire for a plain in-progress move (illegal-move snap-back or a normal legal move)', () => {
    expect(shouldSpendLifeOnLoss('in_progress', 'in_progress', null)).toBe(false);
  });
});

describe('applyLivesRegen', () => {
  const MAX = 5;
  const REGEN_MINUTES = 30;
  const REGEN_MS = REGEN_MINUTES * 60 * 1000;

  test('grants no lives when no full interval has elapsed', () => {
    const start = 1000;
    const result = applyLivesRegen(2, start, MAX, REGEN_MINUTES, start + REGEN_MS - 1);
    expect(result).toEqual({ lives: 2, livesLastRegenAt: start });
  });

  test('grants exactly one life after exactly one interval, carrying the anchor forward (not resetting to now)', () => {
    const start = 1000;
    const now = start + REGEN_MS;
    const result = applyLivesRegen(2, start, MAX, REGEN_MINUTES, now);
    expect(result).toEqual({ lives: 3, livesLastRegenAt: start + REGEN_MS });
  });

  test('grants multiple lives for multiple elapsed intervals', () => {
    const start = 1000;
    const now = start + REGEN_MS * 3;
    const result = applyLivesRegen(1, start, MAX, REGEN_MINUTES, now);
    expect(result).toEqual({ lives: 4, livesLastRegenAt: start + REGEN_MS * 3 });
  });

  test('caps at max and does not grant extra lives for elapsed time beyond what regenMinutes and max allow', () => {
    const start = 1000;
    // Enough elapsed time for 10 intervals, but only 2 are needed to reach
    // max from 3 — the other 8 intervals' worth of time must not be banked.
    const now = start + REGEN_MS * 10;
    const result = applyLivesRegen(3, start, MAX, REGEN_MINUTES, now);
    expect(result.lives).toBe(MAX);
    // Anchor resets to "now" once capped, rather than advancing by only
    // the 2 intervals actually used — there is nothing left to count
    // toward, so the excess elapsed time is discarded, not stored.
    expect(result.livesLastRegenAt).toBe(now);
  });

  test('already at max: resets the anchor to now without exceeding max', () => {
    const start = 1000;
    const now = start + REGEN_MS * 5;
    const result = applyLivesRegen(MAX, start, MAX, REGEN_MINUTES, now);
    expect(result).toEqual({ lives: MAX, livesLastRegenAt: now });
  });

  test('zero elapsed time grants nothing and leaves the anchor untouched', () => {
    const start = 1000;
    const result = applyLivesRegen(2, start, MAX, REGEN_MINUTES, start);
    expect(result).toEqual({ lives: 2, livesLastRegenAt: start });
  });
});

describe('msUntilNextLifeRegen', () => {
  const MAX = 5;
  const REGEN_MINUTES = 30;
  const REGEN_MS = REGEN_MINUTES * 60 * 1000;

  test('counts down the full interval right after the anchor is set', () => {
    const start = 1000;
    expect(msUntilNextLifeRegen(0, start, MAX, REGEN_MINUTES, start)).toBe(REGEN_MS);
  });

  test('reflects elapsed time as it passes, without a separate tracked value', () => {
    const start = 1000;
    const elapsed = REGEN_MS / 3;
    expect(msUntilNextLifeRegen(0, start, MAX, REGEN_MINUTES, start + elapsed)).toBe(REGEN_MS - elapsed);
  });

  test('bottoms out at zero once the interval has fully elapsed, never goes negative', () => {
    const start = 1000;
    expect(msUntilNextLifeRegen(0, start, MAX, REGEN_MINUTES, start + REGEN_MS)).toBe(0);
    expect(msUntilNextLifeRegen(0, start, MAX, REGEN_MINUTES, start + REGEN_MS * 5)).toBe(0);
  });

  test('is zero when already at max — nothing left to count down to', () => {
    const start = 1000;
    expect(msUntilNextLifeRegen(MAX, start, MAX, REGEN_MINUTES, start)).toBe(0);
  });
});

describe('grantInstantLife', () => {
  test('adds exactly one life', () => {
    expect(grantInstantLife(0, 5)).toBe(1);
    expect(grantInstantLife(2, 5)).toBe(3);
  });

  test('respects the max cap instead of exceeding it', () => {
    expect(grantInstantLife(4, 5)).toBe(5);
    expect(grantInstantLife(5, 5)).toBe(5);
  });
});

describe('buildSaveData — regen anchor', () => {
  test('writes the explicitly-passed livesLastRegenAt instead of always stamping "now"', () => {
    const fixedNow = () => 9999999;
    const data = buildSaveData('skin', 1, [], [], { lives: 3 }, 1234567, fixedNow);
    expect(data.livesLastRegenAt).toBe(1234567);
    expect(data.lives).toBe(3);
  });

  test('falls back to now() when no explicit anchor is given, unchanged from before regen math existed', () => {
    const fixedNow = () => 9999999;
    const data = buildSaveData('skin', 1, [], [], { lives: 3 }, undefined, fixedNow);
    expect(data.livesLastRegenAt).toBe(9999999);
  });

  test('writes the seenTutorials list passed in', () => {
    const data = buildSaveData('skin', 1, [], ['blocker'], { lives: 3 });
    expect(data.seenTutorials).toEqual(['blocker']);
  });
});

describe('findBlockerMatchType', () => {
  test('finds the first blocker piece\'s matchType, scanning row-major', () => {
    const board = boardOf([
      [piece('a', 'tomato'), piece('b', 'lemon')],
      [piece('c', 'herb'), blockerPiece('d', 'cling')],
    ]);
    expect(findBlockerMatchType(board)).toBe('cling');
  });

  test('is undefined when the board has no blocker at all', () => {
    const board = boardOf([[piece('a', 'tomato'), piece('b', 'lemon')]]);
    expect(findBlockerMatchType(board)).toBeUndefined();
  });
});

describe('shouldShowBlockerTutorial', () => {
  test('true when the board has a blocker and the tutorial has never been seen', () => {
    const board = boardOf([[blockerPiece('a', 'cling')]]);
    expect(shouldShowBlockerTutorial(board, [])).toBe(true);
  });

  test('false when the board has a blocker but the tutorial was already dismissed', () => {
    const board = boardOf([[blockerPiece('a', 'cling')]]);
    expect(shouldShowBlockerTutorial(board, [BLOCKER_TUTORIAL_ID])).toBe(false);
  });

  test('false when the board has no blocker at all, regardless of seenTutorials', () => {
    const board = boardOf([[piece('a', 'tomato')]]);
    expect(shouldShowBlockerTutorial(board, [])).toBe(false);
  });
});

describe('markTutorialSeen', () => {
  test('adds a new tutorial id', () => {
    expect(markTutorialSeen([], BLOCKER_TUTORIAL_ID)).toEqual([BLOCKER_TUTORIAL_ID]);
  });

  test('is idempotent — dismissing an already-seen tutorial does not duplicate it', () => {
    expect(markTutorialSeen([BLOCKER_TUTORIAL_ID], BLOCKER_TUTORIAL_ID)).toEqual([BLOCKER_TUTORIAL_ID]);
  });

  test('preserves existing entries when adding a different id', () => {
    expect(markTutorialSeen([BLOCKER_TUTORIAL_ID], 'powerup')).toEqual([BLOCKER_TUTORIAL_ID, 'powerup']);
  });
});
