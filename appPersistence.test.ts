import { BOARD_SHAPE_ROTATION, BOARD_SHAPE_TEMPLATES, playableCellRatio } from './engine/boardShapes';
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
  findSpreadWarningTutorial,
  SPREAD_WARNING_TUTORIAL_ID,
  findRecipeCardForLevel,
  STRIPED_TUTORIAL_ID,
  COLOR_BOMB_TUTORIAL_ID,
  AREA_BOMB_TUTORIAL_ID,
  BOARD_SHAPE_TUTORIAL_ID,
  shouldShowBoardShapeTutorial,
  generatedLevelSeed,
  generatedMovesLimit,
  generatedObjectiveCount,
  generatedLayerCells,
  generatedPieceTypeCount,
  generatedScoreTarget,
  generatedShapeId,
  generatedTargetCount,
  isClearanceObjectiveLevel,
  isScoreObjectiveLevel,
  grantInstantLife,
  livesAfterLoss,
  markLevelCompleted,
  markTutorialSeen,
  msUntilNextLifeRegen,
  recordLevelStars,
  resolveNextLevelIndex,
  resolveStartLevelIndex,
  resolveStartScreen,
  shouldShowBlockerTutorial,
  shouldShowChainReactionTutorial,
  CHAIN_REACTION_TUTORIAL_ID,
  shouldShowOnboardingTutorial,
  HOW_TO_PLAY_TUTORIAL_ID,
  startingLives,
  unlockRecipeCard,
  BREATHER_LOSS_THRESHOLD,
  consecutiveLossesAfterLoss,
  shouldApplyBreather,
  TUTORIAL_MIN_GAP_MS,
  canShowTutorialNow,
  shouldActivateTutorial,
} from './appPersistence';
import { RecipeCard } from './components/skinConfig';
import { StarRating } from './components/wonActions';

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

function voidPiece(id: string): Piece {
  return { id, type: 'void' };
}

// A cell the denial-zone spread mechanic has just marked with its transient
// warning flag (see engine/gameState.ts's stepDenialZone) — still an
// ordinary, matchable piece, just carrying `spreadWarning: true`.
function spreadWarningPiece(id: string, matchType: string): Piece {
  return { id, type: 'normal', matchType, spreadWarning: true };
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
      await saveProgress(skinId, buildSaveData(skinId, 1, [], {}, [], [], false, false, state), storage);
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

describe('recordLevelStars', () => {
  test('records a first-ever rating for a level', () => {
    expect(recordLevelStars({}, 3, 2)).toEqual({ 3: 2 });
  });

  test('a better replay overwrites the stored rating', () => {
    expect(recordLevelStars({ 3: 1 }, 3, 3)).toEqual({ 3: 3 });
  });

  test('a worse replay never overwrites an already-earned higher rating', () => {
    expect(recordLevelStars({ 3: 3 }, 3, 1)).toEqual({ 3: 3 });
  });

  test('an equal replay is a no-op', () => {
    const before: Record<number, StarRating> = { 3: 2 };
    expect(recordLevelStars(before, 3, 2)).toEqual({ 3: 2 });
  });

  test('returns the same reference when the attempt does not improve on the record', () => {
    const before: Record<number, StarRating> = { 3: 3 };
    expect(recordLevelStars(before, 3, 1)).toBe(before);
  });

  test('leaves other levels\' recorded stars untouched', () => {
    expect(recordLevelStars({ 1: 3, 2: 2 }, 5, 1)).toEqual({ 1: 3, 2: 2, 5: 1 });
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

  test('a shaped board (playableRatio < 1) scales moves down proportionally', () => {
    // levelNumber 1 -> 24 full-board moves; a 90%-playable board should ask
    // for ~90% of that, not the unscaled full-board number. (A lower ratio
    // like cut_corners' real 70% would round below the MIN_MOVES floor here
    // and get pulled back up to 18 — see the floor test below — so this uses
    // a ratio that stays clear of the floor to isolate the scaling itself.)
    expect(generatedMovesLimit(1, 0.9)).toBe(Math.round(24 * 0.9));
  });

  test('the MIN_MOVES floor still holds after scaling down for a shape', () => {
    // A real ring level (55% playable) at a levelNumber already pinned to the
    // 18-move floor must not drop below it just because playableRatio < 1.
    expect(generatedMovesLimit(500, 0.55)).toBe(18);
  });

  test('playableRatio 1 (a plain rectangle) is a no-op — same as omitting it', () => {
    expect(generatedMovesLimit(5, 1)).toBe(generatedMovesLimit(5));
  });

  test('breather grants ~30% more moves than the same level would normally get', () => {
    const normal = generatedMovesLimit(500);
    const breather = generatedMovesLimit(500, 1, true);
    expect(breather).toBeGreaterThan(normal);
    expect(breather).toBe(Math.round(normal * 1.3));
  });

  test('breather composes with a shaped board\'s playableRatio scaling', () => {
    expect(generatedMovesLimit(500, 0.55, true)).toBe(Math.max(18, Math.round(18 * 0.55 * 1.3)));
  });

  test('breather defaults off — omitting it matches passing false explicitly', () => {
    expect(generatedMovesLimit(10)).toBe(generatedMovesLimit(10, 1, false));
  });
});

describe('generatedTargetCount', () => {
  test('grows a little each level, capped at 26', () => {
    expect(generatedTargetCount(1)).toBe(21);
    expect(generatedTargetCount(6)).toBe(26);
    expect(generatedTargetCount(500)).toBe(26);
  });

  test('a shaped board (playableRatio < 1) scales the target down proportionally', () => {
    // levelNumber 6 -> 26 full-board target; a 70%-playable board should ask
    // for ~70% of that.
    expect(generatedTargetCount(6, 0.7)).toBe(Math.round(26 * 0.7));
  });

  test('the MIN_TARGET floor holds even for a severely reduced board', () => {
    expect(generatedTargetCount(1, 0.1)).toBe(10);
  });

  test('playableRatio 1 (a plain rectangle) is a no-op — same as omitting it', () => {
    expect(generatedTargetCount(10, 1)).toBe(generatedTargetCount(10));
  });

  test('breather asks for ~30% fewer pieces than the same level would normally require', () => {
    const normal = generatedTargetCount(500);
    const breather = generatedTargetCount(500, 1, true);
    expect(breather).toBeLessThan(normal);
    expect(breather).toBe(Math.round(normal * 0.7));
  });

  test('the MIN_TARGET floor still holds under a breather on a severely reduced board', () => {
    expect(generatedTargetCount(1, 0.1, true)).toBe(10);
  });

  test('breather defaults off — omitting it matches passing false explicitly', () => {
    expect(generatedTargetCount(10)).toBe(generatedTargetCount(10, 1, false));
  });
});

describe('shouldApplyBreather / consecutiveLossesAfterLoss', () => {
  test('increments by exactly one per loss', () => {
    expect(consecutiveLossesAfterLoss(0)).toBe(1);
    expect(consecutiveLossesAfterLoss(1)).toBe(2);
    expect(consecutiveLossesAfterLoss(5)).toBe(6);
  });

  test('no breather on a single loss', () => {
    expect(shouldApplyBreather(1, 20, 7)).toBe(false);
  });

  test('breather kicks in once losses reach the threshold, on a generated level', () => {
    expect(BREATHER_LOSS_THRESHOLD).toBe(2);
    expect(shouldApplyBreather(2, 20, 7)).toBe(true);
    expect(shouldApplyBreather(3, 20, 7)).toBe(true);
  });

  test('never applies to a hand-built level, no matter how long the streak', () => {
    expect(shouldApplyBreather(10, 5, 7)).toBe(false);
    expect(shouldApplyBreather(10, 7, 7)).toBe(false);
  });

  test('applies to the very first generated level past the hand-built queue', () => {
    expect(shouldApplyBreather(2, 8, 7)).toBe(true);
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

describe('isScoreObjectiveLevel', () => {
  test('no score objective below the threshold', () => {
    expect(isScoreObjectiveLevel(1)).toBe(false);
    expect(isScoreObjectiveLevel(2)).toBe(false);
  });

  test('on-cadence levels starting at the threshold (3, then every 3rd)', () => {
    expect(isScoreObjectiveLevel(3)).toBe(true);
    expect(isScoreObjectiveLevel(6)).toBe(true);
    expect(isScoreObjectiveLevel(9)).toBe(true);
  });

  test('off-cadence levels get no score objective', () => {
    for (const levelNumber of [4, 5, 7, 8, 10, 11]) {
      expect(isScoreObjectiveLevel(levelNumber)).toBe(false);
    }
  });

  test('is deterministic — the same levelNumber always returns the same answer', () => {
    expect(isScoreObjectiveLevel(6)).toBe(isScoreObjectiveLevel(6));
  });
});

describe('generatedScoreTarget', () => {
  test('scales with the level\'s own (unscaled) moves limit, calibrated against Score Rush\'s 1000/24 density', () => {
    // levelNumber 1 -> generatedMovesLimit(1) = 24 (BASE_MOVES, no step yet).
    expect(generatedScoreTarget(1)).toBe(Math.round(24 * (1000 / 24)));
  });

  test('a shaped board (playableRatio < 1) scales the target down through generatedMovesLimit\'s own scaling', () => {
    // Not a clean "* ratio" relationship end to end — generatedMovesLimit
    // has its own MIN_MOVES floor (18), so the real expected value is
    // derived from calling it directly, not assumed via simple arithmetic.
    const full = generatedScoreTarget(1);
    const shaped = generatedScoreTarget(1, 0.7);
    expect(shaped).toBeLessThan(full);
    expect(shaped).toBe(Math.round(generatedMovesLimit(1, 0.7) * (1000 / 24)));
  });

  test('a severely reduced board still floors at generatedMovesLimit\'s own MIN_MOVES-derived value, never lower', () => {
    // generatedMovesLimit(1, 0.05) itself floors at MIN_MOVES (18) regardless
    // of how small playableRatio gets, so generatedScoreTarget's own floor is
    // inherited from that, not a separate constant of its own.
    expect(generatedScoreTarget(1, 0.05)).toBe(Math.round(generatedMovesLimit(1, 0.05) * (1000 / 24)));
    expect(generatedMovesLimit(1, 0.05)).toBe(18);
  });

  test('breather asks for ~30% fewer points, calibrated against the UNSCALED moves limit — not cancelled out by breather\'s own +30% moves boost', () => {
    const normal = generatedScoreTarget(500);
    const breather = generatedScoreTarget(500, 1, true);
    expect(breather).toBeLessThan(normal);
    expect(breather).toBe(Math.round(normal * 0.7));
  });

  test('breather defaults off — omitting it matches passing false explicitly', () => {
    expect(generatedScoreTarget(10)).toBe(generatedScoreTarget(10, 1, false));
  });
});

describe('isClearanceObjectiveLevel', () => {
  test('no clearance objective below the threshold', () => {
    expect(isClearanceObjectiveLevel(1)).toBe(false);
    expect(isClearanceObjectiveLevel(4)).toBe(false);
  });

  test('on-cadence levels starting at the threshold (5, then every 4th)', () => {
    expect(isClearanceObjectiveLevel(5)).toBe(true);
    expect(isClearanceObjectiveLevel(9)).toBe(true);
    expect(isClearanceObjectiveLevel(13)).toBe(true);
  });

  test('off-cadence levels get no clearance objective', () => {
    for (const levelNumber of [6, 7, 8, 10, 11, 12]) {
      expect(isClearanceObjectiveLevel(levelNumber)).toBe(false);
    }
  });
});

describe('generatedLayerCells', () => {
  test('picks a density matching the hand-built "Dusty Counter" ratio (6 of 40 cells, on the same 8x5 board size)', () => {
    const cells = generatedLayerCells(5, 8, 5);
    expect(cells).toHaveLength(6);
  });

  test('a third of the chosen cells get 2 layers, the rest get 1 — matching Dusty Counter\'s own split', () => {
    const cells = generatedLayerCells(5, 8, 5);
    expect(cells.filter((c) => c.layers === 2)).toHaveLength(2);
    expect(cells.filter((c) => c.layers === 1)).toHaveLength(4);
  });

  test('never places a layer on a void cell', () => {
    const voidCells = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ];
    const cells = generatedLayerCells(5, 8, 5, voidCells);
    const voidKeys = new Set(voidCells.map((p) => `${p.row},${p.col}`));
    for (const cell of cells) {
      expect(voidKeys.has(`${cell.position.row},${cell.position.col}`)).toBe(false);
    }
  });

  test('is deterministic — the same inputs always yield the same cells', () => {
    expect(generatedLayerCells(7, 8, 5)).toEqual(generatedLayerCells(7, 8, 5));
  });

  test('different levelNumbers yield different cell selections (offset shifts, not identical every time)', () => {
    expect(generatedLayerCells(5, 8, 5)).not.toEqual(generatedLayerCells(9, 8, 5));
  });
});

describe('generatedShapeId', () => {
  // SHAPE_ROTATION_OFFSET (1) shifts the rotation's starting point by one
  // step, so the very first shaped level lands on BOARD_SHAPE_ROTATION[1]
  // (plus), not [0] (cut_corners) — closing the coincidental back-to-back
  // repeat with hand-built level 7 "Pantry Corners", which also uses
  // cut_corners (see appPersistence.ts's SHAPE_ROTATION_OFFSET doc).
  test('a shape appears at the very first generated level — threshold is now 1', () => {
    expect(generatedShapeId(1)).toBe(BOARD_SHAPE_ROTATION[1]);
  });

  test('off-cadence levels get no shape (1 in 2, half of all generated levels)', () => {
    // Threshold is 1, cadence is 2 -> odd levelNumbers are on-cadence, even are not.
    for (const levelNumber of [2, 4, 6, 8, 10]) {
      expect(generatedShapeId(levelNumber)).toBeUndefined();
    }
  });

  test('rotates through every template in BOARD_SHAPE_ROTATION order across successive on-cadence levels, offset by one', () => {
    const onCadenceLevels = [1, 3, 5, 7, 9, 11];
    const seen = onCadenceLevels.map((levelNumber) => generatedShapeId(levelNumber));
    expect(seen).toEqual([
      BOARD_SHAPE_ROTATION[1],
      BOARD_SHAPE_ROTATION[2],
      BOARD_SHAPE_ROTATION[0],
      BOARD_SHAPE_ROTATION[1],
      BOARD_SHAPE_ROTATION[2],
      BOARD_SHAPE_ROTATION[0],
    ]);
  });

  test('is deterministic — the same levelNumber always returns the same shape', () => {
    expect(generatedShapeId(3)).toBe(generatedShapeId(3));
  });

  test('a levelNumber below 1 (defensive — never reached by real generated levels) still yields no shape', () => {
    expect(generatedShapeId(0)).toBeUndefined();
  });
});

describe('buildGeneratedLevelConfig', () => {
  test('builds a full LevelConfig (minus lives) for the first level past the hand-built queue', () => {
    // Generated level number 1 -> minimal 3-type pool (see
    // generatedPieceTypeCount), which is below MIN_TYPES_FOR_SECOND_OBJECTIVE,
    // so this is still a single-objective level — an array of length one,
    // not a special case. SHAPE_MIN_LEVEL_NUMBER is now 1, so this very first
    // generated level is also shaped (rotation[1], plus at 8x6 — offset by
    // SHAPE_ROTATION_OFFSET to avoid repeating Pantry Corners' cut_corners) —
    // movesLimit/targetCount are computed via the real playableRatio-scaled
    // helpers rather than hand-typed, so this test can't silently drift from
    // the actual scaling formula the way a hardcoded number would.
    const config = buildGeneratedLevelConfig(4, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    const voidCells = BOARD_SHAPE_TEMPLATES[BOARD_SHAPE_ROTATION[1]](8, 6);
    const ratio = playableCellRatio(8, 6, voidCells);
    expect(config).toEqual({
      seed: 301,
      rows: 8,
      cols: 6,
      pieceTypeIds: ['A', 'B', 'C'],
      movesLimit: generatedMovesLimit(1, ratio),
      objectives: [{ targetMatchType: 'A', targetCount: generatedTargetCount(1, ratio) }],
      voidCells,
    });
  });

  test('grows the piece-type pool and shares the target total across two objectives', () => {
    // Level 10 -> generated level number 7 -> 3 + floor(6/3) = 5 types,
    // which clears MIN_TYPES_FOR_SECOND_OBJECTIVE (5), so this level now
    // asks for two distinct objectives. This level is also shaped (rotation[1]
    // — level 7's steps-since-threshold, 6, floors to 3, offset by
    // SHAPE_ROTATION_OFFSET (1) to (3+1)%3 = 1 — at the same 8x6 board, same
    // ratio as the test above), so the shared total below is
    // generatedTargetCount(7, ratio), not the unscaled 26 a plain rectangle
    // would get. That total is the TOTAL burden shared across the
    // objectives, not a per-objective quota — divided by 2, not doubled.
    // An earlier version of this test asserted the doubled total and so
    // enshrined the compounding bug (a two-objective level demanding double
    // an equivalent single-objective one) as intended behavior — see
    // engine/DECISIONS.md's target-sharing entry.
    const config = buildGeneratedLevelConfig(10, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    const voidCells = BOARD_SHAPE_TEMPLATES[BOARD_SHAPE_ROTATION[1]](8, 6);
    const ratio = playableCellRatio(8, 6, voidCells);
    const perObjective = Math.ceil(generatedTargetCount(7, ratio) / 2);
    expect(config.pieceTypeIds).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(config.objectives).toEqual([
      { targetMatchType: 'B', targetCount: perObjective },
      { targetMatchType: 'C', targetCount: perObjective },
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
    // regardless of how the piece-type pool has shrunk by that point. Both
    // 'score' and 'clearance' objectives only ever appear alone
    // (objectiveCount === 1 — see isScoreObjectiveLevel/
    // isClearanceObjectiveLevel's own comments), so neither can ever be the
    // duplicate-target case this test actually guards; skip them rather
    // than asserting on their (deliberately absent) targetMatchType.
    for (let levelIndex = 4; levelIndex <= 60; levelIndex++) {
      const config = buildGeneratedLevelConfig(levelIndex, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
      if (config.objectives.length === 1 && (config.objectives[0].type === 'score' || config.objectives[0].type === 'clearance')) continue;
      const targetTypes = config.objectives.map((o) => {
        // Only reachable for a level NOT skipped above — i.e. objectiveCount
        // 2 or a single 'collect' entry — so a 'score'/'clearance'/'escort'
        // entry here would itself be the bug (see isScoreObjectiveLevel's
        // own "only ever alone" invariant). buildGeneratedLevelConfig never
        // produces 'escort' at all today (see DEFERRED_COMPLEXITY.md), but
        // the check is here defensively, matching the other two.
        if (o.type === 'clearance' || o.type === 'score' || o.type === 'escort') {
          throw new Error(`unexpected ${o.type}-type objective in a multi-objective scan`);
        }
        return o.targetMatchType;
      });
      expect(new Set(targetTypes).size).toBe(targetTypes.length);
    }
  });

  test('places a real score objective on an on-cadence, single-objective level', () => {
    // levelIndex 6, handBuiltLevelCount 3 -> levelNumber 3 -> on-cadence
    // (isScoreObjectiveLevel(3) === true) and still single-objective
    // (typeCount well below MIN_TYPES_FOR_SECOND_OBJECTIVE at levelNumber 3).
    // levelNumber 3 is also shaped (generatedShapeId(3) is on-cadence too),
    // so the expected target must go through the same real playableRatio a
    // plain-rectangle assumption would silently get wrong — same approach
    // the "builds a full LevelConfig" test above uses.
    const config = buildGeneratedLevelConfig(6, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    const shapeId = generatedShapeId(3);
    const voidCells = shapeId ? BOARD_SHAPE_TEMPLATES[shapeId](8, 6) : undefined;
    const ratio = playableCellRatio(8, 6, voidCells);
    expect(config.objectives).toEqual([{ type: 'score', targetCount: generatedScoreTarget(3, ratio) }]);
  });

  test('an off-cadence level stays plain collect, unaffected', () => {
    // levelNumber 4 (levelIndex 7) — one past the score-cadence level 3, off
    // the SCORE_OBJECTIVE_CADENCE (3) rotation.
    const config = buildGeneratedLevelConfig(7, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    expect(config.objectives[0].type).not.toBe('score');
    expect(config.objectives[0]).toHaveProperty('targetMatchType');
  });

  test('a score objective never coexists with a second objective, even on an on-cadence multi-objective level', () => {
    // levelNumber 9 (levelIndex 12) is on-cadence (9 - 3 = 6, divisible by
    // 3) AND past the two-objective threshold (typeCount >= 5 at
    // levelNumber >= 7) — confirms objectiveCount === 1 always wins the
    // guard, so this level stays a real two-objective 'collect' level, not
    // a lone 'score' one.
    const config = buildGeneratedLevelConfig(12, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    expect(config.objectives).toHaveLength(2);
    expect(config.objectives.every((o) => o.type === undefined || o.type === 'collect')).toBe(true);
  });

  test('a score-objective level still gets its blockers/shape exactly like a collect level would', () => {
    const blockers = [{ id: 'cling', hitsToClear: 1 }];
    const scoreLevel = buildGeneratedLevelConfig(6, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6, blockers);
    expect(scoreLevel.objectives[0].type).toBe('score');
    expect(scoreLevel.blockerCount).toBeGreaterThan(0);
    expect(scoreLevel.blockerMatchType).toBe('cling');
  });

  test('places a real clearance objective with real layerCells on an on-cadence, single-objective level', () => {
    // levelIndex 8, handBuiltLevelCount 3 -> levelNumber 5: on-cadence for
    // clearance (isClearanceObjectiveLevel(5) === true) but NOT for score
    // ((5-3)%3 !== 0), and still single-objective.
    const config = buildGeneratedLevelConfig(8, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    expect(config.objectives).toEqual([{ type: 'clearance' }]);
    expect(config.layerCells).toBeDefined();
    expect(config.layerCells!.length).toBeGreaterThan(0);
  });

  test('a clearance-objective level gets NO blockers even when the blocker rotation would otherwise place them', () => {
    // Same levelNumber 5 as above; generatedBlockerCount(5) would normally
    // be 2 with a real eligible blocker in the pool — confirms the
    // clearance-level override actually suppresses it, not just that a
    // blocker-less pool was passed.
    const blockers = [{ id: 'cling', hitsToClear: 1 }];
    const config = buildGeneratedLevelConfig(8, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6, blockers);
    expect(config.objectives).toEqual([{ type: 'clearance' }]);
    expect(config.blockerCount).toBeUndefined();
    expect(config.blockerMatchType).toBeUndefined();
  });

  test('a clearance-objective level still gets its board shape, and layerCells avoid every void cell', () => {
    // levelNumber 5 is also shaped (generatedShapeId(5) is on-cadence too) —
    // confirms layerCells and voidCells never collide on the real generated
    // voidCells, not just the synthetic ones generatedLayerCells' own unit
    // tests use.
    const config = buildGeneratedLevelConfig(8, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    expect(config.voidCells).toBeDefined();
    expect(config.voidCells!.length).toBeGreaterThan(0);
    const voidKeys = new Set(config.voidCells!.map((p) => `${p.row},${p.col}`));
    for (const cell of config.layerCells!) {
      expect(voidKeys.has(`${cell.position.row},${cell.position.col}`)).toBe(false);
    }
  });

  test('an off-cadence level stays plain collect, unaffected by the clearance gate', () => {
    // levelNumber 6 (levelIndex 9) — one past clearance's threshold (5), off
    // its cadence (4).
    const config = buildGeneratedLevelConfig(9, 3, ['A', 'B', 'C', 'D', 'E', 'F'], 8, 6);
    expect(config.objectives[0].type).not.toBe('clearance');
    expect(config.layerCells).toBeUndefined();
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
      if (objective.type === 'score' || objective.type === 'clearance' || objective.type === 'escort') {
        throw new Error(`generated objective should never be ${objective.type}-type`);
      }
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

  // "Blocker depth" (see engine/DECISIONS.md's blocker-depth entry):
  // sealed_jar is gated even later than pot_lid (12 vs. 7).
  const ALL_BLOCKERS_WITH_SEALED_JAR = [
    ...ALL_BLOCKERS,
    { id: 'sealed_jar', hitsToClear: 1, specialOnly: true },
  ];

  test('never places sealed_jar below its difficulty threshold (level 12), even once pot_lid is already eligible', () => {
    // levelIndex 14..20 -> generated level number 11..17? No — HAND_BUILT_COUNT
    // is 3, so levelIndex 14 -> level 11 (below 12), levelIndex 15 -> level 12
    // would already be eligible, so scan strictly below: levelIndex 4..16 ->
    // level 1..13. Restrict to levels 1..11 (levelIndex 4..14).
    for (let levelIndex = 4; levelIndex <= 14; levelIndex++) {
      const config = buildGeneratedLevelConfig(
        levelIndex,
        HAND_BUILT_COUNT,
        PIECE_TYPES,
        8,
        6,
        ALL_BLOCKERS_WITH_SEALED_JAR
      );
      expect(config.blockerMatchType).not.toBe('sealed_jar');
      expect(config.blockerSpecialOnly).toBeUndefined();
    }
  });

  test('can place sealed_jar once past its difficulty threshold, and it carries blockerSpecialOnly', () => {
    let foundSealedJar = false;
    for (let levelIndex = 15; levelIndex <= 30; levelIndex++) {
      const config = buildGeneratedLevelConfig(
        levelIndex,
        HAND_BUILT_COUNT,
        PIECE_TYPES,
        8,
        6,
        ALL_BLOCKERS_WITH_SEALED_JAR
      );
      if (config.blockerMatchType === 'sealed_jar') {
        foundSealedJar = true;
        expect(config.blockerSpecialOnly).toBe(true);
      } else if (config.blockerMatchType !== undefined) {
        // Every OTHER blocker id must never carry the flag — it's specific
        // to sealed_jar's own skin-config entry, not a generic default.
        expect(config.blockerSpecialOnly).toBeUndefined();
      }
    }
    expect(foundSealedJar).toBe(true);
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

  test('voidCells appear at the very first generated level and match the curated template exactly', () => {
    // levelIndex 4 -> generated level number 1 (HAND_BUILT_COUNT is 3) ->
    // SHAPE_MIN_LEVEL_NUMBER is now 1, so this is on-cadence from the start —
    // but SHAPE_ROTATION_OFFSET (1) shifts the starting index, landing on
    // rotation[1] ('plus') rather than rotation[0] ('cut_corners'), closing
    // the coincidental repeat with hand-built Pantry Corners.
    const config = buildGeneratedLevelConfig(4, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, []);
    expect(config.voidCells).toEqual(BOARD_SHAPE_TEMPLATES[BOARD_SHAPE_ROTATION[1]](8, 6));
  });

  test('off-cadence levels get no voidCells (1 in 2, half of all generated levels)', () => {
    // levelIndex 5, 7, 9 -> generated level number 2, 4, 6 — even numbers are
    // off-cadence under SHAPE_CADENCE = 2.
    for (const levelIndex of [5, 7, 9]) {
      const config = buildGeneratedLevelConfig(levelIndex, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, []);
      expect(config.voidCells).toBeUndefined();
    }
  });

  test('a shaped level composes freely with blockers — voidCells are set independent of blocker gating', () => {
    // levelIndex 6 -> generated level number 3: still on-cadence (rotation
    // index 2, 'ring' — offset by SHAPE_ROTATION_OFFSET) and past blockers'
    // own INTRODUCE_AT_LEVEL (3), so both are genuinely active on the same
    // level, not just one or the other.
    const config = buildGeneratedLevelConfig(6, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, ALL_BLOCKERS);
    expect(config.voidCells).toEqual(BOARD_SHAPE_TEMPLATES[BOARD_SHAPE_ROTATION[2]](8, 6));
    expect(config.blockerCount).toBeGreaterThan(0);
  });

  // Regression guard for a real playtest report: a `ring`-shaped generated
  // level (55% playable at this project's actual fixed 8x5 board size) felt
  // unfair, because movesLimit/objectives were computed purely from
  // levelNumber with zero awareness of how many cells the shape had just
  // removed. This locks in that a shaped level's target/moves are now
  // genuinely lower than an equivalent-levelNumber plain rectangle would get
  // — not just present but numerically smaller, which is the actual fix.
  test('a shaped level asks for proportionally less than an equivalent plain rectangle', () => {
    // levelIndex 4 -> generated level number 1 -> the first on-cadence shape
    // (BOARD_SHAPE_ROTATION[1], offset by SHAPE_ROTATION_OFFSET) at 8x6.
    // Compare against the same levelIndex
    // with no blockers/skin content that would carve voidCells (there's no
    // "force no shape" knob, so instead compare the shaped config directly
    // against generatedMovesLimit/generatedTargetCount's own unscaled values,
    // which is exactly what a plain rectangle at this levelNumber would get).
    const shaped = buildGeneratedLevelConfig(4, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, []);
    const rows = 8;
    const cols = 6;
    const voidCells = shaped.voidCells ?? [];
    expect(voidCells.length).toBeGreaterThan(0); // sanity: this level really is shaped
    const ratio = (rows * cols - voidCells.length) / (rows * cols);
    expect(ratio).toBeLessThan(1);

    const unscaledMoves = generatedMovesLimit(1);
    const unscaledTarget = generatedTargetCount(1);
    expect(shaped.movesLimit).toBeLessThan(unscaledMoves);
    // buildGeneratedLevelConfig never produces a 'clearance'/'escort'
    // objective today (see DEFERRED_COMPLEXITY.md), neither of which has a
    // hand-authored targetCount — this guard documents that invariant
    // rather than assuming targetCount exists on every union member.
    const totalTarget = shaped.objectives.reduce(
      (sum, o) => sum + (o.type === 'clearance' || o.type === 'escort' ? 0 : o.targetCount),
      0
    );
    expect(totalTarget).toBeLessThan(unscaledTarget);

    // And it matches the scaled functions directly — buildGeneratedLevelConfig
    // isn't applying some separate, undocumented scaling of its own.
    expect(shaped.movesLimit).toBe(generatedMovesLimit(1, ratio));
  });

  test('a generated shaped level produces a real, match-free, playable board through the full pipeline', () => {
    // End-to-end through createGameState (engine/gameState.ts), not just the
    // config object — confirms the curated template's voidCells genuinely
    // reach generateLevel and produce a legally playable shaped board, the
    // same guarantee a hand-built shaped level gets. levelIndex 6 -> generated
    // level number 3, same shaped-and-blockered level as the composability
    // test above (rotation index 2, 'ring').
    const config = buildGeneratedLevelConfig(6, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, ALL_BLOCKERS);
    const state = createGameState({ ...config, lives: 5 });
    const voidCells = BOARD_SHAPE_TEMPLATES[BOARD_SHAPE_ROTATION[2]](8, 6);
    // Every requested void position genuinely holds a void, not a blocker or
    // an ordinary piece — this alone also proves no blocker landed on one,
    // since a cell can't be both 'void' and 'blocker' at once.
    for (const { row, col } of voidCells) {
      expect(state.board[row][col].type).toBe('void');
    }
    expect(state.board.flat().some((p) => p.type === 'blocker')).toBe(true);
  });

  test('breather=true produces a genuinely easier level than the same levelIndex normally gets', () => {
    // levelIndex 40 -> generated level number 37, well past every ramp floor/
    // cap (movesLimit floors at 13, targetCount caps at 6) — exactly the
    // "flatlined" range a real losing streak would occur in.
    const normal = buildGeneratedLevelConfig(40, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, []);
    const breather = buildGeneratedLevelConfig(40, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, [], true);
    expect(breather.movesLimit).toBeGreaterThan(normal.movesLimit);
    // buildGeneratedLevelConfig never produces a 'clearance' objective (only
    // 'collect'/'score', both of which carry targetCount) — see this file's
    // other buildGeneratedLevelConfig tests on this same point.
    const sumTargets = (objectives: typeof normal.objectives) =>
      objectives.reduce((sum, o) => sum + (o as { targetCount: number }).targetCount, 0);
    expect(sumTargets(breather.objectives)).toBeLessThan(sumTargets(normal.objectives));
  });

  test('breather never changes anything other than movesLimit/targetCount — same seed, shape, blockers', () => {
    const normal = buildGeneratedLevelConfig(40, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, ALL_BLOCKERS);
    const breather = buildGeneratedLevelConfig(40, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, ALL_BLOCKERS, true);
    expect(breather.seed).toBe(normal.seed);
    expect(breather.pieceTypeIds).toEqual(normal.pieceTypeIds);
    expect(breather.voidCells).toEqual(normal.voidCells);
    expect(breather.blockerCount).toBe(normal.blockerCount);
    expect(breather.blockerMatchType).toBe(normal.blockerMatchType);
    expect(breather.denialSpread).toBe(normal.denialSpread);
  });

  test('breather defaults off — omitting it matches passing false explicitly', () => {
    const omitted = buildGeneratedLevelConfig(40, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, []);
    const explicit = buildGeneratedLevelConfig(40, HAND_BUILT_COUNT, PIECE_TYPES, 8, 6, [], false);
    expect(omitted).toEqual(explicit);
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
    const data = buildSaveData('skin', 1, [], {}, [], [], false, false, { lives: 3 }, 1234567, fixedNow);
    expect(data.livesLastRegenAt).toBe(1234567);
    expect(data.lives).toBe(3);
  });

  test('falls back to now() when no explicit anchor is given, unchanged from before regen math existed', () => {
    const fixedNow = () => 9999999;
    const data = buildSaveData('skin', 1, [], {}, [], [], false, false, { lives: 3 }, undefined, fixedNow);
    expect(data.livesLastRegenAt).toBe(9999999);
  });

  test('writes the seenTutorials list passed in', () => {
    const data = buildSaveData('skin', 1, [], {}, ['blocker'], [], false, false, { lives: 3 });
    expect(data.seenTutorials).toEqual(['blocker']);
  });

  test('writes the unlockedRecipeCards list passed in', () => {
    const data = buildSaveData('skin', 1, [], {}, [], ['tomato_stew'], false, false, { lives: 3 });
    expect(data.unlockedRecipeCards).toEqual(['tomato_stew']);
  });

  test('writes the levelStars map passed in', () => {
    const data = buildSaveData('skin', 1, [], { 1: 3, 2: 1 }, [], [], false, false, { lives: 3 });
    expect(data.levelStars).toEqual({ 1: 3, 2: 1 });
  });
});

describe('buildSaveData — sound/haptics flags', () => {
  test('writes soundEnabled through unchanged', () => {
    const data = buildSaveData('skin', 1, [], {}, [], [], true, false, { lives: 3 });
    expect(data.soundEnabled).toBe(true);
  });

  test('writes hapticsEnabled through unchanged', () => {
    const data = buildSaveData('skin', 1, [], {}, [], [], false, true, { lives: 3 });
    expect(data.hapticsEnabled).toBe(true);
  });
});

describe('buildSaveData — consecutiveLosses (difficulty breather)', () => {
  test('writes the explicitly-passed streak through unchanged', () => {
    const data = buildSaveData('skin', 1, [], {}, [], [], false, false, { lives: 3 }, undefined, Date.now, 2);
    expect(data.consecutiveLosses).toBe(2);
  });

  test('defaults to 0 when omitted, same as every other pre-existing call site', () => {
    const data = buildSaveData('skin', 1, [], {}, [], [], false, false, { lives: 3 });
    expect(data.consecutiveLosses).toBe(0);
  });
});

describe('buildSaveData — lastCrash passthrough', () => {
  // The whole point: an ordinary gameplay save (soundEnabled toggle,
  // tutorial dismiss, etc.) must not silently drop a crash record recordCrash
  // wrote via a completely different code path — see engine/gameState.ts's
  // recordCrash and App.tsx's lastCrashRef.
  test('writes the explicitly-passed lastCrash through unchanged', () => {
    const crash = { message: 'boom', timestamp: 123 };
    const data = buildSaveData('skin', 1, [], {}, [], [], false, false, { lives: 3 }, undefined, Date.now, 0, crash);
    expect(data.lastCrash).toEqual(crash);
  });

  test('defaults to undefined when omitted, same as every other pre-existing call site', () => {
    const data = buildSaveData('skin', 1, [], {}, [], [], false, false, { lives: 3 });
    expect(data.lastCrash).toBeUndefined();
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

describe('shouldShowBoardShapeTutorial', () => {
  test('true when the board has a void cell and the tutorial has never been seen', () => {
    const board = boardOf([[piece('a', 'tomato'), voidPiece('v')]]);
    expect(shouldShowBoardShapeTutorial(board, [])).toBe(true);
  });

  test('false when the board has a void cell but the tutorial was already dismissed', () => {
    const board = boardOf([[piece('a', 'tomato'), voidPiece('v')]]);
    expect(shouldShowBoardShapeTutorial(board, [BOARD_SHAPE_TUTORIAL_ID])).toBe(false);
  });

  test('false on a plain rectangular board with no void cells, regardless of seenTutorials', () => {
    const board = boardOf([[piece('a', 'tomato'), piece('b', 'lemon')]]);
    expect(shouldShowBoardShapeTutorial(board, [])).toBe(false);
  });

  test('a blocker alone does not count as a board shape', () => {
    const board = boardOf([[piece('a', 'tomato'), blockerPiece('d', 'cling')]]);
    expect(shouldShowBoardShapeTutorial(board, [])).toBe(false);
  });

  test('dismissing the blocker tutorial does not suppress this one — distinct id', () => {
    const board = boardOf([[voidPiece('v')]]);
    expect(shouldShowBoardShapeTutorial(board, [BLOCKER_TUTORIAL_ID])).toBe(true);
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

  // Same proof for the two newest tutorial ids — board_shape (mount-time) and
  // spread_warning (post-move) — both flow through this exact same generic
  // writer, no special-casing needed for either.
  test('handles board_shape and spread_warning exactly like any other id', () => {
    let seen = markTutorialSeen([], BOARD_SHAPE_TUTORIAL_ID);
    seen = markTutorialSeen(seen, SPREAD_WARNING_TUTORIAL_ID);
    seen = markTutorialSeen(seen, BOARD_SHAPE_TUTORIAL_ID); // re-dismiss is idempotent
    expect(seen).toEqual([BOARD_SHAPE_TUTORIAL_ID, SPREAD_WARNING_TUTORIAL_ID]);
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

describe('findSpreadWarningTutorial', () => {
  test('no warned cell on the board — returns undefined (shows nothing)', () => {
    const board = boardOf([[piece('a', 'tomato'), blockerPiece('d', 'cling')]]);
    expect(findSpreadWarningTutorial(board, [])).toBeUndefined();
  });

  test('a warned cell the player has not seen — returns the tutorial and the real warned piece', () => {
    const warned = spreadWarningPiece('w', 'lemon');
    const board = boardOf([[piece('a', 'tomato'), warned]]);
    expect(findSpreadWarningTutorial(board, [])).toEqual({ id: SPREAD_WARNING_TUTORIAL_ID, piece: warned });
  });

  test('shows exactly once — already seen is skipped even while the board still carries a warning', () => {
    const warned = spreadWarningPiece('w', 'lemon');
    const board = boardOf([[warned]]);
    expect(findSpreadWarningTutorial(board, [SPREAD_WARNING_TUTORIAL_ID])).toBeUndefined();
  });

  test('a blocker alone (no warning flag) never triggers this — distinct from the static blocker tutorial', () => {
    const board = boardOf([[blockerPiece('d', 'cling')]]);
    expect(findSpreadWarningTutorial(board, [])).toBeUndefined();
  });

  test('dismissing the other tutorials does not suppress this one — distinct id', () => {
    const warned = spreadWarningPiece('w', 'lemon');
    const board = boardOf([[warned]]);
    const seen = [BLOCKER_TUTORIAL_ID, STRIPED_TUTORIAL_ID, COLOR_BOMB_TUTORIAL_ID, AREA_BOMB_TUTORIAL_ID];
    expect(findSpreadWarningTutorial(board, seen)).toEqual({ id: SPREAD_WARNING_TUTORIAL_ID, piece: warned });
  });

  test('returns the first warned cell row-major when more than one is somehow present', () => {
    const first = spreadWarningPiece('w1', 'tomato');
    const second = spreadWarningPiece('w2', 'lemon');
    const board = boardOf([
      [piece('a', 'herb'), first],
      [second, piece('b', 'onion')],
    ]);
    expect(findSpreadWarningTutorial(board, [])).toEqual({ id: SPREAD_WARNING_TUTORIAL_ID, piece: first });
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

describe('canShowTutorialNow', () => {
  test('no tutorial has ever been shown yet — the very first one is never throttled', () => {
    expect(canShowTutorialNow(null, 1_000_000)).toBe(true);
  });

  test('less than the minimum gap has elapsed since the last tutorial — blocked', () => {
    const lastShownAt = 1_000_000;
    expect(canShowTutorialNow(lastShownAt, lastShownAt + TUTORIAL_MIN_GAP_MS - 1)).toBe(false);
  });

  test('exactly the minimum gap has elapsed — allowed (inclusive boundary)', () => {
    const lastShownAt = 1_000_000;
    expect(canShowTutorialNow(lastShownAt, lastShownAt + TUTORIAL_MIN_GAP_MS)).toBe(true);
  });

  test('well past the minimum gap — allowed', () => {
    const lastShownAt = 1_000_000;
    expect(canShowTutorialNow(lastShownAt, lastShownAt + TUTORIAL_MIN_GAP_MS + 5_000)).toBe(true);
  });

  test('a custom minGapMs is honored instead of the default', () => {
    const lastShownAt = 1_000_000;
    expect(canShowTutorialNow(lastShownAt, lastShownAt + 5_000, 10_000)).toBe(false);
    expect(canShowTutorialNow(lastShownAt, lastShownAt + 10_000, 10_000)).toBe(true);
  });
});

describe('shouldActivateTutorial', () => {
  // The scenario the whole throttle exists for: two genuinely different
  // tutorials both become eligible close together (e.g. a shaped, blockered
  // level's board_shape and blocker mount-time conditions, or forming a
  // striped piece then a color bomb on consecutive moves). This block
  // verifies the two real guarantees the session brief asked for — spacing
  // apart instead of stacking, and a deferred tutorial genuinely showing
  // later rather than vanishing — using the exact function Board.tsx's
  // activation effect calls.
  test('nothing is eligible — never activates', () => {
    expect(shouldActivateTutorial(null, null, null, 1_000_000)).toBe(false);
  });

  test('something is already active — a second one never stacks on top, regardless of cooldown', () => {
    expect(shouldActivateTutorial(BOARD_SHAPE_TUTORIAL_ID, BLOCKER_TUTORIAL_ID, null, 1_000_000)).toBe(false);
  });

  test('first tutorial ever (lastTutorialShownAt null) — activates immediately, no wait', () => {
    expect(shouldActivateTutorial(HOW_TO_PLAY_TUTORIAL_ID, null, null, 1_000_000)).toBe(true);
  });

  test('two genuine triggers close together: the second is deferred, not stacked', () => {
    const boardShapeShownAt = 1_000_000;
    // Immediately after board_shape activates, blocker is also eligible
    // (e.g. both true from the same level's mount) — but it must wait.
    const justAfter = boardShapeShownAt + 1_000;
    expect(shouldActivateTutorial(BLOCKER_TUTORIAL_ID, null, boardShapeShownAt, justAfter)).toBe(false);
  });

  test('a deferred tutorial genuinely shows later, once the gap has elapsed — never lost', () => {
    const boardShapeShownAt = 1_000_000;
    const stillTooSoon = boardShapeShownAt + TUTORIAL_MIN_GAP_MS - 1;
    const gapCleared = boardShapeShownAt + TUTORIAL_MIN_GAP_MS;
    // Same still-eligible candidate (blocker), re-offered on a later move —
    // this mirrors Board.tsx re-checking on every gameState change rather
    // than the candidate being dropped after one failed attempt.
    expect(shouldActivateTutorial(BLOCKER_TUTORIAL_ID, null, boardShapeShownAt, stillTooSoon)).toBe(false);
    expect(shouldActivateTutorial(BLOCKER_TUTORIAL_ID, null, boardShapeShownAt, gapCleared)).toBe(true);
  });

  test('the once-ever guarantee holds regardless of deferral: once dismissed (seen), it never becomes eligible again', () => {
    // Simulates the real end-to-end shape: board_shape shows first, blocker
    // is deferred by the cooldown, then genuinely activates later once the
    // gap clears (as the two tests above establish) and is dismissed —
    // Board.tsx's dismiss handler calls onTutorialSeen, landing the id in
    // seenTutorials exactly as it would have with no throttle involved at
    // all. The throttle only ever delays WHEN shouldActivateTutorial says yes
    // — it has no say over shouldShowBlockerTutorial's own seen-list gate,
    // so a deferral can never cause a tutorial to be shown twice.
    const seenAfterDismissal = [BOARD_SHAPE_TUTORIAL_ID, BLOCKER_TUTORIAL_ID];
    const boardWithBlocker = boardOf([[blockerPiece('a', 'cling')]]);
    expect(shouldShowBlockerTutorial(boardWithBlocker, seenAfterDismissal)).toBe(false);
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
