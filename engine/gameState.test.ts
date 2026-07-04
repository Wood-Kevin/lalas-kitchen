import {
  GameState,
  applyMove,
  grantBonusMoves,
  createGameState,
  SaveData,
  loadSave,
  saveProgress,
  createInMemoryStorage,
} from './gameState';
import { Board, Piece, checkMatches, hasLegalMoves } from './matrix';

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

  // Regression guard for this session's removal of the mid-level
  // pauseReason: 'lives' mechanism (see engine/DECISIONS.md) — `lives`
  // hitting zero must no longer cause a pause on its own. Losing a life is
  // now an account-level effect App.tsx applies after a level ends, not a
  // mid-level GameState transition, so a legal move that exhausts the
  // board's moves is still reported with reason 'moves' regardless of what
  // `lives` happens to be.
  test('lives being at zero no longer causes or reports a pause on its own', () => {
    const board = buildBoard([
      ['A', 'A', 'B'],
      ['B', 'C', 'A'],
      ['C', 'B', 'C'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 1,
      lives: 0,
      objective: { type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      spawnPiece: queueSpawnPiece(['X1', 'X2', 'X3']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });
    expect(result.state.status).toBe('paused_awaiting_input');
    expect(result.state.pauseReason).toBe('moves');
    expect(result.state.lives).toBe(0);
  });
});

describe('applyMove — combo streak', () => {
  test('a move that triggers 4+ chained cascades emits a combo_streak event with correct data', () => {
    const board = buildBoard([
      ['A', 'X', 'Q'],
      ['R', 'A', 'P'],
      ['S', 'A', 'P'],
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
        // Distinct fillers — chain stops here. 'P' (not a fourth distinct
        // filler) is deliberate: it lines up with column 2's pre-existing
        // P,P pair so the settled board still has a legal move (swap this
        // cell with (0,2) completes a P run) — without this, the settled
        // board here is a 3x3 of otherwise all-unique piece types, a
        // degenerate case this session's stuck-board fix would (correctly)
        // reshuffle, which broke this test's exact-board assertion below
        // for reasons unrelated to what this test actually checks.
        'P', 'F', 'G',
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
      ['X', 'P', 'Q'],
      ['R', 'F', 'P'],
      ['S', 'G', 'P'],
    ]);
  });
});

describe('applyMove — mid-play stuck board recovery', () => {
  // Reproduces a genuine mid-play stuck board (confirmed via real mobile
  // playtesting, not a visual miscount): a cascade can settle into a board
  // with zero legal moves anywhere, with no rescue before this test's fix.
  //
  // Rows 1-3 are fixed at construction to a mod-3 diagonal stripe
  // (board[r][c] = TYPES[(r + c) % 3]) — a pattern with the mathematical
  // property that no 3-in-a-row/column ever exists and no single adjacent
  // swap can ever create one, for any board size. Row 0 is deliberately
  // already a 4-in-a-row of 'A' (an edge case applyMove never validates
  // against on the *incoming* board — only the post-swap board is
  // checked), so swapping two of its own already-equal 'A' tiles is a
  // legal, match-producing move that clears the entire row. The spawn
  // queue then refills row 0 with exactly the diagonal-stripe values
  // (A, B, C, A), so the fully-settled board is the complete stripe —
  // provably zero legal moves anywhere on the board, not just in row 0.
  test('a cascade that settles into a zero-legal-move board gets silently reshuffled back into a playable one', () => {
    const board = buildBoard([
      ['A', 'A', 'A', 'A'],
      ['B', 'C', 'A', 'B'],
      ['C', 'A', 'B', 'C'],
      ['A', 'B', 'C', 'A'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      // Never touched by this move, so it can't also trigger a win/pause
      // and muddy the stuck-board assertion.
      objective: { type: 'collect', targetMatchType: 'Z', targetCount: 100, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      // Refills row 0, left to right, with the same diagonal-stripe values
      // that row already needs — so the fully-settled board is a complete,
      // legitimate zero-legal-move stripe, not just the cleared row.
      spawnPiece: queueSpawnPiece(['A', 'B', 'C', 'A']),
    };

    // Swapping two already-equal 'A' tiles is still a legal move here: the
    // post-swap board (identical to the pre-swap one) contains the 4-run,
    // which is all applyMove ever checks.
    const result = applyMove(state, { row: 0, col: 0 }, { row: 0, col: 1 });

    expect(result.state.status).toBe('in_progress');
    expect(checkMatches(result.state.board)).toEqual([]);
    // The real assertion: a settled board must always leave the player a
    // legal move. Before this session's fix, this failed — the board
    // settled as the plain diagonal stripe with hasLegalMoves() === false.
    expect(hasLegalMoves(result.state.board)).toBe(true);
  });
});

describe('applyMove — blockers', () => {
  function blocker(matchType: string, hitsRemaining: number): Piece {
    return { id: 'blk', type: 'blocker', matchType, hitsRemaining };
  }

  test('a single adjacent match clears a hitsToClear: 1 blocker in one hit', () => {
    // Swapping (0,2) and (1,2) turns row 0 into A,A,A. The blocker at (1,1)
    // is directly below (0,1) — one of the three cleared cells — so it
    // takes its one and only hit and clears in the very same cascade pass.
    const board = buildBoard([
      ['A', 'A', 'B'],
      ['X', 'PLACEHOLDER', 'A'],
      ['P', 'Q', 'R'],
    ]);
    board[1][1] = blocker('K', 1);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objective: { type: 'collect', targetMatchType: 'K', targetCount: 1, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    // The blocker cell is gone — replaced by cascade fill, same as any
    // other cleared cell.
    expect(result.state.board.flat().some((p) => p.type === 'blocker')).toBe(false);
    expect(checkMatches(result.state.board)).toEqual([]);

    // The clear counted toward the objective via clearedByMatchType, using
    // the exact same single-Objective machinery every other match already
    // uses — no new objective architecture needed for this to work.
    expect(result.state.objective.currentCount).toBe(1);
    expect(result.state.status).toBe('won');
    expect(result.events).toEqual([
      {
        type: 'level_summary',
        outcome: 'won',
        reason: null,
        clearedByMatchType: { A: 3, K: 1 },
      },
    ]);
  });

  test('a blocker with hitsRemaining > 1 requires two separate adjacent matches to clear', () => {
    // First match: swapping (2,0) and (2,1) completes a vertical A,A,A run
    // in col 0. (1,0) — part of that run — is horizontally adjacent to the
    // blocker at (1,1), which takes one hit (2 -> 1) and survives.
    const board = buildBoard([
      ['A', 'P', 'Q'],
      ['A', 'PLACEHOLDER', 'R'],
      ['S', 'A', 'W'],
    ]);
    board[1][1] = blocker('K', 2);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      // Not 'K' and not reachable this session — keeps this test's
      // assertions purely about the hit counter, not objective/win state.
      objective: { type: 'collect', targetMatchType: 'ZZ', targetCount: 100, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      spawnPiece: queueSpawnPiece(['S', 'S', 'T', 'Z1', 'Z2', 'Z3', 'Z4']),
    };

    const move1 = applyMove(state, { row: 2, col: 0 }, { row: 2, col: 1 });

    // One hit landed — hitsRemaining decremented, but the blocker is still
    // on the board, still at the same cell (its own column was never
    // touched by the clear, so gravity never had a reason to move it).
    expect(move1.state.board[1][1]).toEqual(
      expect.objectContaining({ type: 'blocker', hitsRemaining: 1 })
    );
    expect(move1.events).toEqual([]);

    // Second, separate match: swapping (2,0) and (2,1) again completes a
    // new vertical S,S,S run in col 0 (post-cascade fill left col 0 as
    // S,S,T and row 2 col 1 as 'S'). (1,0) is again adjacent to the
    // blocker, landing its second and final hit.
    const move2 = applyMove(move1.state, { row: 2, col: 0 }, { row: 2, col: 1 });

    expect(move2.state.board.flat().some((p) => p.type === 'blocker')).toBe(false);
    expect(checkMatches(move2.state.board)).toEqual([]);
  });

  test('a blocker cell cannot be swapped — attempting to move it snaps back as a no-op', () => {
    const board = buildBoard([
      ['A', 'B', 'C'],
      ['D', 'PLACEHOLDER', 'F'],
      ['G', 'H', 'I'],
    ]);
    board[1][1] = blocker('K', 1);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objective: { type: 'collect', targetMatchType: 'K', targetCount: 5, currentCount: 0 },
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      spawnPiece: queueSpawnPiece([]),
    };

    const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 0 });
    expect(result.state).toEqual(state);
    expect(result.events).toEqual([]);
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
