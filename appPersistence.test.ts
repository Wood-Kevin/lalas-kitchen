import { createGameState, applyMove, createInMemoryStorage, loadSave, saveProgress } from './engine/gameState';
import { Board, Piece, Position } from './engine/matrix';
import {
  applyLivesRegen,
  backfillUnlockedRecipeCards,
  BLOCKER_TUTORIAL_ID,
  buildGeneratedLevelConfig,
  buildSaveData,
  canStartLevel,
  didLevelJustEnd,
  eligibleBlockerIds,
  findBlockerMatchType,
  findSpecialPieceTutorial,
  findRecipeCardForLevel,
  STRIPED_TUTORIAL_ID,
  COLOR_BOMB_TUTORIAL_ID,
  AREA_BOMB_TUTORIAL_ID,
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
  shouldShowChainReactionTutorial,
  CHAIN_REACTION_TUTORIAL_ID,
  shouldShowOnboardingTutorial,
  HOW_TO_PLAY_TUTORIAL_ID,
  shouldSpendLifeOnLoss,
  startingLives,
  unlockRecipeCard,
} from './appPersistence';
import { RecipeCard } from './components/skinConfig';

function piece(id: string, matchType: string): Piece {
  return { id, type: 'normal', matchType };
}

function blockerPiece(id: string, matchType: string): Piece {
  return { id, type: 'blocker', matchType, hitsRemaining: 1 };
}

// A striped piece keeps its base matchType plus a sweep direction; the two
// bomb types are colorless (no matchType) — mirrors engine/matrix.ts's Piece.
function stripedPiece(id: string, matchType: string): Piece {
  return { id, type: 'striped', matchType, direction: 'row' };
}

function colorBombPiece(id: string): Piece {
  return { id, type: 'color_bomb' };
}

function areaBombPiece(id: string): Piece {
  return { id, type: 'area_bomb' };
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
      await saveProgress(skinId, buildSaveData(skinId, 1, [], [], [], false, false, state), storage);
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
  test('starts at the minimal pool for the first generated level', () => {
    expect(generatedPieceTypeCount(1, 6)).toBe(3);
  });

  test('steps up by one every 3 levels', () => {
    expect(generatedPieceTypeCount(3, 6)).toBe(3);
    expect(generatedPieceTypeCount(4, 6)).toBe(4);
    expect(generatedPieceTypeCount(7, 6)).toBe(5);
  });

  test('caps at the full available pool no matter how far the ramp continues', () => {
    expect(generatedPieceTypeCount(500, 6)).toBe(6);
  });

  test('a level well into the generated range has meaningfully more piece types than an early level', () => {
    const early = generatedPieceTypeCount(1, 6);
    const deep = generatedPieceTypeCount(30, 6);
    expect(deep).toBeGreaterThan(early);
    expect(deep).toBe(6);
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
  test('a single objective while the piece-type pool is still small', () => {
    expect(generatedObjectiveCount(1)).toBe(1);
    expect(generatedObjectiveCount(4)).toBe(1);
  });

  test('two objectives once the pool clears the trivialization threshold', () => {
    expect(generatedObjectiveCount(5)).toBe(2);
    expect(generatedObjectiveCount(6)).toBe(2);
  });
});

describe('buildGeneratedLevelConfig', () => {
  test('builds a full LevelConfig (minus lives) for the first level past the hand-built queue', () => {
    // Generated level number 1 -> minimal 3-type pool (see
    // generatedPieceTypeCount), which is below MIN_TYPES_FOR_SECOND_OBJECTIVE,
    // so this is still a single-objective level — an array of length one,
    // not a special case.
    const config = buildGeneratedLevelConfig(4, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    expect(config).toEqual({
      seed: 301,
      rows: 8,
      cols: 6,
      pieceTypeIds: ['A', 'B', 'C'],
      movesLimit: 24,
      objectives: [{ targetMatchType: 'A', targetCount: 21 }],
    });
  });

  test('grows the piece-type pool and shares the target total across two objectives', () => {
    // Level 10 -> generated level number 7 -> 3 + floor(6/3) = 5 types,
    // which clears MIN_TYPES_FOR_SECOND_OBJECTIVE (5), so this level now
    // asks for two distinct objectives. generatedTargetCount(7) is 26, and
    // that is the TOTAL burden shared across the objectives, not a
    // per-objective quota: 26 / 2 = 13 each, not 26 + 26 = 52. An earlier
    // version of this test asserted 26 + 26 and so enshrined the compounding
    // bug (a two-objective level demanding double an equivalent
    // single-objective one) as intended behavior — see engine/DECISIONS.md's
    // target-sharing entry.
    const config = buildGeneratedLevelConfig(10, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    expect(config.pieceTypeIds).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(config.objectives).toEqual([
      { targetMatchType: 'B', targetCount: 13 },
      { targetMatchType: 'C', targetCount: 13 },
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

  // Regression guard for a reported symptom (boards only ever spawning 3 of
  // 6 established piece types) suspected to be objectives narrowing
  // pieceTypeIds down to just the target types, rather than pieceTypeIds
  // being the independent, full-pool-minus-difficulty-ramp source objectives
  // are chosen *from*. Investigated directly: pieceTypeIds is computed via
  // generatedPieceTypeCount (the pre-existing, unrelated difficulty ramp)
  // before objectives are ever chosen, and objectives are sliced out of that
  // already-computed pieceTypeIds array — there is no code path where it
  // runs the other way. This test locks that in explicitly: a level with two
  // objectives must still carry a pieceTypeIds pool sized by
  // generatedPieceTypeCount alone, strictly larger than the objective count,
  // with every objective's targetMatchType drawn from it.
  test('a two-objective level still carries the full generatedPieceTypeCount pool, not just its objective types', () => {
    const ALL_TYPES = ['tomato', 'lemon', 'herb', 'garlic', 'chili', 'spoon'];
    // levelIndex 11 -> generated level number 8 -> two objectives (typeCount
    // has cleared MIN_TYPES_FOR_SECOND_OBJECTIVE) but still only 5 of 6
    // piece types (generatedPieceTypeCount(8, 6) = 3 + floor(7/3) = 5) — a
    // real case where objectiveCount (2) and pieceTypeIds.length (5) must
    // clearly differ.
    const config = buildGeneratedLevelConfig(11, 3, ALL_TYPES, 8, 6);
    expect(config.objectives).toHaveLength(2);
    expect(config.pieceTypeIds).toEqual(['tomato', 'lemon', 'herb', 'garlic', 'chili']);
    expect(config.pieceTypeIds.length).toBeGreaterThan(config.objectives.length);
    for (const objective of config.objectives) {
      expect(config.pieceTypeIds).toContain(objective.targetMatchType);
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

  test('enables dynamic denial-zone spread only past its threshold (generated level number 10)', () => {
    // generatedLevelNumber = levelIndex - HAND_BUILT_COUNT (3).
    // Level number 9 (levelIndex 12): blockers present, but below
    // DENIAL_SPREAD_MIN_LEVEL_NUMBER (10) — no spread.
    const below = buildGeneratedLevelConfig(12, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, ALL_BLOCKERS);
    expect(below.blockerCount).toBeGreaterThan(0);
    expect(below.denialSpread).toBeUndefined();
    // Level number 10 (levelIndex 13): at the threshold with blockers — spread on.
    const at = buildGeneratedLevelConfig(13, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, ALL_BLOCKERS);
    expect(at.blockerCount).toBeGreaterThan(0);
    expect(at.denialSpread).toBe(true);
  });

  test('never enables spread on a blocker-less skin, even well past the threshold', () => {
    // Nothing to spread from, so the flag would be inert — it's never set.
    const config = buildGeneratedLevelConfig(21, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, []);
    expect(config.denialSpread).toBeUndefined();
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
  // Deliberately a full refill to max, not the genre-standard +1 — see
  // appPersistence.ts's grantInstantLife comment. The result never depends
  // on the current lives count, only on max, so there's nothing to vary
  // here beyond confirming that directly.
  test('refills to the full configured max, regardless of the current count', () => {
    expect(grantInstantLife(5)).toBe(5);
  });

  test('still returns exactly max for a different configured max', () => {
    expect(grantInstantLife(3)).toBe(3);
  });
});

describe('buildSaveData — regen anchor', () => {
  test('writes the explicitly-passed livesLastRegenAt instead of always stamping "now"', () => {
    const fixedNow = () => 9999999;
    const data = buildSaveData('skin', 1, [], [], [], false, false, { lives: 3 }, 1234567, fixedNow);
    expect(data.livesLastRegenAt).toBe(1234567);
    expect(data.lives).toBe(3);
  });

  test('falls back to now() when no explicit anchor is given, unchanged from before regen math existed', () => {
    const fixedNow = () => 9999999;
    const data = buildSaveData('skin', 1, [], [], [], false, false, { lives: 3 }, undefined, fixedNow);
    expect(data.livesLastRegenAt).toBe(9999999);
  });

  test('writes the seenTutorials list passed in', () => {
    const data = buildSaveData('skin', 1, [], ['blocker'], [], false, false, { lives: 3 });
    expect(data.seenTutorials).toEqual(['blocker']);
  });

  test('writes the unlockedRecipeCards list passed in', () => {
    const data = buildSaveData('skin', 1, [], [], ['tomato_stew'], false, false, { lives: 3 });
    expect(data.unlockedRecipeCards).toEqual(['tomato_stew']);
  });
});

describe('buildSaveData — sound/haptics flags', () => {
  test('writes soundEnabled through unchanged', () => {
    const data = buildSaveData('skin', 1, [], [], [], true, false, { lives: 3 });
    expect(data.soundEnabled).toBe(true);
  });

  test('writes hapticsEnabled through unchanged', () => {
    const data = buildSaveData('skin', 1, [], [], [], false, true, { lives: 3 });
    expect(data.hapticsEnabled).toBe(true);
  });
});

describe('SaveData — sound/haptics backward compatibility', () => {
  test('an old save with no sound/haptics fields still loads, defaults resolved by the caller (not buildSaveData)', async () => {
    const storage = createInMemoryStorage();
    const skinId = 'pre-sound-save';
    const priorSave = {
      skinId,
      currentLevel: 1,
      lives: 5,
      livesLastRegenAt: 1700000000000,
      itemsCollected: {},
      powerUpCounts: {},
      // Deliberately omits soundEnabled/hapticsEnabled — proves a save
      // written before this session still deserializes cleanly.
    };
    await saveProgress(skinId, priorSave, storage);
    const loaded = await loadSave(skinId, storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.soundEnabled).toBeUndefined();
    expect(loaded?.hapticsEnabled).toBeUndefined();
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

describe('shouldShowOnboardingTutorial', () => {
  test('true on a genuinely fresh save\'s level 1 — nothing completed, never seen', () => {
    expect(shouldShowOnboardingTutorial(1, [], [])).toBe(true);
  });

  test('false once the player has already dismissed it', () => {
    expect(shouldShowOnboardingTutorial(1, [], [HOW_TO_PLAY_TUTORIAL_ID])).toBe(false);
  });

  test('false replaying level 1 after already completing it — not a genuinely fresh save', () => {
    expect(shouldShowOnboardingTutorial(1, [1], [])).toBe(false);
  });

  test('false replaying level 1 after completing a later level, even if level 1 itself is not in the list', () => {
    // Any non-empty completedLevels means the player has already won
    // something, and therefore already knows how to play.
    expect(shouldShowOnboardingTutorial(1, [3], [])).toBe(false);
  });

  test('false on any level past 1, regardless of completedLevels/seenTutorials', () => {
    expect(shouldShowOnboardingTutorial(2, [], [])).toBe(false);
  });

  test('dismissing the other tutorials does not suppress this one — distinct id', () => {
    const seen = [BLOCKER_TUTORIAL_ID, STRIPED_TUTORIAL_ID, COLOR_BOMB_TUTORIAL_ID, AREA_BOMB_TUTORIAL_ID];
    expect(shouldShowOnboardingTutorial(1, [], seen)).toBe(true);
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

  test('handles HOW_TO_PLAY_TUTORIAL_ID exactly like any other id', () => {
    expect(markTutorialSeen([], HOW_TO_PLAY_TUTORIAL_ID)).toEqual([HOW_TO_PLAY_TUTORIAL_ID]);
    expect(markTutorialSeen([HOW_TO_PLAY_TUTORIAL_ID], HOW_TO_PLAY_TUTORIAL_ID)).toEqual([HOW_TO_PLAY_TUTORIAL_ID]);
  });

  // The same generic writer backs all three special-piece tutorials — proving
  // it here guards against the ids ever drifting from what Board.tsx passes.
  test('handles the special-piece tutorial ids exactly like any other id', () => {
    let seen = markTutorialSeen([], STRIPED_TUTORIAL_ID);
    seen = markTutorialSeen(seen, COLOR_BOMB_TUTORIAL_ID);
    seen = markTutorialSeen(seen, AREA_BOMB_TUTORIAL_ID);
    seen = markTutorialSeen(seen, STRIPED_TUTORIAL_ID); // re-dismiss is idempotent
    expect(seen).toEqual([STRIPED_TUTORIAL_ID, COLOR_BOMB_TUTORIAL_ID, AREA_BOMB_TUTORIAL_ID]);
  });
});

describe('findSpecialPieceTutorial', () => {
  test('no special piece on the board — returns undefined (shows nothing)', () => {
    const board = boardOf([
      [piece('a', 'tomato'), piece('b', 'lemon')],
      [piece('c', 'herb'), blockerPiece('d', 'cling')],
    ]);
    expect(findSpecialPieceTutorial(board, [])).toBeUndefined();
  });

  test('a striped piece the player has not seen — returns the striped tutorial and the piece', () => {
    const striped = stripedPiece('s', 'tomato');
    const board = boardOf([[piece('a', 'tomato'), striped]]);
    expect(findSpecialPieceTutorial(board, [])).toEqual({ id: STRIPED_TUTORIAL_ID, piece: striped });
  });

  test('a color bomb the player has not seen — returns the color-bomb tutorial', () => {
    const bomb = colorBombPiece('cb');
    const board = boardOf([[piece('a', 'tomato'), bomb]]);
    expect(findSpecialPieceTutorial(board, [])).toEqual({ id: COLOR_BOMB_TUTORIAL_ID, piece: bomb });
  });

  test('an area bomb the player has not seen — returns the area-bomb tutorial', () => {
    const bomb = areaBombPiece('ab');
    const board = boardOf([[piece('a', 'tomato'), bomb]]);
    expect(findSpecialPieceTutorial(board, [])).toEqual({ id: AREA_BOMB_TUTORIAL_ID, piece: bomb });
  });

  test('each special shows exactly once — a seen special is skipped even while on the board', () => {
    const striped = stripedPiece('s', 'tomato');
    const board = boardOf([[striped]]);
    expect(findSpecialPieceTutorial(board, [STRIPED_TUTORIAL_ID])).toBeUndefined();
  });

  test('dismissing one special does not suppress the others — color bomb still shows after striped seen', () => {
    const striped = stripedPiece('s', 'tomato');
    const bomb = colorBombPiece('cb');
    const board = boardOf([[striped, bomb]]);
    // Striped already dismissed; the un-seen color bomb is the next match.
    expect(findSpecialPieceTutorial(board, [STRIPED_TUTORIAL_ID])).toEqual({
      id: COLOR_BOMB_TUTORIAL_ID,
      piece: bomb,
    });
  });

  test('returns the first unseen special row-major when several are present', () => {
    const area = areaBombPiece('ab');
    const striped = stripedPiece('s', 'lemon');
    const board = boardOf([
      [piece('a', 'tomato'), area],
      [striped, piece('b', 'herb')],
    ]);
    // area bomb sits earlier in row-major order, so it wins even though the
    // SPECIAL_TUTORIAL_IDS list happens to name striped first.
    expect(findSpecialPieceTutorial(board, [])).toEqual({ id: AREA_BOMB_TUTORIAL_ID, piece: area });
  });

  test('all three seen — returns undefined even with every special on the board', () => {
    const board = boardOf([
      [stripedPiece('s', 'tomato'), colorBombPiece('cb')],
      [areaBombPiece('ab'), piece('a', 'lemon')],
    ]);
    const allSeen = [STRIPED_TUTORIAL_ID, COLOR_BOMB_TUTORIAL_ID, AREA_BOMB_TUTORIAL_ID];
    expect(findSpecialPieceTutorial(board, allSeen)).toBeUndefined();
  });
});

describe('shouldShowChainReactionTutorial', () => {
  // Unlike findSpecialPieceTutorial above, this isn't a board scan — the
  // specials that fired a chain reaction are already cleared by the time a
  // move settles, so there's no piece on the board to find. It's a plain
  // once-ever gate over the move's own applyMove-computed
  // ApplyMoveResult.multiSpecialFired (see engine/gameState.test.ts's
  // "multiSpecialFired" describe block for real board coverage of THAT
  // signal); this block only covers the gate function itself.
  test('the move fired 2+ specials together and the player has not seen it — shows', () => {
    expect(shouldShowChainReactionTutorial(true, [])).toBe(true);
  });

  test('the move fired 2+ specials together but the player already dismissed it — does not show again', () => {
    expect(shouldShowChainReactionTutorial(true, [CHAIN_REACTION_TUTORIAL_ID])).toBe(false);
  });

  test('the move only fired a single special (or none) — never shows, even if unseen', () => {
    expect(shouldShowChainReactionTutorial(false, [])).toBe(false);
  });

  test('dismissing the other three tutorials does not suppress this one — distinct id', () => {
    const seen = [STRIPED_TUTORIAL_ID, COLOR_BOMB_TUTORIAL_ID, AREA_BOMB_TUTORIAL_ID];
    expect(shouldShowChainReactionTutorial(true, seen)).toBe(true);
  });
});

const RECIPE_CARDS: RecipeCard[] = [
  { id: 'tomato_stew', title: 'Sunday Tomato Stew', flavorText: 'Simmered slow.', milestoneLevel: 1, sprite: 'recipe_tomato_stew.webp' },
  { id: 'herb_garden_salad', title: 'Herb Garden Salad', flavorText: 'Fresh off the sill.', milestoneLevel: 3, sprite: 'recipe_herb_garden_salad.webp' },
  { id: 'lemon_roast_chicken', title: 'Lemon Roast Chicken', flavorText: 'Worth the wait.', milestoneLevel: 6, sprite: 'recipe_lemon_roast_chicken.webp' },
];

describe('findRecipeCardForLevel', () => {
  test('returns the card whose milestoneLevel matches exactly', () => {
    expect(findRecipeCardForLevel(RECIPE_CARDS, 1)).toEqual(RECIPE_CARDS[0]);
    expect(findRecipeCardForLevel(RECIPE_CARDS, 3)).toEqual(RECIPE_CARDS[1]);
    expect(findRecipeCardForLevel(RECIPE_CARDS, 6)).toEqual(RECIPE_CARDS[2]);
  });

  test('is undefined for a level number that is not a milestone', () => {
    expect(findRecipeCardForLevel(RECIPE_CARDS, 2)).toBeUndefined();
    expect(findRecipeCardForLevel(RECIPE_CARDS, 4)).toBeUndefined();
    expect(findRecipeCardForLevel(RECIPE_CARDS, 500)).toBeUndefined();
  });

  test('is undefined for an empty recipe card list', () => {
    expect(findRecipeCardForLevel([], 1)).toBeUndefined();
  });
});

describe('unlockRecipeCard', () => {
  test('adds a new card id', () => {
    expect(unlockRecipeCard([], 'tomato_stew')).toEqual(['tomato_stew']);
  });

  test('is idempotent — replaying an already-unlocked milestone level does not duplicate it', () => {
    expect(unlockRecipeCard(['tomato_stew'], 'tomato_stew')).toEqual(['tomato_stew']);
  });

  test('preserves existing entries when adding a different id', () => {
    expect(unlockRecipeCard(['tomato_stew'], 'herb_garden_salad')).toEqual(['tomato_stew', 'herb_garden_salad']);
  });
});

// The real 9 curated milestone levels (see skins/lalas-kitchen/config.json)
// — used to answer the concrete "a save at level 28" recovery question, not
// just the 3-card RECIPE_CARDS fixture above.
const FULL_MILESTONES = [1, 3, 6, 10, 15, 21, 28, 36, 45];
const FULL_RECIPE_CARDS: RecipeCard[] = FULL_MILESTONES.map((lvl) => ({
  id: `card_${lvl}`,
  title: `Card ${lvl}`,
  flavorText: '',
  milestoneLevel: lvl,
  sprite: `recipe_${lvl}.webp`,
}));

describe('backfillUnlockedRecipeCards — one-time catch-up for pre-feature progress', () => {
  test('recovers every completed milestone when the unlocked list starts empty', () => {
    // The exact migration case: milestone levels 1/3/6 were won before the
    // recipe card system existed, so they sit in completedLevels with no
    // matching unlocked card.
    const result = backfillUnlockedRecipeCards(RECIPE_CARDS, [1, 3, 6], []);
    expect(result).toEqual(['tomato_stew', 'herb_garden_salad', 'lemon_roast_chicken']);
  });

  test('a brand-new save (no completed levels) backfills nothing and returns the same reference', () => {
    const unlocked: string[] = [];
    const result = backfillUnlockedRecipeCards(RECIPE_CARDS, [], unlocked);
    expect(result).toEqual([]);
    expect(result).toBe(unlocked); // no-op, not a fresh copy
  });

  test('completed non-milestone levels unlock nothing', () => {
    // 2/4/5 are completed but are not milestone levels — no card exists for
    // them, so the backfill must leave the unlocked list untouched.
    const unlocked: string[] = [];
    const result = backfillUnlockedRecipeCards(RECIPE_CARDS, [2, 4, 5], unlocked);
    expect(result).toEqual([]);
    expect(result).toBe(unlocked);
  });

  test('running the backfill twice in a row never duplicates a card', () => {
    const once = backfillUnlockedRecipeCards(RECIPE_CARDS, [1, 3, 6], []);
    const twice = backfillUnlockedRecipeCards(RECIPE_CARDS, [1, 3, 6], once);
    expect(twice).toEqual(['tomato_stew', 'herb_garden_salad', 'lemon_roast_chicken']);
    expect(twice).toBe(once); // second run is a pure no-op — same reference back
  });

  test('preserves cards already unlocked by the live flow and adds only the missing ones', () => {
    // tomato_stew was unlocked live; 3 and 6 predate the feature and need
    // recovering. Order follows the card list, appending the new ones.
    const result = backfillUnlockedRecipeCards(RECIPE_CARDS, [1, 3, 6], ['tomato_stew']);
    expect(result).toEqual(['tomato_stew', 'herb_garden_salad', 'lemon_roast_chicken']);
  });

  test('a save at level 28 recovers exactly the 6 milestones already completed (1,3,6,10,15,21)', () => {
    // Reaching level 28 through normal play means levels 1..27 are all in
    // completedLevels (each must be won to advance). Milestones <= 27:
    // 1,3,6,10,15,21 — six cards. Level 28's own card is NOT recovered here,
    // since being *at* level 28 means it hasn't been won/completed yet.
    const completedThrough27 = Array.from({ length: 27 }, (_, i) => i + 1);
    const result = backfillUnlockedRecipeCards(FULL_RECIPE_CARDS, completedThrough27, []);
    expect(result).toEqual(['card_1', 'card_3', 'card_6', 'card_10', 'card_15', 'card_21']);
    expect(result).toHaveLength(6);
  });

  test('if level 28 itself was also completed, its card is recovered too (7 total)', () => {
    const completedThrough28 = Array.from({ length: 28 }, (_, i) => i + 1);
    const result = backfillUnlockedRecipeCards(FULL_RECIPE_CARDS, completedThrough28, []);
    expect(result).toEqual(['card_1', 'card_3', 'card_6', 'card_10', 'card_15', 'card_21', 'card_28']);
    expect(result).toHaveLength(7);
  });
});
