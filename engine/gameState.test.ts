import {
  GameState,
  applyMove,
  grantBonusMoves,
  grantBonusLife,
  createGameState,
  SaveData,
  loadSave,
  saveProgress,
  createInMemoryStorage,
} from './gameState';
import { Board, Piece, checkMatches } from './matrix';

function piece(matchType: string, id: string): Piece {
  return { id, type: 'normal', matchType };
}

function buildBoard(letters: string[][]): Board {
  return letters.map((row, r) => row.map((matchType, c) => piece(matchType, `${r}-${c}`)));
}

function queueSpawnPiece(queue: string[]): () => Piece {
  let counter = 0;
  return (): Piece => {
    const matchType = queue.shift();
    if (matchType === undefined) throw new Error('spawnPiece queue exhausted');
    counter += 1;
    return { id: `test-spawn-${counter}`, type: 'normal', matchType };
  };
}

describe('applyMove — full playthrough', () => {
  test('several moves update the objective count correctly and win fires at the target', () => {
    const board = buildBoard([
      ['A', 'A', 'B', 'M', 'N'],
      ['B', 'C', 'A', 'N', 'O'],
      ['G', 'H', 'I', 'O', 'M'],
      ['A', 'A', 'F', 'M', 'N'],
      ['F', 'G', 'A', 'N', 'O'],
    ]);

    const initialState: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objective: { type: 'collect', targetMatchType: 'A', targetCount: 6, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6']),
    };

    // Move 1: adjacent swap that produces no match — should snap back untouched.
    const illegalResult = applyMove(initialState, { row: 2, col: 0 }, { row: 2, col: 1 });
    expect(illegalResult.state).toEqual(initialState);
    expect(illegalResult.events).toEqual([]);

    // Move 2: swap (0,2) and (1,2) completes a 3-run of 'A' in row 0.
    const move2 = applyMove(illegalResult.state, { row: 0, col: 2 }, { row: 1, col: 2 });
    expect(move2.state.movesRemaining).toBe(9);
    expect(move2.state.objective.currentCount).toBe(3);
    expect(move2.state.status).toBe('in_progress');
    expect(move2.events).toEqual([]);
    expect(move2.state.board.map((row) => row.map((p) => p.matchType))).toEqual([
      ['Z1', 'Z2', 'Z3', 'M', 'N'],
      ['B', 'C', 'B', 'N', 'O'],
      ['G', 'H', 'I', 'O', 'M'],
      ['A', 'A', 'F', 'M', 'N'],
      ['F', 'G', 'A', 'N', 'O'],
    ]);

    // Move 3: swap (3,2) and (4,2) completes a second 3-run of 'A' in row 3,
    // reaching the objective target of 6 and winning the level.
    const move3 = applyMove(move2.state, { row: 3, col: 2 }, { row: 4, col: 2 });
    expect(move3.state.movesRemaining).toBe(8);
    expect(move3.state.objective.currentCount).toBe(6);
    expect(move3.state.status).toBe('won');
    expect(move3.events).toEqual([
      { type: 'level_summary', outcome: 'won', reason: null, clearedByMatchType: { A: 6 } },
    ]);
    expect(checkMatches(move3.state.board)).toEqual([]);
  });
});

describe('applyMove — moves exhausted', () => {
  test('hitting zero moves enters paused_awaiting_input with reason "moves", and grantBonusMoves resumes play', () => {
    const board = buildBoard([
      ['A', 'A', 'B'],
      ['B', 'C', 'A'],
      ['C', 'B', 'C'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 1,
      lives: 5,
      objective: { type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      spawnPiece: queueSpawnPiece(['X1', 'X2', 'X3']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });
    expect(result.state.movesRemaining).toBe(0);
    expect(result.state.status).toBe('paused_awaiting_input');
    expect(result.state.pauseReason).toBe('moves');
    expect(result.events).toEqual([
      {
        type: 'level_summary',
        outcome: 'paused_awaiting_input',
        reason: 'moves',
        clearedByMatchType: { A: 3 },
      },
    ]);

    // A move attempted while paused is a no-op.
    const noopAttempt = applyMove(result.state, { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(noopAttempt.state).toEqual(result.state);
    expect(noopAttempt.events).toEqual([]);

    // grantBonusLife must not resume a moves-exhausted pause.
    expect(grantBonusLife(result.state, 3)).toEqual(result.state);

    const resumed = grantBonusMoves(result.state, 3);
    expect(resumed.status).toBe('in_progress');
    expect(resumed.pauseReason).toBeNull();
    expect(resumed.movesRemaining).toBe(3);
  });

  test('grantBonusMoves is a no-op when not currently paused', () => {
    const board = buildBoard([
      ['A', 'B'],
      ['B', 'A'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 5,
      lives: 5,
      objective: { type: 'collect', targetMatchType: 'A', targetCount: 10, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      spawnPiece: queueSpawnPiece([]),
    };

    expect(grantBonusMoves(state, 5)).toEqual(state);
  });
});

describe('applyMove — lives exhausted', () => {
  test('resolving a move while lives are already at zero enters paused_awaiting_input with reason "lives", and grantBonusLife resumes play', () => {
    const board = buildBoard([
      ['A', 'A', 'B'],
      ['B', 'C', 'A'],
      ['C', 'B', 'C'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 0,
      objective: { type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      spawnPiece: queueSpawnPiece(['X1', 'X2', 'X3']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });
    expect(result.state.status).toBe('paused_awaiting_input');
    expect(result.state.pauseReason).toBe('lives');
    // Moves were still available (9 remain) — lives being exhausted is
    // what caused the pause, not moves running out.
    expect(result.state.movesRemaining).toBe(9);
    expect(result.events).toEqual([
      {
        type: 'level_summary',
        outcome: 'paused_awaiting_input',
        reason: 'lives',
        clearedByMatchType: { A: 3 },
      },
    ]);

    // grantBonusMoves must not resume a lives-exhausted pause.
    expect(grantBonusMoves(result.state, 5)).toEqual(result.state);

    const resumed = grantBonusLife(result.state, 1);
    expect(resumed.status).toBe('in_progress');
    expect(resumed.pauseReason).toBeNull();
    expect(resumed.lives).toBe(1);
  });

  test('grantBonusLife is a no-op when not currently paused', () => {
    const board = buildBoard([
      ['A', 'B'],
      ['B', 'A'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 5,
      lives: 5,
      objective: { type: 'collect', targetMatchType: 'A', targetCount: 10, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      spawnPiece: queueSpawnPiece([]),
    };

    expect(grantBonusLife(state, 5)).toEqual(state);
  });
});

describe('applyMove — combo streak', () => {
  test('a move that triggers 4+ chained cascades emits a combo_streak event with correct data', () => {
    const board = buildBoard([
      ['A', 'X', 'Q'],
      ['R', 'A', 'P'],
      ['S', 'A', 'T'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      // Objective set to something this move never touches, so it doesn't
      // also trigger a win/paused event and muddy the combo assertion.
      objective: { type: 'collect', targetMatchType: 'ZZ', targetCount: 100, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      spawnPiece: queueSpawnPiece([
        'B', 'B', 'B', // fills column 1 after the initial A-run clears — instant second run
        'C', 'C', 'C', // third run
        'D', 'D', 'D', // fourth run
        'E', 'F', 'G', // distinct fillers — chain stops here
      ]),
    };

    const result = applyMove(state, { row: 0, col: 0 }, { row: 0, col: 1 });

    expect(result.events).toEqual([
      {
        type: 'combo_streak',
        cascadeCount: 4,
        clearedByMatchType: { A: 3, B: 3, C: 3, D: 3 },
      },
    ]);
    expect(result.state.status).toBe('in_progress');
    expect(checkMatches(result.state.board)).toEqual([]);
    expect(
      result.state.board.map((row) => row.map((p) => p.matchType))
    ).toEqual([
      ['X', 'E', 'Q'],
      ['R', 'F', 'P'],
      ['S', 'G', 'T'],
    ]);
  });
});

describe('createGameState', () => {
  test('wires generateLevel into a fresh GameState with zero accidental matches', () => {
    const state = createGameState({
      seed: 7,
      rows: 6,
      cols: 6,
      pieceTypeIds: ['A', 'B', 'C', 'D'],
      movesLimit: 20,
      lives: 5,
      objective: { targetMatchType: 'A', targetCount: 12 },
    });

    expect(state.status).toBe('in_progress');
    expect(state.objective).toEqual({
      type: 'collect',
      targetMatchType: 'A',
      targetCount: 12,
      currentCount: 0,
    });
    expect(state.board).toHaveLength(6);
    expect(state.board[0]).toHaveLength(6);
    expect(checkMatches(state.board)).toEqual([]);
  });
});

describe('save/load round trip', () => {
  test('saving and loading returns the same data', async () => {
    const storage = createInMemoryStorage();
    const data: SaveData = {
      skinId: 'lalas-kitchen',
      currentLevel: 3,
      lives: 4,
      livesLastRegenAt: 1700000000000,
      itemsCollected: { lemon: 12, tomato: 5 },
      powerUpCounts: { shuffleBoost: 1 },
    };

    await saveProgress('lalas-kitchen', data, storage);
    const loaded = await loadSave('lalas-kitchen', storage);

    expect(loaded).toEqual(data);
  });

  test('loading a skin with no save yet returns null', async () => {
    const storage = createInMemoryStorage();
    const loaded = await loadSave('never-saved', storage);
    expect(loaded).toBeNull();
  });
});
