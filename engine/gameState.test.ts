import {
  GameState,
  applyMove,
  grantBonusMoves,
  requestManualShuffle,
  createGameState,
  SaveData,
  loadSave,
  saveProgress,
  clearSave,
  saveKey,
  createInMemoryStorage,
  countFiredSpecials,
  recordCrash,
} from './gameState';
import {
  Board,
  Piece,
  Position,
  checkMatches,
  checkSquares,
  checkCrossShapes,
  hasLegalMoves,
  swapPieces,
} from './matrix';

function piece(matchType: string, id: string): Piece {
  return { id, type: 'normal', matchType };
}

function buildBoard(letters: string[][]): Board {
  return letters.map((row, r) => row.map((matchType, c) => piece(matchType, `${r}-${c}`)));
}

// A board whose shape is drawn with '.' for a fixed void cell (a hole in a
// non-rectangular board) and any other letter for an ordinary piece.
function buildShapedBoard(letters: string[][]): Board {
  return letters.map((row, r) =>
    row.map((ch, c) => (ch === '.' ? { id: `${r}-${c}`, type: 'void' as const } : piece(ch, `${r}-${c}`)))
  );
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
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 6, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6']),
    };

    // Move 1: adjacent swap that produces no match — should snap back untouched.
    const illegalResult = applyMove(initialState, { row: 2, col: 0 }, { row: 2, col: 1 });
    expect(illegalResult.state).toEqual(initialState);
    expect(illegalResult.events).toEqual([]);

    // Move 2: swap (0,2) and (1,2) completes a 3-run of 'A' in row 0.
    const move2 = applyMove(illegalResult.state, { row: 0, col: 2 }, { row: 1, col: 2 });
    expect(move2.state.movesRemaining).toBe(9);
    expect(move2.state.objectives[0].currentCount).toBe(3);
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
    expect(move3.state.objectives[0].currentCount).toBe(6);
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
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
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
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 10, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece([]),
    };

    expect(grantBonusMoves(state, 5)).toEqual(state);
  });
  test('reshuffles the board in place while leaving moves/lives/objectives untouched', () => {
    const board = buildBoard([
      ['A', 'A', 'B', 'C', 'D'],
      ['B', 'C', 'D', 'A', 'B'],
      ['C', 'D', 'A', 'B', 'C'],
      ['D', 'A', 'B', 'C', 'D'],
      ['A', 'B', 'C', 'D', 'A'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 7,
      lives: 4,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 10, currentCount: 2 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: { A: 2 },
      layerCells: {},
      spawnPiece: queueSpawnPiece([]),
    };

    const result = requestManualShuffle(state);

    // Nothing but the board changed.
    expect(result.movesRemaining).toBe(7);
    expect(result.lives).toBe(4);
    expect(result.objectives).toEqual(state.objectives);
    expect(result.totalCleared).toEqual({ A: 2 });
    expect(result.status).toBe('in_progress');

    // The reshuffled board is a real permutation (same multiset of pieces),
    // never in-place identical, and always match/square-free and playable —
    // the same guarantee shuffle()'s own callers already rely on.
    const before = board.flat().map((p) => p.matchType).sort();
    const after = result.board.flat().map((p) => p.matchType).sort();
    expect(after).toEqual(before);
    expect(checkMatches(result.board)).toEqual([]);
    expect(checkSquares(result.board)).toEqual([]);
    expect(hasLegalMoves(result.board)).toBe(true);
  });

  test('is a no-op outside of in_progress (paused, won, or lost)', () => {
    const board = buildBoard([
      ['A', 'B'],
      ['B', 'A'],
    ]);
    const paused: GameState = {
      board,
      movesRemaining: 0,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 10, currentCount: 0 }],
      status: 'paused_awaiting_input',
      pauseReason: 'moves',
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece([]),
    };

    expect(requestManualShuffle(paused)).toEqual(paused);
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
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['X1', 'X2', 'X3']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });
    expect(result.state.status).toBe('paused_awaiting_input');
    expect(result.state.pauseReason).toBe('moves');
    expect(result.state.lives).toBe(0);
  });
});

describe('requestManualShuffle', () => {
  test('reshuffles the board in place while leaving moves/lives/objectives untouched', () => {
    const board = buildBoard([
      ['A', 'A', 'B', 'C', 'D'],
      ['B', 'C', 'D', 'A', 'B'],
      ['C', 'D', 'A', 'B', 'C'],
      ['D', 'A', 'B', 'C', 'D'],
      ['A', 'B', 'C', 'D', 'A'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 7,
      lives: 4,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 10, currentCount: 2 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: { A: 2 },
      layerCells: {},
      spawnPiece: queueSpawnPiece([]),
    };

    const result = requestManualShuffle(state);

    // Nothing but the board changed.
    expect(result.movesRemaining).toBe(7);
    expect(result.lives).toBe(4);
    expect(result.objectives).toEqual(state.objectives);
    expect(result.totalCleared).toEqual({ A: 2 });
    expect(result.status).toBe('in_progress');

    // The reshuffled board is a real permutation (same multiset of pieces),
    // never in-place identical, and always match/square-free and playable —
    // the same guarantee shuffle()'s own callers already rely on.
    const before = board.flat().map((p) => p.matchType).sort();
    const after = result.board.flat().map((p) => p.matchType).sort();
    expect(after).toEqual(before);
    expect(checkMatches(result.board)).toEqual([]);
    expect(checkSquares(result.board)).toEqual([]);
    expect(hasLegalMoves(result.board)).toBe(true);
  });

  test('is a no-op outside of in_progress (paused, won, or lost)', () => {
    const board = buildBoard([
      ['A', 'B'],
      ['B', 'A'],
    ]);
    const paused: GameState = {
      board,
      movesRemaining: 0,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 10, currentCount: 0 }],
      status: 'paused_awaiting_input',
      pauseReason: 'moves',
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece([]),
    };

    expect(requestManualShuffle(paused)).toEqual(paused);
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
      objectives: [{ type: 'collect', targetMatchType: 'ZZ', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
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

describe('applyMove — cascade steps', () => {
  // The presentation layer animates each cascade pass as its own beat, so
  // applyMove must hand back one board snapshot per pass in order, not just
  // the final settled board (see engine/DECISIONS.md's cascade-steps entry).
  test('a move that cascades through two distinct passes returns both passes as separate steps', () => {
    const board = buildBoard([
      ['A', 'X', 'Q'],
      ['R', 'A', 'P'],
      ['S', 'A', 'P'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      // Untouched objective so this move produces no win/paused event.
      objectives: [{ type: 'collect', targetMatchType: 'ZZ', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      // Pass 1 clears the vertical A-run; column 1 refills B,B,B — an instant
      // second run. Pass 2 clears the B's; column 1 refills P,F,G, which
      // forms no new run (P lines up under column 2's P,P pair only as a
      // legal move, not an immediate match), so the chain stops at two
      // passes and the settled board needs no rescue shuffle.
      spawnPiece: queueSpawnPiece(['B', 'B', 'B', 'P', 'F', 'G']),
    };

    const result = applyMove(state, { row: 0, col: 0 }, { row: 0, col: 1 });

    // Two passes → exactly two snapshots, in resolution order.
    expect(result.steps).toHaveLength(2);

    // Step 1: the A-run has cleared and column 1 has refilled with the B-run
    // that pass 2 will clear — a genuine mid-cascade state, still matchable.
    expect(result.steps[0].map((row) => row.map((p) => p.matchType))).toEqual([
      ['X', 'B', 'Q'],
      ['R', 'B', 'P'],
      ['S', 'B', 'P'],
    ]);

    // Step 2: the settled board, with no remaining matches.
    expect(result.steps[1].map((row) => row.map((p) => p.matchType))).toEqual([
      ['X', 'P', 'Q'],
      ['R', 'F', 'P'],
      ['S', 'G', 'P'],
    ]);

    // The final step is the exact object committed to state.board, so
    // animating through the last step lands precisely on the live board.
    expect(result.steps[result.steps.length - 1]).toBe(result.state.board);
    expect(checkMatches(result.state.board)).toEqual([]);
  });

  test('a winning move whose threshold is crossed on the first pass still returns every later pass as a step', () => {
    // The presentation-layer guard against the "Won overlay appears before the
    // cascade finishes" bug depends on this engine fact: a move can commit
    // status 'won' on an early cascade pass yet keep cascading, so `steps` must
    // still contain the passes that come AFTER the winning one. The overlay is
    // then gated (see Board.tsx + components/cascadeTiming.ts's
    // planCascadeAnimation) on those steps finishing, not on this 'won' landing.
    const board = buildBoard([
      ['A', 'X', 'Q'],
      ['R', 'A', 'P'],
      ['S', 'A', 'P'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      // Target 3 A's — pass 1 alone clears exactly the 3-run of A and meets it,
      // so the win is decided mid-chain, with pass 2 (the B-run) still to come.
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 3, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      // Same two-pass chain as the test above: pass 1 clears the A-run, column 1
      // refills B,B,B (pass 2), then settles to P,F,G with no further match.
      spawnPiece: queueSpawnPiece(['B', 'B', 'B', 'P', 'F', 'G']),
    };

    const result = applyMove(state, { row: 0, col: 0 }, { row: 0, col: 1 });

    // The move is won...
    expect(result.state.status).toBe('won');
    expect(result.state.objectives[0].currentCount).toBeGreaterThanOrEqual(3);
    // ...and the winning pass (pass 1, the A-run) is NOT the last pass: a second
    // pass follows and must still be animated before the overlay may appear.
    expect(result.steps).toHaveLength(2);
    // Pass 1 has already cleared the objective's A pieces (col 1 now shows the
    // B-run pass 2 will clear), confirming the threshold was crossed here, not
    // on the final settled pass.
    expect(result.steps[0].map((row) => row.map((p) => p.matchType))).toEqual([
      ['X', 'B', 'Q'],
      ['R', 'B', 'P'],
      ['S', 'B', 'P'],
    ]);
    // The final step is still the committed board, so animating the last pass
    // lands exactly on the won state's board.
    expect(result.steps[result.steps.length - 1]).toBe(result.state.board);
  });

  test('a single-match move with no chain returns exactly one step, unchanged from the settled-board behavior', () => {
    const board = buildBoard([
      ['A', 'X', 'Q'],
      ['R', 'A', 'P'],
      ['S', 'A', 'P'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'ZZ', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      // Same swap as above, but column 1 refills straight to P,F,G — no
      // intermediate B-run — so the move resolves in a single pass.
      spawnPiece: queueSpawnPiece(['P', 'F', 'G']),
    };

    const result = applyMove(state, { row: 0, col: 0 }, { row: 0, col: 1 });

    // One pass → one step, and it is the settled board itself.
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toBe(result.state.board);
    expect(result.steps[0].map((row) => row.map((p) => p.matchType))).toEqual([
      ['X', 'P', 'Q'],
      ['R', 'F', 'P'],
      ['S', 'G', 'P'],
    ]);
  });

  test('a rejected move returns no steps', () => {
    const board = buildBoard([
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'ZZ', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece([]),
    };

    // Adjacent swap that forms no match: snap back, no move spent, no steps.
    const result = applyMove(state, { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.state).toBe(state);
    expect(result.steps).toEqual([]);
  });
});

describe('applyMove — striped pieces', () => {
  const countStriped = (board: Board): number =>
    board.flat().filter((p) => p.type === 'striped').length;
  const boardHasId = (board: Board, id: string): boolean =>
    board.flat().some((p) => p.id === id);

  test('a 4-in-a-row spawns exactly one striped piece and clears the other three', () => {
    // Swapping (0,2) and (1,2) lines up row 0 into A,A,A,A — a run of exactly
    // four, which converts its anchor cell into a striped piece rather than
    // clearing all four.
    const board = buildBoard([
      ['A', 'A', 'W', 'A'],
      ['X', 'Y', 'A', 'X'],
      ['P', 'X', 'X', 'R'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    // Exactly one striped piece exists, where the run's anchor cell was.
    expect(countStriped(result.state.board)).toBe(1);
    const striped = result.state.board[0][0];
    expect(striped.type).toBe('striped');
    expect(striped.matchType).toBe('A');
    // A horizontal 4-run makes a row-clearing striped piece.
    expect(striped.direction).toBe('row');
    // It kept the id of the ordinary piece it was converted from.
    expect(striped.id).toBe('0-0');

    // Only the other three cells of the run cleared (the anchor became
    // striped, it wasn't cleared), so the objective credits 3, not 4.
    expect(result.state.objectives[0].currentCount).toBe(3);
    // No leftover matches, and the striped piece is an ordinary matchable
    // 'A' everywhere except its pending special.
    expect(checkMatches(result.state.board)).toEqual([]);
  });

  test('matching a striped piece clears its entire row (and the striped may itself be the swapped piece)', () => {
    // Striped row-clearer at (2,0); swapping it up into (1,0) lines up row 1
    // as A,A,A. W at (1,4) is a unique type that ONLY a full-row sweep can
    // clear — a plain 3-match would leave it — so its clear is the proof the
    // special fired.
    const board = buildBoard([
      ['P', 'Q', 'R', 'S', 'T'],
      ['X', 'A', 'A', 'U', 'W'],
      ['A', 'D', 'V', 'E', 'F'],
    ]);
    board[2][0] = { ...board[2][0], type: 'striped', direction: 'row' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']),
    };

    const result = applyMove(state, { row: 2, col: 0 }, { row: 1, col: 0 });

    // The whole of row 1 cleared: W (unique, row-only) and U (the other
    // non-matched cell) both gone — decisive that the sweep, not just the
    // 3-match, fired.
    expect(boardHasId(result.state.board, '1-4')).toBe(false); // W
    expect(boardHasId(result.state.board, '1-3')).toBe(false); // U
    // The striped piece was consumed by triggering.
    expect(countStriped(result.state.board)).toBe(0);
    // Three A's in that row cleared (the striped counts as its 'A' matchType);
    // objective credits exactly those three.
    expect(result.state.objectives[0].currentCount).toBe(3);
  });

  test('matching a striped piece clears its entire column', () => {
    // Striped col-clearer at (2,1); swapping (4,0)<->(4,1) lines up col 1 as
    // A,A,A at rows 2-4. W at (0,1) is a unique type only a full-column sweep
    // reaches.
    const board = buildBoard([
      ['P', 'W', 'Q'],
      ['R', 'S', 'T'],
      ['U', 'A', 'A'],
      ['V', 'A', 'D'],
      ['A', 'X', 'F'],
    ]);
    board[2][1] = { ...board[2][1], type: 'striped', direction: 'col' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']),
    };

    const result = applyMove(state, { row: 4, col: 0 }, { row: 4, col: 1 });

    // Full column 1 cleared: W (unique, top of the column) and S (the other
    // non-matched cell) both gone.
    expect(boardHasId(result.state.board, '0-1')).toBe(false); // W
    expect(boardHasId(result.state.board, '1-1')).toBe(false); // S
    expect(countStriped(result.state.board)).toBe(0);
    expect(result.state.objectives[0].currentCount).toBe(3);
  });

  test('a striped piece is swappable and inert until matched', () => {
    // A striped piece at (1,1). Swapping it to a spot that forms no match is a
    // plain no-op snap-back (proving it is swappable like any normal piece,
    // not rejected outright the way a blocker is) and does NOT trigger.
    const board = buildBoard([
      ['B', 'C', 'D'],
      ['E', 'A', 'F'],
      ['G', 'H', 'I'],
    ]);
    board[1][1] = { ...board[1][1], type: 'striped', direction: 'row' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece([]),
    };

    const noMatch = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 0 });
    // Snap back: no move spent, striped intact and untriggered.
    expect(noMatch.state).toBe(state);
    expect(countStriped(noMatch.state.board)).toBe(1);
    expect(noMatch.state.board[1][1].type).toBe('striped');
  });

  test('a normal match elsewhere leaves an untriggered striped piece in place', () => {
    // Swapping (0,2)<->(1,2) makes row 0 into A,A,A — an ordinary 3-match that
    // does not involve the striped piece parked at (2,0), which must survive
    // untriggered.
    const board = buildBoard([
      ['A', 'A', 'X', 'B', 'C'],
      ['D', 'E', 'A', 'F', 'G'],
      ['A', 'H', 'I', 'J', 'K'],
    ]);
    board[2][0] = { ...board[2][0], type: 'striped', direction: 'col' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    // A real move happened, the striped piece is still present and still
    // striped — the row-0 match did not trigger the unrelated col-clearer.
    expect(result.state.movesRemaining).toBe(9);
    expect(countStriped(result.state.board)).toBe(1);
    const stillStriped = result.state.board.flat().find((p) => p.id === '2-0');
    expect(stillStriped?.type).toBe('striped');
    expect(stillStriped?.direction).toBe('col');
    // Only the three row-0 A's cleared; the striped 'A' was not swept in.
    expect(result.state.objectives[0].currentCount).toBe(3);
  });
});

describe('applyMove — color bombs', () => {
  const countColorBomb = (board: Board): number =>
    board.flat().filter((p) => p.type === 'color_bomb').length;
  const findById = (board: Board, id: string): Piece | undefined =>
    board.flat().find((p) => p.id === id);
  const countMatchType = (board: Board, matchType: string): number =>
    board.flat().filter((p) => p.matchType === matchType).length;

  test('a 5-in-a-row spawns exactly one color bomb (not ordinary or striped) and clears the other four', () => {
    // Swapping (0,2) and (1,2) lines up row 0 into A,A,A,A,A — a run of exactly
    // five, which converts its anchor into a color bomb rather than a striped
    // piece (a 4-run) or a plain full clear (a 3-run).
    const board = buildBoard([
      ['A', 'A', 'W', 'A', 'A', 'X'],
      ['P', 'Q', 'A', 'R', 'S', 'T'],
      ['B', 'C', 'D', 'E', 'F', 'G'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    // Exactly one color bomb, at the run's anchor cell — and it is NOT a
    // striped piece (the 4-run outcome) sitting alongside it.
    expect(countColorBomb(result.state.board)).toBe(1);
    const bomb = result.state.board[0][0];
    expect(bomb.type).toBe('color_bomb');
    expect(bomb.id).toBe('0-0'); // kept the id of the cell it was converted from
    // Colorless by design: no matchType (so it can't form an ordinary run) and
    // no striped `direction`.
    expect(bomb.matchType).toBeUndefined();
    expect(bomb.direction).toBeUndefined();
    expect(result.state.board.flat().filter((p) => p.type === 'striped')).toHaveLength(0);

    // Only the other four cells of the run cleared (the anchor became the bomb,
    // it wasn't cleared), so the objective credits 4, not 5.
    expect(result.state.objectives[0].currentCount).toBe(4);
    expect(checkMatches(result.state.board)).toEqual([]);
  });

  test('swapping a color bomb with a piece clears every piece of that type across the whole board', () => {
    // A color bomb at (1,1) and seven 'A's scattered everywhere on the board.
    // Swapping the bomb with the adjacent 'A' at (1,2) must clear ALL seven,
    // not just ones near the bomb — the defining color-bomb behavior.
    const board = buildBoard([
      ['A', 'B', 'C', 'A', 'D'],
      ['E', 'Z', 'A', 'F', 'A'],
      ['A', 'G', 'H', 'I', 'A'],
      ['J', 'K', 'A', 'L', 'M'],
    ]);
    board[1][1] = { id: board[1][1].id, type: 'color_bomb' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      // Eight cells clear (seven A's + the bomb); a generous unique queue so no
      // incidental cascade forms and spawns never exhaust.
      spawnPiece: queueSpawnPiece(['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8', 'Y9', 'Y10']),
    };

    const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 2 });

    // Every 'A' anywhere on the board is gone, and the bomb consumed itself.
    expect(countMatchType(result.state.board, 'A')).toBe(0);
    expect(countColorBomb(result.state.board)).toBe(0);
    // All seven A's counted toward the objective (the bomb itself is colorless,
    // so it credits nothing).
    expect(result.state.objectives[0].currentCount).toBe(7);
    // A real, committed move: a move was spent and state advanced.
    expect(result.state).not.toBe(state);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a color bomb swap is legal even when it forms no ordinary match — it bypasses the snap-back', () => {
    // The architectural crux: an ordinary swap forming no run snaps back with
    // no move spent. This swap forms no run of ANY type (every piece around the
    // bomb is unique, only one 'A' exists), yet the bomb still detonates and
    // the move commits — proving the color bomb bypasses the match validation.
    const board = buildBoard([
      ['B', 'C', 'D'],
      ['E', 'Z', 'A'],
      ['F', 'G', 'H'],
    ]);
    board[1][1] = { id: board[1][1].id, type: 'color_bomb' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Y1', 'Y2', 'Y3', 'Y4']),
    };

    const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 2 });

    // Not a snap-back: a distinct state, a move spent, the lone 'A' cleared.
    expect(result.state).not.toBe(state);
    expect(result.state.movesRemaining).toBe(9);
    expect(countMatchType(result.state.board, 'A')).toBe(0);
    expect(result.state.objectives[0].currentCount).toBe(1);
    expect(result.steps.length).toBeGreaterThan(0);
  });

  test('swapping a color bomb with another color bomb clears the entire board', () => {
    // Two adjacent color bombs — the rarest, most set-up-intensive play.
    // Swapping them detonates every non-blocker piece on the board.
    const board = buildBoard([
      ['B', 'C', 'D'],
      ['E', 'M', 'N'],
      ['F', 'G', 'H'],
    ]);
    board[1][1] = { id: board[1][1].id, type: 'color_bomb' };
    board[1][2] = { id: board[1][2].id, type: 'color_bomb' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'B', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      // All nine cells clear; unique spawns so the refilled board forms no
      // incidental match.
      spawnPiece: queueSpawnPiece(['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8', 'Y9', 'Y10', 'Y11', 'Y12']),
    };

    const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 2 });

    // Every original piece is gone (whole-board clear), both bombs consumed.
    const originalIds = board.flat().map((p) => p.id);
    for (const id of originalIds) {
      expect(findById(result.state.board, id)).toBeUndefined();
    }
    expect(countColorBomb(result.state.board)).toBe(0);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a two-hit blocker caught in a whole-board detonation takes one hit, not a force-clear', () => {
    // Consistency rule (confirmed with the architect): a blocker is never
    // force-cleared by ANY mechanism — it only takes normal adjacent damage.
    // A two-hit blocker sitting in a full detonation survives with one hit
    // left, exactly as it would beside an ordinary 3-match or a striped sweep.
    const board = buildBoard([
      ['B', 'C', 'D'],
      ['E', 'M', 'N'],
      ['F', 'G', 'H'],
    ]);
    board[1][1] = { id: board[1][1].id, type: 'color_bomb' };
    board[1][2] = { id: board[1][2].id, type: 'color_bomb' };
    // A two-hit pot-lid-style blocker at (2,1), adjacent to cells that clear.
    board[2][1] = { id: board[2][1].id, type: 'blocker', matchType: 'lid', hitsRemaining: 2 };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'lid', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8', 'Y9', 'Y10', 'Y11', 'Y12']),
    };

    const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 2 });

    // The blocker survives, decremented by exactly one — not cleared.
    const lid = findById(result.state.board, '2-1');
    expect(lid?.type).toBe('blocker');
    expect(lid?.hitsRemaining).toBe(1);
    // It didn't clear, so it credited nothing toward its own objective.
    expect(result.state.objectives[0].currentCount).toBe(0);
  });
});

describe('applyMove — special piece combos', () => {
  // Every cell distinct so no ordinary run can ever form (a run needs 3 of one
  // matchType) — lets each test assert exactly which cells a combo cleared with
  // zero incidental cascades muddying the result. Spawns use an 's' prefix that
  // can never collide with a 'cRC' board cell, so the refill can't match either.
  const distinctBoard = (rows: number, cols: number): Board =>
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => piece(`c${r}${c}`, `${r}-${c}`))
    );
  const distinctSpawns = (): (() => Piece) =>
    queueSpawnPiece(Array.from({ length: 40 }, (_, i) => `s${i}`));
  const countStriped = (board: Board): number => board.flat().filter((p) => p.type === 'striped').length;
  const countColorBomb = (board: Board): number => board.flat().filter((p) => p.type === 'color_bomb').length;
  const countMatchType = (board: Board, matchType: string): number =>
    board.flat().filter((p) => p.matchType === matchType).length;
  const hasId = (board: Board, id: string): boolean => board.flat().some((p) => p.id === id);
  const findById = (board: Board, id: string): Piece | undefined => board.flat().find((p) => p.id === id);
  // Original grid ids look like "r-c"; refill spawns look like "sN". Counting the
  // survivors with grid ids is the "and nothing else cleared" assertion.
  const survivingGridPieces = (board: Board): number =>
    board.flat().filter((p) => /^\d+-\d+$/.test(p.id)).length;

  const stateWith = (board: Board, targetMatchType: string): GameState => ({
    board,
    movesRemaining: 10,
    lives: 5,
    objectives: [{ type: 'collect', targetMatchType, targetCount: 100, currentCount: 0 }],
    status: 'in_progress',
    pauseReason: null,
    totalCleared: {},
    layerCells: {},
    spawnPiece: distinctSpawns(),
  });

  test('two striped pieces swapped clear a full cross (the swap cell\'s row and column) and nothing else', () => {
    const board = distinctBoard(5, 5);
    // Two adjacent striped pieces in row 2, given DIFFERENT directions on purpose
    // — the cross overrides each piece's own direction, so a row-clearer plus a
    // column-clearer still produce one full cross, not two parallel lines.
    board[2][1] = { id: board[2][1].id, type: 'striped', matchType: 'c21', direction: 'row' };
    board[2][2] = { id: board[2][2].id, type: 'striped', matchType: 'c22', direction: 'col' };

    const result = applyMove(stateWith(board, 'c21'), { row: 2, col: 1 }, { row: 2, col: 2 });

    // The cross is centered on posA = (2,1): the whole of row 2 and the whole of
    // column 1. Every one of those 9 cells is gone.
    const crossIds = ['2-0', '2-1', '2-2', '2-3', '2-4', '0-1', '1-1', '3-1', '4-1'];
    for (const id of crossIds) expect(hasId(result.state.board, id)).toBe(false);
    // Off-cross cells survive — including (1,2), which shares neither row 2 nor
    // column 1, proving the effect is a single cross, not a double sweep.
    for (const id of ['0-0', '0-2', '1-2', '3-3', '4-4']) {
      expect(hasId(result.state.board, id)).toBe(true);
    }
    // Exactly 9 of the 25 original pieces cleared — nothing extra cascaded.
    expect(survivingGridPieces(result.state.board)).toBe(25 - 9);
    expect(countStriped(result.state.board)).toBe(0);
    // A real, committed move even though the swap formed no ordinary run.
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a striped piece swapped with a color bomb converts every matching piece to striped and clears them all', () => {
    const board = distinctBoard(5, 5);
    // Three 'A' pieces scattered; one of them is the striped piece being swapped.
    board[0][4] = piece('A', '0-4');
    board[3][3] = piece('A', '3-3');
    board[1][1] = { id: board[1][1].id, type: 'striped', matchType: 'A', direction: 'row' };
    board[1][2] = { id: board[1][2].id, type: 'color_bomb' };

    const result = applyMove(stateWith(board, 'A'), { row: 1, col: 1 }, { row: 1, col: 2 });

    // Every 'A' converted-and-fired, and none refilled: no 'A' left anywhere.
    expect(countMatchType(result.state.board, 'A')).toBe(0);
    // The bomb consumed itself; no leftover striped pieces (all fired).
    expect(countColorBomb(result.state.board)).toBe(0);
    expect(countStriped(result.state.board)).toBe(0);
    // The decisive supercombo proof: non-'A' bystanders lying on a converted
    // piece's sweep line are gone — a mere same-type clear (the solo-bomb effect
    // a mis-ordered branch would run) would have LEFT these. Discovery order is
    // row-major with alternating row/col directions, so (0,4)->row 0,
    // (1,1)->column 1, (3,3)->row 3 all sweep.
    for (const id of ['0-0', '2-1', '3-0']) expect(hasId(result.state.board, id)).toBe(false);
    // Cells on no swept line survive.
    for (const id of ['2-0', '2-4', '4-4']) expect(hasId(result.state.board, id)).toBe(true);
    // All three A's credited to the objective.
    expect(result.state.objectives[0].currentCount).toBe(3);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('hasLegalMoves treats both combo-forming swaps as legal even when no ordinary match would result', () => {
    // A wholly distinct board has no run anywhere and no special piece — stuck.
    const base = distinctBoard(3, 3);
    expect(hasLegalMoves(base)).toBe(false);

    // Two adjacent striped pieces make it playable — the cross fires on the swap.
    const stripedBoard = distinctBoard(3, 3);
    stripedBoard[1][0] = { id: '1-0', type: 'striped', matchType: 'c10', direction: 'row' };
    stripedBoard[1][1] = { id: '1-1', type: 'striped', matchType: 'c11', direction: 'col' };
    expect(hasLegalMoves(stripedBoard)).toBe(true);

    // A striped piece next to a color bomb is likewise always legal.
    const bombBoard = distinctBoard(3, 3);
    bombBoard[1][0] = { id: '1-0', type: 'striped', matchType: 'c10', direction: 'row' };
    bombBoard[1][1] = { id: '1-1', type: 'color_bomb' };
    expect(hasLegalMoves(bombBoard)).toBe(true);
  });

  test('a blocker caught in a striped+striped cross takes one adjacent hit, is never force-cleared', () => {
    const board = distinctBoard(5, 5);
    board[2][1] = { id: board[2][1].id, type: 'striped', matchType: 'c21', direction: 'row' };
    board[2][2] = { id: board[2][2].id, type: 'striped', matchType: 'c22', direction: 'col' };
    // A two-hit blocker at (2,3), sitting ON the swept row 2, flanked by cells
    // that clear ((2,2) and (2,4)).
    board[2][3] = { id: '2-3', type: 'blocker', matchType: 'lid', hitsRemaining: 2 };

    const result = applyMove(stateWith(board, 'lid'), { row: 2, col: 1 }, { row: 2, col: 2 });

    const lid = findById(result.state.board, '2-3');
    expect(lid?.type).toBe('blocker');
    expect(lid?.hitsRemaining).toBe(1); // one hit, not force-cleared
    expect(result.state.objectives[0].currentCount).toBe(0); // it didn't clear
  });

  test('a blocker caught in a striped+bomb supercombo takes one adjacent hit, is never force-cleared', () => {
    const board = distinctBoard(5, 5);
    board[1][1] = { id: board[1][1].id, type: 'striped', matchType: 'A', direction: 'row' };
    board[1][2] = { id: board[1][2].id, type: 'color_bomb' };
    // A two-hit blocker at (1,4) on the swept row 1, flanked by cleared cells.
    board[1][4] = { id: '1-4', type: 'blocker', matchType: 'lid', hitsRemaining: 2 };

    const result = applyMove(stateWith(board, 'lid'), { row: 1, col: 1 }, { row: 1, col: 2 });

    const lid = findById(result.state.board, '1-4');
    expect(lid?.type).toBe('blocker');
    expect(lid?.hitsRemaining).toBe(1);
    expect(result.state.objectives[0].currentCount).toBe(0);
  });
});

describe('applyMove — special piece chaining', () => {
  // A special caught in ANOTHER special's clear set fires its own effect too,
  // instead of vanishing silently (the deferred chaining behavior, now built —
  // see gameState.ts's expandChainClears). Same wholly-distinct grid style as the
  // combos/area-bomb blocks: every base cell is a unique 'cRC' so nothing matches
  // or squares by accident, and each chain is set up explicitly on top.
  const distinctBoard = (rows: number, cols: number): Board =>
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => piece(`c${r}${c}`, `${r}-${c}`))
    );
  const distinctSpawns = (): (() => Piece) =>
    queueSpawnPiece(Array.from({ length: 60 }, (_, i) => `z${i}`));
  const hasId = (board: Board, id: string): boolean => board.flat().some((p) => p.id === id);
  const countType = (board: Board, type: string): number => board.flat().filter((p) => p.type === type).length;
  const countMatchType = (board: Board, matchType: string): number =>
    board.flat().filter((p) => p.matchType === matchType).length;

  const stateWith = (board: Board, targetMatchType: string): GameState => ({
    board,
    movesRemaining: 10,
    lives: 5,
    objectives: [{ type: 'collect', targetMatchType, targetCount: 100, currentCount: 0 }],
    status: 'in_progress',
    pauseReason: null,
    totalCleared: {},
    layerCells: {},
    spawnPiece: distinctSpawns(),
  });

  test("a color bomb's detonation catches a striped piece, which fires its own sweep too", () => {
    const board = distinctBoard(5, 5);
    // A color bomb at (0,0), swapped with an ordinary 'A' at (0,1): it detonates
    // every 'A' on the board. One of those A's is a COLUMN-clearing striped piece
    // at (2,2). Chaining means that caught striped fires its own column sweep;
    // without it, the striped would just vanish and column 2 would survive.
    board[0][0] = { id: board[0][0].id, type: 'color_bomb' };
    board[0][1] = piece('A', '0-1');
    board[2][2] = { id: board[2][2].id, type: 'striped', matchType: 'A', direction: 'col' };
    board[4][4] = piece('A', '4-4');

    const result = applyMove(stateWith(board, 'A'), { row: 0, col: 0 }, { row: 0, col: 1 });

    // The striped piece's column (col 2) is fully cleared — the decisive proof the
    // caught striped fired rather than silently clearing. These cells are NOT 'A'
    // (so the bomb alone would never touch them) and NOT on any other effect.
    for (const id of ['0-2', '1-2', '2-2', '3-2', '4-2']) {
      expect(hasId(result.state.board, id)).toBe(false);
    }
    // Every 'A' is gone; the bomb and the striped both consumed themselves.
    expect(countMatchType(result.state.board, 'A')).toBe(0);
    expect(countType(result.state.board, 'color_bomb')).toBe(0);
    expect(countType(result.state.board, 'striped')).toBe(0);
    // Objective credit for 'A' is exactly the three A cells (partner + striped +
    // plain); the bomb is colorless and the swept column-2 cells credit their own
    // (non-'A') types, not 'A'.
    expect(result.state.objectives[0].currentCount).toBe(3);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a single move drives a chain of three triggered effects in sequence', () => {
    const board = distinctBoard(6, 6);
    // Origin: an area bomb at (1,1), swapped with the ordinary piece at (1,0), so
    // its 3x3 blast (rows 0-2, cols 0-2) fires. The chain then runs three links:
    //   link 1 — the blast catches a ROW-striped piece at (2,2) → it sweeps row 2
    //   link 2 — row 2 catches a second area bomb at (2,5) → its 3x3 (rows 1-3,
    //            cols 4-5) fires
    //   link 3 — that blast catches a color bomb at (3,5) → it detonates the
    //            board's most-common color, 'Q'
    board[1][1] = { id: board[1][1].id, type: 'area_bomb' };
    board[2][2] = { id: board[2][2].id, type: 'striped', matchType: 'S', direction: 'row' };
    board[2][5] = { id: board[2][5].id, type: 'area_bomb' };
    board[3][5] = { id: board[3][5].id, type: 'color_bomb' };
    // Four 'Q' pieces, scattered so none forms a run and none sits in ANY blast or
    // sweep above — the only thing that can clear them is the color bomb at the end
    // of the chain. Four of them makes 'Q' the board's most-common color (every
    // other colored cell is unique), so mostCommonMatchType picks 'Q'.
    board[5][0] = piece('Q', 'q0');
    board[5][2] = piece('Q', 'q1');
    board[5][4] = piece('Q', 'q2');
    board[0][5] = piece('Q', 'q3');

    const result = applyMove(stateWith(board, 'Q'), { row: 1, col: 1 }, { row: 1, col: 0 });

    // Link 1 fired: (2,3) lies on row 2 but in NO blast (cols 0-2 / cols 4-5) and
    // isn't 'Q' — it clears only if the striped swept its row.
    expect(hasId(result.state.board, '2-3')).toBe(false);
    // Link 2 fired: (1,4) is inside the SECOND area bomb's 3x3 but off row 2 and
    // not 'Q' — it clears only if that second bomb detonated.
    expect(hasId(result.state.board, '1-4')).toBe(false);
    // Link 3 fired: every 'Q' is gone — reachable only through the color bomb at
    // the tail of the chain.
    expect(countMatchType(result.state.board, 'Q')).toBe(0);
    // All three chained specials consumed themselves along with the origin bomb.
    expect(countType(result.state.board, 'area_bomb')).toBe(0);
    expect(countType(result.state.board, 'striped')).toBe(0);
    expect(countType(result.state.board, 'color_bomb')).toBe(0);
    // The whole chain is one committed move — a chain is a free bonus, never an
    // extra move spent.
    expect(result.state.movesRemaining).toBe(9);
  });

  test('every effect in a chain credits its own cleared cells to the objective', () => {
    const board = distinctBoard(5, 5);
    // A color bomb at (0,0) swapped with ordinary 'A' at (0,1) detonates all A's.
    // A caught row-striped 'A' at (2,0) then sweeps row 2, which clears two 'B'
    // pieces at (2,1) and (2,3). The objective targets 'B' — a type the ORIGIN
    // (the bomb, which only clears A's) never touches. So any 'B' credit at all
    // can only have come from the CHAINED sweep crediting its own cells.
    board[0][0] = { id: board[0][0].id, type: 'color_bomb' };
    board[0][1] = piece('A', '0-1');
    board[2][0] = { id: board[2][0].id, type: 'striped', matchType: 'A', direction: 'row' };
    board[4][4] = piece('A', '4-4');
    board[2][1] = piece('B', '2-1');
    board[2][3] = piece('B', '2-3');

    const result = applyMove(stateWith(board, 'B'), { row: 0, col: 0 }, { row: 0, col: 1 });

    // The chained row sweep cleared both B's → the 'B' objective credits exactly 2,
    // proving chained clears feed objectives (it would be 0 without chaining).
    expect(result.state.objectives[0].currentCount).toBe(2);
    // And the sweep really did clear them.
    expect(countMatchType(result.state.board, 'B')).toBe(0);
    // The origin's own type is still credited independently: three A's cleared
    // (partner + striped + plain), tracked in totalCleared alongside the two B's.
    expect(result.state.totalCleared.A).toBe(3);
    expect(result.state.totalCleared.B).toBe(2);
  });

  test('chaining also fires through the in-match striped sweep path, not just swap-triggered effects', () => {
    const board = distinctBoard(5, 5);
    // This chain starts from an ORDINARY match (resolveMatchEffects), not a
    // swap-triggered special — the second wiring site for chaining. A column-
    // striped 'A' sits at (0,0); swapping the ordinary 'A' up from (1,2) into
    // (0,2) completes a 3-in-a-row of A's across row 0 that INCLUDES the striped
    // piece, triggering its column sweep. Column 0 holds a color bomb at (3,0);
    // the sweep catches it and it chains, detonating the most-common color 'Q'.
    board[0][0] = { id: board[0][0].id, type: 'striped', matchType: 'A', direction: 'col' };
    board[0][1] = piece('A', '0-1');
    board[1][2] = piece('A', '1-2'); // swaps up into (0,2) to complete the row-0 run
    board[3][0] = { id: board[3][0].id, type: 'color_bomb' };
    // Four scattered 'Q' — most-common color, reachable only via the color bomb.
    board[4][1] = piece('Q', 'q0');
    board[4][3] = piece('Q', 'q1');
    board[2][1] = piece('Q', 'q2');
    board[2][3] = piece('Q', 'q3');
    // Pre-move sanity: no run exists until the swap forms the row-0 A-run.
    expect(checkMatches(board)).toHaveLength(0);

    const result = applyMove(stateWith(board, 'Q'), { row: 0, col: 2 }, { row: 1, col: 2 });

    // A legal, committed ordinary move (it formed a run).
    expect(result.state.movesRemaining).toBe(9);
    // The color bomb on the swept column chained: every 'Q' is gone and the bomb
    // consumed itself — proving the in-match sweep path chains too.
    expect(countMatchType(result.state.board, 'Q')).toBe(0);
    expect(countType(result.state.board, 'color_bomb')).toBe(0);
  });
});

describe('applyMove — multiSpecialFired (chain_reaction tutorial trigger)', () => {
  // The signal behind the fourth tutorial (appPersistence.ts's
  // shouldShowChainReactionTutorial): whether 2+ already-special pieces fired
  // their own effect TOGETHER within the same pass of this move — via chaining
  // (expandChainClears catching another special) or a combo (two swapped
  // specials, always both origins). Reuses the exact same wholly-distinct
  // grid style as the chaining/combo blocks above, so nothing matches or
  // squares by accident.
  const uniqueBoard = (rows: number, cols: number): Board =>
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => piece(`u${r}${c}`, `${r}-${c}`))
    );
  const uniqueSpawns = (): (() => Piece) =>
    queueSpawnPiece(Array.from({ length: 60 }, (_, i) => `z${i}`));
  const stateWith = (board: Board, targetMatchType: string): GameState => ({
    board,
    movesRemaining: 10,
    lives: 5,
    objectives: [{ type: 'collect', targetMatchType, targetCount: 100, currentCount: 0 }],
    status: 'in_progress',
    pauseReason: null,
    totalCleared: {},
    layerCells: {},
    spawnPiece: uniqueSpawns(),
  });

  test('a color bomb detonation that chains into a caught striped piece sets multiSpecialFired', () => {
    const board = uniqueBoard(5, 5);
    // Same chain as "a color bomb's detonation catches a striped piece" above:
    // the bomb detonates every 'A', which includes a column-striped piece —
    // that striped is a genuinely SECOND special firing on this one move.
    board[0][0] = { id: board[0][0].id, type: 'color_bomb' };
    board[0][1] = piece('A', '0-1');
    board[2][2] = { id: board[2][2].id, type: 'striped', matchType: 'A', direction: 'col' };
    board[4][4] = piece('A', '4-4');

    const result = applyMove(stateWith(board, 'A'), { row: 0, col: 0 }, { row: 0, col: 1 });

    expect(result.multiSpecialFired).toBe(true);
  });

  test('a striped+striped cross combo always sets multiSpecialFired, even with no chain beyond the two', () => {
    const board = uniqueBoard(5, 5);
    board[2][2] = { id: board[2][2].id, type: 'striped', matchType: 'A', direction: 'row' };
    board[2][3] = { id: board[2][3].id, type: 'striped', matchType: 'B', direction: 'col' };

    const result = applyMove(stateWith(board, 'A'), { row: 2, col: 2 }, { row: 2, col: 3 });

    expect(result.multiSpecialFired).toBe(true);
  });

  test('a solo color bomb detonation with no other special anywhere on the board does not set multiSpecialFired', () => {
    const board = uniqueBoard(5, 5);
    board[0][0] = { id: board[0][0].id, type: 'color_bomb' };
    board[0][1] = piece('A', '0-1');
    board[4][4] = piece('A', '4-4');
    // No striped/area_bomb/second color_bomb anywhere — only the one bomb fires.

    const result = applyMove(stateWith(board, 'A'), { row: 0, col: 0 }, { row: 0, col: 1 });

    // A real, committed detonation (not a rejected move) — just one special.
    expect(result.state.movesRemaining).toBe(9);
    expect(result.multiSpecialFired).toBe(false);
  });

  test('a single striped piece firing via an ordinary in-match sweep, with nothing on its line, does not set multiSpecialFired', () => {
    const board = uniqueBoard(5, 5);
    // A column-striped 'A' at (0,0); swapping (0,2)<->(1,2) completes a row-0
    // run of A's that includes it, firing its own column sweep — column 0
    // holds nothing else special, so exactly one special fires this move.
    board[0][0] = { id: board[0][0].id, type: 'striped', matchType: 'A', direction: 'col' };
    board[0][1] = piece('A', '0-1');
    board[1][2] = piece('A', '1-2');
    expect(checkMatches(board)).toHaveLength(0);

    const result = applyMove(stateWith(board, 'A'), { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(result.state.movesRemaining).toBe(9);
    expect(result.multiSpecialFired).toBe(false);
  });

  test('a rejected (no-match) move never sets multiSpecialFired', () => {
    const board = uniqueBoard(5, 5);
    const state = stateWith(board, 'A');

    const result = applyMove(state, { row: 0, col: 0 }, { row: 0, col: 1 });

    expect(result.state).toBe(state);
    expect(result.multiSpecialFired).toBe(false);
  });

  // The path flagged as reasoned-but-unproven in the special-piece-combo
  // audit: two specials firing "together" doesn't require one to catch the
  // other via a chain, or a direct swap-into-swap combo. Two wholly separate
  // striped pieces, each completing its own ordinary in-match sweep in the
  // SAME checkMatches pass, with no relationship between them, should still
  // count as 2 — proving countFiredSpecials doesn't (and doesn't need to)
  // distinguish "caught" from "merely simultaneous."
  //
  // Row 0's striped 'A' only completes a run once the player's swap lands a
  // third 'A' at (0,2); row 3's striped 'B' run is already complete before
  // the move — so both matches are found in the very same first
  // checkMatches(swapped) call, not one triggering the other. Both directions
  // are 'row', so each sweep stays inside its own row and never crosses the
  // other's cell — no catch relationship is even geometrically possible here.
  test('two independent striped pieces, each firing via its own unrelated run in the same pass, both count toward countFiredSpecials/multiSpecialFired', () => {
    const board = uniqueBoard(6, 5);
    board[0][0] = { id: board[0][0].id, type: 'striped', matchType: 'A', direction: 'row' };
    board[0][1] = piece('A', '0-1');
    board[1][2] = piece('A', '1-2');
    board[3][0] = { id: board[3][0].id, type: 'striped', matchType: 'B', direction: 'row' };
    board[3][1] = piece('B', '3-1');
    board[3][2] = piece('B', '3-2');

    const swapped = [board[0], board[1], board[2], board[3], board[4], board[5]].map((row) =>
      row.slice()
    );
    const tmp = swapped[0][2];
    swapped[0][2] = swapped[1][2];
    swapped[1][2] = tmp;

    const matches = checkMatches(swapped);
    expect(matches).toHaveLength(2);

    // The counting function itself, given exactly these two independent
    // special positions, returns 2 — not a boolean threshold check.
    expect(countFiredSpecials(swapped, [{ row: 0, col: 0 }, { row: 3, col: 0 }])).toBe(2);

    // And the real pipeline (resolveMatchEffects -> expandChainClears ->
    // countFiredSpecials, with no chain between the two) agrees: this move
    // trips the same multi-special signal a genuine chain or combo does.
    const result = applyMove(stateWith(board, 'A'), { row: 0, col: 2 }, { row: 1, col: 2 });
    expect(result.multiSpecialFired).toBe(true);
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
      objectives: [{ type: 'collect', targetMatchType: 'Z', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
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
      objectives: [{ type: 'collect', targetMatchType: 'K', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    // The blocker cell is gone — replaced by cascade fill, same as any
    // other cleared cell.
    expect(result.state.board.flat().some((p) => p.type === 'blocker')).toBe(false);
    expect(checkMatches(result.state.board)).toEqual([]);

    // The clear counted toward the objective via clearedByMatchType, using
    // the exact same Objective machinery every other match already
    // uses — no new objective architecture needed for this to work.
    expect(result.state.objectives[0].currentCount).toBe(1);
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
      objectives: [{ type: 'collect', targetMatchType: 'ZZ', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
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
      objectives: [{ type: 'collect', targetMatchType: 'K', targetCount: 5, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece([]),
    };

    const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 0 });
    expect(result.state).toEqual(state);
    expect(result.events).toEqual([]);
  });

  // "Blocker depth" (see engine/DECISIONS.md's blocker-depth entry): a
  // specialOnly blocker ignores an ordinary match entirely, but still takes
  // damage from a special effect (here, a striped sweep) passing adjacent
  // to it — the real, end-to-end version of matrix.test.ts's more granular
  // applyAdjacentDamage unit tests.
  test('a specialOnly blocker is untouched by an ordinary match adjacent to it', () => {
    const board = buildBoard([
      ['A', 'A', 'B'],
      ['X', 'PLACEHOLDER', 'A'],
      ['P', 'Q', 'R'],
    ]);
    board[1][1] = { ...blocker('K', 1), specialOnly: true };

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'K', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    // The ordinary A,A,A match still fires (confirming the move was real)...
    expect(checkMatches(result.state.board)).toEqual([]);
    // ...but the specialOnly blocker took zero damage from it.
    expect(result.state.board[1][1]).toEqual(
      expect.objectContaining({ type: 'blocker', specialOnly: true, hitsRemaining: 1 })
    );
    expect(result.state.objectives[0].currentCount).toBe(0);
  });

  test('a specialOnly blocker IS damaged by a striped sweep passing adjacent to it', () => {
    // Same striped-sweep setup as the dropdown-immunity test: swapping the
    // striped piece at (2,0) up into (1,0) lines up row 1 as A,A,A and fires
    // the sweep, which clears the WHOLE row — including (1,4), a cell no
    // ordinary match ever touched. The specialOnly blocker at (2,4) is
    // adjacent only to (1,4), so it can only take damage if that cell's
    // clear is correctly identified as special.
    const board = buildBoard([
      ['P', 'Q', 'R', 'S', 'T'],
      ['X', 'A', 'A', 'U', 'W'],
      ['A', 'D', 'V', 'E', 'PLACEHOLDER'],
    ]);
    board[2][0] = { ...board[2][0], type: 'striped', direction: 'row' };
    board[2][4] = { ...blocker('K', 1), specialOnly: true };

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'K', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6']),
    };

    const result = applyMove(state, { row: 2, col: 0 }, { row: 1, col: 0 });

    // The sweep genuinely cleared (1,4), the off-match cell.
    expect(result.state.board.flat().some((p) => p.id === '1-4')).toBe(false);
    // The specialOnly blocker took its one hit and cleared, crediting the
    // objective exactly like any other blocker clear.
    expect(result.state.board.flat().some((p) => p.type === 'blocker')).toBe(false);
    expect(result.state.objectives[0].currentCount).toBe(1);
  });
});

describe('applyMove — multiple objectives', () => {
  test('meeting only one of two objectives does not win the level', () => {
    const board = buildBoard([
      ['A', 'A', 'B'],
      ['B', 'C', 'A'],
      ['C', 'B', 'C'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [
        { type: 'collect', targetMatchType: 'A', targetCount: 3, currentCount: 0 },
        { type: 'collect', targetMatchType: 'B', targetCount: 3, currentCount: 0 },
      ],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['X1', 'X2', 'X3']),
    };

    // Swapping (0,2) and (1,2) completes a 3-run of 'A' in row 0 — the
    // swapped-away 'B' at (0,2) never clears, so the second objective stays
    // untouched at 0.
    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(result.state.objectives[0].currentCount).toBe(3);
    expect(result.state.objectives[1].currentCount).toBe(0);
    // The 'A' objective alone reaching its target must not be enough — the
    // level stays in progress until every objective is met.
    expect(result.state.status).toBe('in_progress');
    expect(result.events).toEqual([]);
  });

  test('meeting every objective in a single move wins the level', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['Y', 'Z', 'A'],
      ['B', 'B', 'B'],
    ]);

    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [
        { type: 'collect', targetMatchType: 'A', targetCount: 3, currentCount: 0 },
        { type: 'collect', targetMatchType: 'B', targetCount: 3, currentCount: 0 },
      ],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      // 6 fresh, mutually-distinct fillers for the 6 cells row 0 and row 2
      // vacate (Y/Z/X — row 1's survivors — simply fall to row 2, needing no
      // spawn of their own) — distinct from Y/Z/X and each other so no
      // accidental second-generation match can form regardless of fill order.
      spawnPiece: queueSpawnPiece(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']),
    };

    // Swapping (0,2) and (1,2) completes a 3-run of 'A' in row 0. Row 2 is
    // already a pre-formed 3-run of 'B', entirely untouched by the swap —
    // checkMatches scans the whole board, not just around the swapped
    // cells, so both matches clear in the very same move.
    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(result.state.objectives[0].currentCount).toBe(3);
    expect(result.state.objectives[1].currentCount).toBe(3);
    expect(result.state.status).toBe('won');
    expect(result.events).toEqual([
      {
        type: 'level_summary',
        outcome: 'won',
        reason: null,
        clearedByMatchType: { A: 3, B: 3 },
      },
    ]);
  });
});

describe('applyMove — scoring system and score objectives', () => {
  test('a plain 3-match clears at the ordinary tier (10 pts/cell) in a single pass', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['B', 'C', 'A'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'score', targetCount: 1000, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      // Distinct from B/C/X and each other so the refill forms no new match.
      spawnPiece: queueSpawnPiece(['Z', 'Y', 'W']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(result.steps).toHaveLength(1);
    // 3 cells * 10 pts (ordinary tier) * 1x (pass 0 multiplier) = 30.
    expect(result.state.objectives[0].currentCount).toBe(30);
  });

  test('a 4-run (creates a striped piece) clears its 3 non-anchor cells at the special tier (25 pts/cell)', () => {
    // Same board/swap as the striped-piece describe block's "4-in-a-row"
    // test, reused here purely for its known single-pass, no-cascade shape.
    const board = buildBoard([
      ['A', 'A', 'W', 'A'],
      ['X', 'Y', 'A', 'X'],
      ['P', 'X', 'X', 'R'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'score', targetCount: 1000, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(result.steps).toHaveLength(1);
    // 3 non-anchor cells * 25 pts (special tier) * 1x = 75. The anchor cell
    // becomes the striped piece, so it never clears/scores here.
    expect(result.state.objectives[0].currentCount).toBe(75);
  });

  test('a 5-run (creates a color bomb) clears its 4 non-anchor cells at the bomb tier (50 pts/cell)', () => {
    // Same board/swap as the color-bombs describe block's "5-in-a-row" test.
    const board = buildBoard([
      ['A', 'A', 'W', 'A', 'A', 'X'],
      ['P', 'Q', 'A', 'R', 'S', 'T'],
      ['B', 'C', 'D', 'E', 'F', 'G'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'score', targetCount: 1000, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(result.steps).toHaveLength(1);
    // 4 non-anchor cells * 50 pts (bomb tier) * 1x = 200.
    expect(result.state.objectives[0].currentCount).toBe(200);
  });

  test('a solo color-bomb detonation scores every cell it clears (including itself) at the bomb tier', () => {
    // Same board/swap as the color-bombs describe block's whole-board test.
    const board = buildBoard([
      ['A', 'B', 'C', 'A', 'D'],
      ['E', 'Z', 'A', 'F', 'A'],
      ['A', 'G', 'H', 'I', 'A'],
      ['J', 'K', 'A', 'L', 'M'],
    ]);
    board[1][1] = { id: board[1][1].id, type: 'color_bomb' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'score', targetCount: 10000, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8', 'Y9', 'Y10']),
    };

    const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 2 });

    expect(result.steps).toHaveLength(1);
    // 7 A's + the bomb cell itself = 8 cells, all at the bomb tier: 8 * 50 = 400.
    expect(result.state.objectives[0].currentCount).toBe(400);
  });

  test('a second cascade pass scores at a higher multiplier than the first — chains contribute their own points', () => {
    // Same board/swap/spawn queue as the cascade-steps describe block's
    // two-pass test: pass 1 clears a vertical A-run (3 ordinary cells), the
    // refill immediately forms a vertical B-run (3 more ordinary cells) that
    // clears as pass 2, then settles with no further match.
    const board = buildBoard([
      ['A', 'X', 'Q'],
      ['R', 'A', 'P'],
      ['S', 'A', 'P'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'score', targetCount: 1000, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['B', 'B', 'B', 'P', 'F', 'G']),
    };

    const result = applyMove(state, { row: 0, col: 0 }, { row: 0, col: 1 });

    expect(result.steps).toHaveLength(2);
    // Pass 0 (index 0, 1x multiplier): 3 ordinary cells * 10 = 30.
    // Pass 1 (index 1, 1.25x multiplier): 3 ordinary cells * 10 * 1.25 = 37.5,
    // rounded to 38. Total: 68 — strictly more than 2 * 30 = 60, proving the
    // second pass is worth more than a repeat of the first, not just "more
    // cells cleared".
    expect(result.state.objectives[0].currentCount).toBe(68);
  });

  test('a score objective wins the level once its target is reached, exactly like a collect objective', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['B', 'C', 'A'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      // The 3-match above scores exactly 30 — set the target right at that
      // threshold so this move both meets and wins it.
      objectives: [{ type: 'score', targetCount: 30, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z', 'Y', 'W']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(result.state.objectives[0].currentCount).toBe(30);
    expect(result.state.status).toBe('won');
    expect(result.events).toContainEqual({
      type: 'level_summary',
      outcome: 'won',
      reason: null,
      clearedByMatchType: { A: 3 },
    });
  });

  test('a score objective and a collect objective on the same level update independently from one move', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['B', 'C', 'A'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [
        { type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 },
        { type: 'score', targetCount: 1000, currentCount: 0 },
      ],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z', 'Y', 'W']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    // The collect objective counts the 3 cleared A's, untouched by scoring...
    expect(result.state.objectives[0].currentCount).toBe(3);
    // ...and the score objective counts the move's points, untouched by the
    // collect objective's own matchType bookkeeping — neither interferes with
    // the other, and neither alone reaches its (deliberately high) target.
    expect(result.state.objectives[1].currentCount).toBe(30);
    expect(result.state.status).toBe('in_progress');
  });
});

describe('applyMove — clearance layers', () => {
  test('a plain ordinary match reduces a 1-layer cell to 0 and wins a clearance objective at target 1', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['B', 'C', 'A'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'clearance', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: { '0,0': 1 },
      spawnPiece: queueSpawnPiece(['Z', 'Y', 'W']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(result.state.layerCells['0,0']).toBe(0);
    expect(result.state.objectives[0].currentCount).toBe(1);
    expect(result.state.status).toBe('won');
  });

  test('a 2-layer cell needs two separate clears before it reaches 0', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['B', 'C', 'A'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'clearance', targetCount: 2, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: { '0,0': 2 },
      spawnPiece: queueSpawnPiece(['Z', 'Y', 'W']),
    };

    const firstHit = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    // One layer down, one still remaining — not yet won.
    expect(firstHit.state.layerCells['0,0']).toBe(1);
    expect(firstHit.state.objectives[0].currentCount).toBe(1);
    expect(firstHit.state.status).toBe('in_progress');

    // A second, independent move whose match again lands on (0,0) — carrying
    // forward firstHit's layerCells/objectives (the real per-move state a
    // continuous playthrough would have), but with a fresh board rigged for
    // its own 3-match, since the exact refill contents after move one aren't
    // what this test is about.
    const secondBoard = buildBoard([
      ['A', 'A', 'X'],
      ['B', 'C', 'A'],
    ]);
    const secondState: GameState = {
      ...firstHit.state,
      board: secondBoard,
      spawnPiece: queueSpawnPiece(['Z2', 'Y2', 'W2']),
    };
    const secondHit = applyMove(secondState, { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(secondHit.state.layerCells['0,0']).toBe(0);
    expect(secondHit.state.objectives[0].currentCount).toBe(2);
    expect(secondHit.state.status).toBe('won');
  });

  test('a layer under a cell reached only by a striped sweep (not the triggering 3-match) still decrements', () => {
    // Same board/swap as the striped-pieces describe block's row-sweep test:
    // matching the striped piece at (2,0) sweeps the whole of row 1, clearing
    // W at (1,4) — a cell no 3-match here ever touches directly, so its
    // layer can only have been reduced by the sweep itself.
    const board = buildBoard([
      ['P', 'Q', 'R', 'S', 'T'],
      ['X', 'A', 'A', 'U', 'W'],
      ['A', 'D', 'V', 'E', 'F'],
    ]);
    board[2][0] = { ...board[2][0], type: 'striped', direction: 'row' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'clearance', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: { '1,4': 1 },
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']),
    };

    const result = applyMove(state, { row: 2, col: 0 }, { row: 1, col: 0 });

    expect(result.state.layerCells['1,4']).toBe(0);
    expect(result.state.objectives[0].currentCount).toBe(1);
    expect(result.state.status).toBe('won');
  });

  test('a layer under a cell caught in a solo color-bomb detonation decrements, at whatever tier it clears', () => {
    // Same board/swap as the color-bombs describe block's whole-board-color
    // detonation test: swapping the bomb at (1,1) with the A at (1,2)
    // detonates every 'A' on the board. (0,3) is one of those A's and never
    // sits in any 3-match on this board, so a layer there can only have been
    // reduced by the bomb's own clear set.
    const board = buildBoard([
      ['A', 'B', 'C', 'A', 'D'],
      ['E', 'Z', 'A', 'F', 'A'],
      ['A', 'G', 'H', 'I', 'A'],
      ['J', 'K', 'A', 'L', 'M'],
    ]);
    board[1][1] = { id: board[1][1].id, type: 'color_bomb' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'clearance', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: { '0,3': 1 },
      spawnPiece: queueSpawnPiece(['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8', 'Y9', 'Y10']),
    };

    const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 2 });

    expect(result.state.layerCells['0,3']).toBe(0);
    expect(result.state.objectives[0].currentCount).toBe(1);
    expect(result.state.status).toBe('won');
  });

  test('a clearance objective coexists with a collect objective on the same level, updating independently', () => {
    const board = buildBoard([
      ['A', 'A', 'X'],
      ['B', 'C', 'A'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [
        { type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 },
        { type: 'clearance', targetCount: 5, currentCount: 0 },
      ],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: { '0,0': 1 },
      spawnPiece: queueSpawnPiece(['Z', 'Y', 'W']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    // The collect objective counts all 3 cleared A's, unaffected by the
    // layer bookkeeping...
    expect(result.state.objectives[0].currentCount).toBe(3);
    // ...and the clearance objective counts only the one layer actually
    // cleared, unaffected by the collect objective's own count — neither
    // interferes with the other, and the (deliberately high) clearance
    // target isn't reached yet.
    expect(result.state.objectives[1].currentCount).toBe(1);
    expect(result.state.status).toBe('in_progress');
  });

  test('a move that clears no layered cell leaves layerCells and the clearance objective untouched', () => {
    const board = buildBoard([
      ['A', 'A', 'X', 'Q', 'R'],
      ['B', 'C', 'A', 'S', 'T'],
    ]);
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'clearance', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      // A layered cell far from this move's match — never touched by it.
      layerCells: { '1,4': 1 },
      totalCleared: {},
      spawnPiece: queueSpawnPiece(['Z', 'Y', 'W']),
    };

    const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

    expect(result.state.layerCells).toEqual({ '1,4': 1 });
    expect(result.state.objectives[0].currentCount).toBe(0);
    expect(result.state.status).toBe('in_progress');
  });
});

describe('applyMove — escort (dropdown) mechanic', () => {
  test('a dropdown piece that falls to the bottom via an ordinary cascade is collected and wins an escort objective', () => {
    // Swapping (3,0)/(3,1) is itself a SIDEWAYS swap (still legal — the
    // player is nudging an ordinary piece, not the dropdown itself), and it
    // turns col0's row3 into 'A', lining up rows 1-3 of col0 as A,A,A — a
    // real match that clears col0's rows 1-3, leaving only the dropdown
    // piece at (0,0) surviving in that column's segment. calculateCascades
    // then settles it at the BOTTOM of that segment (row3) via genuine
    // gravity — its very first arrival, one move after the swap. This is the
    // only route to collection left once vertical dropdown swaps are
    // rejected (see the direction tests below).
    const board: Board = [
      [{ id: 'd0', type: 'dropdown' }, piece('F', 'f0')],
      [piece('A', 'a1'), piece('F', 'f1')],
      [piece('A', 'a2'), piece('G', 'g2')],
      [piece('B', 'b3'), piece('A', 'a3')],
    ];
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'escort', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['S1', 'S2', 'S3', 'S4']),
    };

    const result = applyMove(state, { row: 3, col: 0 }, { row: 3, col: 1 });

    expect(result.state.movesRemaining).toBe(9);
    expect(result.state.objectives[0].currentCount).toBe(1);
    expect(result.state.status).toBe('won');
    // The dropdown piece itself is gone — collected, not just relocated.
    expect(result.state.board.flat().some((p) => p.type === 'dropdown')).toBe(false);
  });

  // Reversed from "always legal" to "sideways only" after a real playtest
  // report flagged unrestricted dropdown swapping as feeling like a bug —
  // investigation confirmed the original design intent (matrix.ts's Piece
  // comment, findAnyLegalMove's own comment) only ever justified the
  // always-legal rule in terms of sideways navigation, never a direct
  // vertical shortcut to collection. See engine/DECISIONS.md's
  // dropdown-swap-direction entry.
  test('swapping a dropdown piece downward is illegal and snaps back, even though the swap would otherwise land it at the bottom', () => {
    const board: Board = [[{ id: 'd0', type: 'dropdown' }], [piece('X', 'x0')]];
    const state: GameState = {
      board,
      movesRemaining: 5,
      lives: 5,
      objectives: [{ type: 'escort', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['S1']),
    };

    const result = applyMove(state, { row: 0, col: 0 }, { row: 1, col: 0 });

    // Snap-back: no move spent, no state change, nothing collected — the
    // same shape an ordinary no-match swap gets, not a silent success.
    expect(result.state.movesRemaining).toBe(5);
    expect(result.state.objectives[0].currentCount).toBe(0);
    expect(result.state.status).toBe('in_progress');
    expect(result.state.board[0][0].type).toBe('dropdown');
    expect(result.state.board[1][0].id).toBe('x0');
    expect(result.steps).toEqual([]);
  });

  test('swapping a dropdown piece upward is illegal and snaps back', () => {
    const board: Board = [[piece('X', 'x0')], [{ id: 'd0', type: 'dropdown' }]];
    const state: GameState = {
      board,
      movesRemaining: 5,
      lives: 5,
      objectives: [{ type: 'escort', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['S1']),
    };

    const result = applyMove(state, { row: 1, col: 0 }, { row: 0, col: 0 });

    expect(result.state.movesRemaining).toBe(5);
    expect(result.state.objectives[0].currentCount).toBe(0);
    expect(result.state.status).toBe('in_progress');
    expect(result.state.board[1][0].type).toBe('dropdown');
    expect(result.state.board[0][0].id).toBe('x0');
    expect(result.steps).toEqual([]);
  });

  test('swapping a dropdown piece sideways is still legal, even with no match', () => {
    // Two rows, so the dropdown landing in row 0 sideways is NOT the bottom
    // of its new column's segment — isolates plain sideways legality from
    // an incidental arrival/collection (a single-row board would trivially
    // collect it, since row 0 is always "the bottom" there).
    const board: Board = [
      [{ id: 'd0', type: 'dropdown' }, piece('X', 'x0')],
      [piece('Y', 'y0'), piece('Z', 'z0')],
    ];
    const state: GameState = {
      board,
      movesRemaining: 5,
      lives: 5,
      objectives: [{ type: 'escort', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece([]),
    };

    const result = applyMove(state, { row: 0, col: 0 }, { row: 0, col: 1 });

    // A real, committed move (not a snap-back) despite forming no match —
    // the one legitimate way a player engages with the mechanic.
    expect(result.state.movesRemaining).toBe(4);
    expect(result.state.board[0][0].id).toBe('x0');
    expect(result.state.board[0][1].type).toBe('dropdown');
    // Not at the bottom of its column, so not yet collected.
    expect(result.state.objectives[0].currentCount).toBe(0);
  });

  // Regression guard for a real bug this feature caught live: a dropdown
  // swap is always legal (per the test above), but unlike every OTHER
  // committed move, it can genuinely clear nothing at all — no match, no
  // arrival — if it just relocates the piece somewhere in the middle of its
  // column. This locks in that `steps` is genuinely empty in that case (not
  // just conceptually), which is exactly the contract
  // components/Board.tsx's animateCascade used to get wrong (it read
  // steps[0] unconditionally and crashed on undefined — see
  // docs/verification/dropdown-escort-mechanic/).
  test('a dropdown swap that neither matches nor arrives commits with an empty steps array', () => {
    const board: Board = [
      [{ id: 'd0', type: 'dropdown' }, piece('A', 'a0')],
      [piece('X', 'x1'), piece('B', 'b1')],
      [piece('Y', 'y2'), piece('C', 'c2')],
    ];
    const state: GameState = {
      board,
      movesRemaining: 5,
      lives: 5,
      objectives: [{ type: 'escort', targetCount: 1, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece([]),
    };

    const result = applyMove(state, { row: 0, col: 0 }, { row: 0, col: 1 });

    // A real, committed move (the swap genuinely happened)...
    expect(result.state.movesRemaining).toBe(4);
    expect(result.state.board[0][1].type).toBe('dropdown');
    expect(result.state.board[0][0].matchType).toBe('A');
    // ...yet with nothing to animate at all.
    expect(result.steps.length).toBe(0);
    expect(result.state.objectives[0].currentCount).toBe(0);
  });

  test('a dropdown piece is immune to a striped sweep passing directly through its cell', () => {
    // Striped row-clearer at (2,0); swapping it up into (1,0) lines up row 1
    // as A,A,A and fires the sweep. A dropdown piece sits at (1,4), squarely
    // inside the swept row — if it were clearable, it would vanish; being
    // immune, it survives untouched.
    const board = buildBoard([
      ['P', 'Q', 'R', 'S', 'T'],
      ['X', 'A', 'A', 'U', 'W'],
      ['A', 'D', 'V', 'E', 'F'],
    ]);
    board[2][0] = { ...board[2][0], type: 'striped', direction: 'row' };
    board[1][4] = { id: '1-4', type: 'dropdown' };
    const state: GameState = {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z1', 'Z2', 'Z3', 'Z4']),
    };

    const result = applyMove(state, { row: 2, col: 0 }, { row: 1, col: 0 });

    // The sweep still cleared the rest of row 1 (U at (1,3), the other
    // non-matched cell) — confirming the sweep genuinely fired — but the
    // dropdown piece at (1,4) is still there, unchanged, never cleared.
    expect(result.state.board.flat().some((p) => p.id === '1-3')).toBe(false);
    const survivingDropdown = result.state.board.flat().find((p) => p.id === '1-4');
    expect(survivingDropdown).toBeDefined();
    expect(survivingDropdown?.type).toBe('dropdown');
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
      objectives: [{ targetMatchType: 'A', targetCount: 12 }],
    });

    expect(state.status).toBe('in_progress');
    expect(state.objectives).toEqual([
      {
        type: 'collect',
        targetMatchType: 'A',
        targetCount: 12,
        currentCount: 0,
      },
    ]);
    expect(state.board).toHaveLength(6);
    expect(state.board[0]).toHaveLength(6);
    expect(checkMatches(state.board)).toEqual([]);
  });

  test('wires multiple objectives into a fresh GameState, each starting at currentCount 0', () => {
    const state = createGameState({
      seed: 7,
      rows: 6,
      cols: 6,
      pieceTypeIds: ['A', 'B', 'C', 'D'],
      movesLimit: 20,
      lives: 5,
      objectives: [
        { targetMatchType: 'A', targetCount: 12 },
        { targetMatchType: 'B', targetCount: 8 },
      ],
    });

    expect(state.objectives).toEqual([
      { type: 'collect', targetMatchType: 'A', targetCount: 12, currentCount: 0 },
      { type: 'collect', targetMatchType: 'B', targetCount: 8, currentCount: 0 },
    ]);
  });

  test('wires a score-type objective with no targetMatchType, starting at currentCount 0', () => {
    const state = createGameState({
      seed: 7,
      rows: 6,
      cols: 6,
      pieceTypeIds: ['A', 'B', 'C', 'D'],
      movesLimit: 20,
      lives: 5,
      objectives: [{ type: 'score', targetCount: 900 }],
    });

    expect(state.objectives).toEqual([{ type: 'score', targetCount: 900, currentCount: 0 }]);
  });

  test('wires layerCells into GameState, keyed by "row,col", and derives a clearance objective targetCount from their sum', () => {
    const state = createGameState({
      seed: 7,
      rows: 6,
      cols: 6,
      pieceTypeIds: ['A', 'B', 'C', 'D'],
      movesLimit: 20,
      lives: 5,
      objectives: [{ type: 'clearance' }],
      layerCells: [
        { position: { row: 0, col: 0 }, layers: 2 },
        { position: { row: 3, col: 4 }, layers: 1 },
      ],
    });

    expect(state.layerCells).toEqual({ '0,0': 2, '3,4': 1 });
    // 2 + 1 = 3 — never hand-authored, always derived from layerCells itself
    // (see LevelConfig.objectives' doc comment), so the two numbers can never
    // drift out of sync.
    expect(state.objectives).toEqual([{ type: 'clearance', targetCount: 3, currentCount: 0 }]);
  });

  test('omitting layerCells leaves GameState.layerCells an empty object — every level built before this mechanic', () => {
    const state = createGameState({
      seed: 7,
      rows: 6,
      cols: 6,
      pieceTypeIds: ['A', 'B', 'C', 'D'],
      movesLimit: 20,
      lives: 5,
      objectives: [{ targetMatchType: 'A', targetCount: 12 }],
    });

    expect(state.layerCells).toEqual({});
  });

  // Contiguity check used by the two tests below — see generator.test.ts for
  // the same helper, restated here since createGameState is the actual
  // wiring point (LevelConfig.denialSpread -> generator.ts's
  // clusterBlockers), not just the placement algorithm itself.
  function isOneContiguousRegion(positions: { row: number; col: number }[]): boolean {
    if (positions.length <= 1) return true;
    const key = (p: { row: number; col: number }): string => `${p.row},${p.col}`;
    const remaining = new Set(positions.map(key));
    const byKey = new Map(positions.map((p) => [key(p), p]));
    const queue = [positions[0]];
    remaining.delete(key(positions[0]));
    const offsets = [
      { row: -1, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: -1 },
      { row: 0, col: 1 },
    ];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (const o of offsets) {
        const nk = `${cur.row + o.row},${cur.col + o.col}`;
        if (remaining.has(nk)) {
          remaining.delete(nk);
          queue.push(byKey.get(nk)!);
        }
      }
    }
    return remaining.size === 0;
  }

  test('a denialSpread: true level places its blockers as one contiguous region', () => {
    const state = createGameState({
      seed: 7,
      rows: 8,
      cols: 8,
      pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
      movesLimit: 20,
      lives: 5,
      objectives: [{ targetMatchType: 'A', targetCount: 12 }],
      blockerCount: 4,
      blockerMatchType: 'cling',
      blockerHitsToClear: 1,
      denialSpread: true,
    });

    const blockerPositions: { row: number; col: number }[] = [];
    state.board.forEach((row, r) =>
      row.forEach((p, c) => {
        if (p.type === 'blocker') blockerPositions.push({ row: r, col: c });
      })
    );
    expect(blockerPositions).toHaveLength(4);
    expect(isOneContiguousRegion(blockerPositions)).toBe(true);
  });

  test('a level below the denial-spread threshold (denialSpread omitted) is unaffected — no clustering applied', () => {
    // Same seed/config as the clustered test above, minus denialSpread — this
    // is exactly what a generated level below DENIAL_SPREAD_MIN_LEVEL_NUMBER
    // produces (see appPersistence.ts's buildGeneratedLevelConfig). Proves
    // createGameState only clusters when the level is genuinely flagged,
    // never as a byproduct of blockerCount/blockerMatchType alone.
    const clustered = createGameState({
      seed: 7,
      rows: 8,
      cols: 8,
      pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
      movesLimit: 20,
      lives: 5,
      objectives: [{ targetMatchType: 'A', targetCount: 12 }],
      blockerCount: 4,
      blockerMatchType: 'cling',
      blockerHitsToClear: 1,
      denialSpread: true,
    });
    const unflagged = createGameState({
      seed: 7,
      rows: 8,
      cols: 8,
      pieceTypeIds: ['A', 'B', 'C', 'D', 'E'],
      movesLimit: 20,
      lives: 5,
      objectives: [{ targetMatchType: 'A', targetCount: 12 }],
      blockerCount: 4,
      blockerMatchType: 'cling',
      blockerHitsToClear: 1,
    });

    expect(unflagged.board).not.toEqual(clustered.board);
    expect(unflagged.board.flat().filter((p) => p.type === 'blocker')).toHaveLength(4);
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

  // saveKey used to hardcode 'lalas-kitchen' as part of the key regardless of
  // the skinId argument — a skin-specific literal living inside otherwise
  // generic engine storage infra, failing CLAUDE.md's Leak Test. It never
  // actually caused two skins' saves to collide (skinId was already the
  // unique suffix), but the "namespace" wasn't genuinely generic — it was one
  // skin's name. This confirms skinId is what actually discriminates one key
  // from another, with no leaked skin name doing that job instead.
  test('saveKey derives a genuinely distinct key per skinId, with no hardcoded skin name involved', () => {
    const keyForSkinA = saveKey('skin-a');
    const keyForSkinB = saveKey('skin-b');

    // Not just two strings that happen to differ — confirm they aren't
    // colliding on a shared hardcoded prefix by coincidence.
    expect(keyForSkinA).not.toEqual(keyForSkinB);

    // The namespace portion itself must carry no skin/product name — that's
    // the actual leak being fixed here, not the (already-fine) uniqueness.
    expect(keyForSkinA).not.toMatch(/lalas-kitchen/);
    expect(keyForSkinB).not.toMatch(/lalas-kitchen/);

    // skinId is what actually determines the key, end to end.
    expect(keyForSkinA.endsWith('skin-a')).toBe(true);
    expect(keyForSkinB.endsWith('skin-b')).toBe(true);
  });

  // The dev-only reset (App.tsx's handleDevReset) leans on clearSave returning
  // the skin to the exact "no save yet" state above, so the app's fresh-install
  // path can be reused verbatim. This asserts that equivalence: after a save
  // exists, clearSave makes the next load null again, and clearing another skin
  // never touches this one's key.
  test('clearSave deletes the save so the next load is null again', async () => {
    const storage = createInMemoryStorage();
    const data: SaveData = {
      skinId: 'lalas-kitchen',
      currentLevel: 7,
      lives: 3,
      livesLastRegenAt: 1700000000000,
      itemsCollected: {},
      powerUpCounts: {},
    };
    await saveProgress('lalas-kitchen', data, storage);
    expect(await loadSave('lalas-kitchen', storage)).toEqual(data);

    // Clearing an unrelated skin leaves this save intact...
    await clearSave('some-other-skin', storage);
    expect(await loadSave('lalas-kitchen', storage)).toEqual(data);

    // ...and clearing this skin returns it to the fresh-install null state.
    await clearSave('lalas-kitchen', storage);
    expect(await loadSave('lalas-kitchen', storage)).toBeNull();
  });

  // SaveData.itemsCollected is keyed by matchType and has no structural tie
  // to GameState.objectives (it's a separate, always-empty-in-V1 field — see
  // appPersistence.ts's buildSaveData) — this confirms the Objective array
  // change didn't accidentally couple the two: a save recording progress for
  // both of a two-objective level's matchTypes round-trips exactly as any
  // other itemsCollected value would.
  test('itemsCollected round-trips correctly for a save touching a multi-objective level', async () => {
    const storage = createInMemoryStorage();
    const data: SaveData = {
      skinId: 'lalas-kitchen',
      currentLevel: 5,
      lives: 4,
      livesLastRegenAt: 1700000000000,
      // Keyed by the same two targetMatchTypes a two-objective level's
      // GameState.objectives would carry (see the 'multiple objectives'
      // describe block above), but this dict's shape/round-trip behavior
      // is entirely independent of how many objectives the level has.
      itemsCollected: { tomato: 21, lemon: 9 },
      powerUpCounts: {},
    };

    await saveProgress('lalas-kitchen', data, storage);
    const loaded = await loadSave('lalas-kitchen', storage);

    expect(loaded).toEqual(data);
    expect(loaded?.itemsCollected).toEqual({ tomato: 21, lemon: 9 });
  });
});

describe('recordCrash', () => {
  test('patches lastCrash onto an existing save, leaving every other field untouched', async () => {
    const storage = createInMemoryStorage();
    const data: SaveData = {
      skinId: 'lalas-kitchen',
      currentLevel: 6,
      lives: 3,
      livesLastRegenAt: 1700000000000,
      itemsCollected: { tomato: 4 },
      powerUpCounts: {},
      completedLevels: [1, 2, 3, 4, 5],
    };
    await saveProgress('lalas-kitchen', data, storage);

    const crash = { message: 'Cannot read properties of undefined', stack: 'at foo (bar.ts:1:1)', timestamp: 1700000005000 };
    await recordCrash('lalas-kitchen', crash, storage);

    const loaded = await loadSave('lalas-kitchen', storage);
    expect(loaded).toEqual({ ...data, lastCrash: crash });
  });

  test('a crash before any save exists yet still produces a real, loadable record', async () => {
    const storage = createInMemoryStorage();
    const crash = { message: 'Unexpected token', timestamp: 1700000009000 };

    await recordCrash('brand-new-skin', crash, storage);

    const loaded = await loadSave('brand-new-skin', storage);
    expect(loaded?.lastCrash).toEqual(crash);
    expect(loaded?.skinId).toBe('brand-new-skin');
    expect(loaded?.currentLevel).toBe(1);
  });

  test('a second crash overwrites the first — only the most recent is kept', async () => {
    const storage = createInMemoryStorage();
    const first = { message: 'first crash', timestamp: 1 };
    const second = { message: 'second crash', timestamp: 2 };

    await recordCrash('lalas-kitchen', first, storage);
    await recordCrash('lalas-kitchen', second, storage);

    const loaded = await loadSave('lalas-kitchen', storage);
    expect(loaded?.lastCrash).toEqual(second);
  });
});

// loadSave used to throw straight out of JSON.parse (or hand back a
// malformed object) for any corrupted/malformed save, with no ErrorBoundary
// anywhere above it to catch that — a crash that would then repeat on every
// subsequent app launch. These confirm the fallback treats corruption as a
// genuinely fresh save (loadSave's own already-real "no save yet" contract,
// null) instead — see engine/DECISIONS.md's defensive-save-loading entry.
describe('loadSave — corrupted or malformed saves fall back to fresh', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // A corrupted save is expected to log (this is the "not silent" half of
    // the fix — see CLAUDE.md's no-silent-failures rule), so these tests
    // deliberately trigger it. Silenced here only so the test run's own
    // output stays clean; still asserted on below.
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('truncated/invalid JSON falls back to null, not a thrown error', async () => {
    const storage = createInMemoryStorage();
    await storage.setItem(saveKey('lalas-kitchen'), '{"skinId": "lalas-kitchen", "lives": 3,');

    const loaded = await loadSave('lalas-kitchen', storage);

    expect(loaded).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('a save that is valid JSON but not an object falls back to null', async () => {
    const storage = createInMemoryStorage();
    await storage.setItem(saveKey('lalas-kitchen'), '"just a string, not a save"');

    expect(await loadSave('lalas-kitchen', storage)).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('a save missing a required backbone field falls back to null', async () => {
    const storage = createInMemoryStorage();
    // No `lives` at all — a required field, not one of the optional
    // add-later fields like completedLevels/seenTutorials.
    await storage.setItem(
      saveKey('lalas-kitchen'),
      JSON.stringify({
        skinId: 'lalas-kitchen',
        currentLevel: 3,
        livesLastRegenAt: 1700000000000,
        itemsCollected: {},
        powerUpCounts: {},
      })
    );

    expect(await loadSave('lalas-kitchen', storage)).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('a required field with the wrong type falls back to null', async () => {
    const storage = createInMemoryStorage();
    await storage.setItem(
      saveKey('lalas-kitchen'),
      JSON.stringify({
        skinId: 'lalas-kitchen',
        currentLevel: 3,
        lives: 'three', // should be a number
        livesLastRegenAt: 1700000000000,
        itemsCollected: {},
        powerUpCounts: {},
      })
    );

    expect(await loadSave('lalas-kitchen', storage)).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  // Optional fields (added after the save format's original shape) must
  // still be the right shape IF PRESENT — a save shouldn't pass validation
  // carrying a seenTutorials that isn't actually a string array, only to
  // throw the first time something calls .includes() on it downstream.
  test('an optional field present with the wrong shape falls back to null', async () => {
    const storage = createInMemoryStorage();
    await storage.setItem(
      saveKey('lalas-kitchen'),
      JSON.stringify({
        skinId: 'lalas-kitchen',
        currentLevel: 3,
        lives: 3,
        livesLastRegenAt: 1700000000000,
        itemsCollected: {},
        powerUpCounts: {},
        seenTutorials: 'blocker', // should be a string array, not a bare string
      })
    );

    expect(await loadSave('lalas-kitchen', storage)).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('a malformed lastCrash (wrong field types) falls back to null', async () => {
    const storage = createInMemoryStorage();
    await storage.setItem(
      saveKey('lalas-kitchen'),
      JSON.stringify({
        skinId: 'lalas-kitchen',
        currentLevel: 1,
        lives: 5,
        livesLastRegenAt: 1700000000000,
        itemsCollected: {},
        powerUpCounts: {},
        lastCrash: { message: 123, timestamp: 'not-a-number' },
      })
    );

    expect(await loadSave('lalas-kitchen', storage)).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  // A save genuinely missing every optional field (predating all of them)
  // must still load successfully — this fix must not become stricter than
  // the pre-existing "optional fields fall back at the read site" contract.
  test('a genuinely old save missing every optional field still loads successfully', async () => {
    const storage = createInMemoryStorage();
    const minimalOldSave = {
      skinId: 'lalas-kitchen',
      currentLevel: 2,
      lives: 5,
      livesLastRegenAt: 1700000000000,
      itemsCollected: { tomato: 4 },
      powerUpCounts: {},
    };
    await storage.setItem(saveKey('lalas-kitchen'), JSON.stringify(minimalOldSave));

    const loaded = await loadSave('lalas-kitchen', storage);

    expect(loaded).toEqual(minimalOldSave);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  // A valid, fully-populated save (every optional field present) must load
  // exactly as before — this fix must not reject legitimate real saves.
  test('a fully valid save with every optional field present still round-trips', async () => {
    const storage = createInMemoryStorage();
    const fullSave: SaveData = {
      skinId: 'lalas-kitchen',
      currentLevel: 12,
      lives: 4,
      livesLastRegenAt: 1700000000000,
      itemsCollected: { tomato: 10 },
      powerUpCounts: {},
      completedLevels: [1, 2, 3],
      seenTutorials: ['blocker', 'striped'],
      unlockedRecipeCards: ['tomato_stew'],
      levelStars: { 1: 3, 2: 2 },
      soundEnabled: true,
      hapticsEnabled: false,
    };
    await saveProgress('lalas-kitchen', fullSave, storage);

    expect(await loadSave('lalas-kitchen', storage)).toEqual(fullSave);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});

describe('applyMove — area bombs (2x2 square trigger)', () => {
  // A wholly-distinct grid so nothing matches or squares by accident — every
  // area-bomb scenario is set up explicitly on top of it. Same pattern as the
  // combos block above.
  const distinctBoard = (rows: number, cols: number): Board =>
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => piece(`c${r}${c}`, `${r}-${c}`))
    );
  const distinctSpawns = (): (() => Piece) =>
    queueSpawnPiece(Array.from({ length: 40 }, (_, i) => `s${i}`));
  const hasId = (board: Board, id: string): boolean => board.flat().some((p) => p.id === id);
  const findById = (board: Board, id: string): Piece | undefined => board.flat().find((p) => p.id === id);
  const countType = (board: Board, type: string): number => board.flat().filter((p) => p.type === type).length;
  const survivingGridPieces = (board: Board): number =>
    board.flat().filter((p) => /^\d+-\d+$/.test(p.id)).length;

  const stateWith = (board: Board, targetMatchType: string): GameState => ({
    board,
    movesRemaining: 10,
    lives: 5,
    objectives: [{ type: 'collect', targetMatchType, targetCount: 100, currentCount: 0 }],
    status: 'in_progress',
    pauseReason: null,
    totalCleared: {},
    layerCells: {},
    spawnPiece: distinctSpawns(),
  });

  test('a 2x2 block spawns exactly one area bomb and clears the other three (not four ordinary clears)', () => {
    const board = distinctBoard(5, 5);
    // Three A's already forming an L at the corner; a fourth A one cell right of
    // the gap. Swapping it in completes the 2x2 {(0,0),(0,1),(1,0),(1,1)} with
    // NO 3-in-a-row anywhere — the pure-square trigger.
    board[0][0] = piece('A', '0-0');
    board[0][1] = piece('A', '0-1');
    board[1][0] = piece('A', '1-0');
    board[1][2] = piece('A', '1-2');
    // Pre-move sanity: no run, no square yet (only 3 of the 2x2 are filled).
    expect(checkMatches(board)).toHaveLength(0);

    const result = applyMove(stateWith(board, 'A'), { row: 1, col: 1 }, { row: 1, col: 2 });

    // Exactly one area bomb exists — the 2x2 became one special, not four clears
    // and not a striped piece or color bomb.
    expect(countType(result.state.board, 'area_bomb')).toBe(1);
    expect(countType(result.state.board, 'striped')).toBe(0);
    expect(countType(result.state.board, 'color_bomb')).toBe(0);
    // It's the top-left anchor cell (id '0-0'), now COLORLESS (drops matchType,
    // like a color bomb — it's swap-activated, not matched), with no striped
    // direction. Gravity may have dropped it from row 0, so it's found by id.
    const bomb = findById(result.state.board, '0-0');
    expect(bomb?.type).toBe('area_bomb');
    expect(bomb?.matchType).toBeUndefined();
    expect(bomb?.direction).toBeUndefined();
    // The other three A cells cleared (the anchor was converted, not cleared).
    for (const id of ['0-1', '1-0', '1-2']) expect(hasId(result.state.board, id)).toBe(false);
    // Only 3 grid pieces cleared, and the objective credits 3 (anchor excluded),
    // exactly like a 4-run spawning a striped piece credits 3. The three cleared
    // cells still carried matchType 'A', so the colorless anchor doesn't change
    // this count.
    expect(survivingGridPieces(result.state.board)).toBe(25 - 3);
    expect(result.state.objectives[0].currentCount).toBe(3);
    // A real, committed move even though the swap formed no ordinary run.
    expect(result.state.movesRemaining).toBe(9);
  });

  // Real playtesting found that a 2x2 square didn't form at all when one of
  // the four matching cells was already a live striped piece — checkSquares
  // used to reject any non-'normal' corner outright, the same rule that
  // excludes a blocker. Confirmed with the architect: a striped corner should
  // count, and the square should fire the EXISTING striped piece's sweep
  // rather than spawn a brand-new area bomb over it — the same "an existing
  // special fires itself instead of seeding a new one" rule the run path
  // already applies (see engine/DECISIONS.md's square+striped entry).
  test('a 2x2 square with one striped corner (same matchType) fires the striped sweep, not a new area bomb', () => {
    const board = distinctBoard(5, 5);
    board[0][0] = piece('A', '0-0');
    board[0][1] = { id: '0-1', type: 'striped', matchType: 'A', direction: 'col' };
    board[1][0] = piece('A', '1-0');
    board[1][2] = piece('A', '1-2');
    // Pre-move sanity: (1,1) is still an unrelated grid piece, so no square
    // (or run) exists yet.
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkSquares(board)).toHaveLength(0);

    // Complete the square by swapping (1,2)'s 'A' into (1,1).
    const result = applyMove(stateWith(board, 'A'), { row: 1, col: 1 }, { row: 1, col: 2 });

    // No new area bomb spawned, and the striped piece consumed itself firing
    // its sweep rather than surviving or converting into something else.
    expect(countType(result.state.board, 'area_bomb')).toBe(0);
    expect(countType(result.state.board, 'striped')).toBe(0);
    // The striped piece's own 'col' direction sweeps the WHOLE of column 1
    // (rows 0-4), reaching beyond the square itself — proof it's genuinely
    // firing its sweep, not just being folded into the square's 4 cells.
    for (const id of ['0-1', '2-1', '3-1', '4-1']) expect(hasId(result.state.board, id)).toBe(false);
    // The other two square corners (not otherwise on the swept column) also
    // cleared as part of the same event.
    expect(hasId(result.state.board, '0-0')).toBe(false);
    expect(hasId(result.state.board, '1-0')).toBe(false);
    // A cell outside both the square and the sweep survives untouched.
    expect(hasId(result.state.board, '2-2')).toBe(true);
    // Objective credit: the 4 matchType-'A' cells (the 3 ordinary square
    // corners + the striped piece's own matchType) — the plain grid pieces
    // swept from elsewhere on column 1 don't count toward it.
    expect(result.state.objectives[0].currentCount).toBe(4);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('swapping an area bomb with an ordinary piece fires the 3x3 blast immediately — no run needed, centered on the bomb', () => {
    const board = distinctBoard(5, 5);
    // A live COLORLESS area bomb at the center (2,2). No A's, no runs anywhere —
    // the swap forms no ordinary match at all, proving the trigger is the swap
    // itself, not a match. Two of the blast cells are made 'A' to show objective
    // credit comes from the cleared cells, NOT the colorless bomb.
    board[2][2] = { id: '2-2', type: 'area_bomb' };
    board[1][1] = piece('A', '1-1');
    board[3][3] = piece('A', '3-3');
    // Pre-move sanity: no run and no square exist (the swap won't make one either).
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkSquares(board)).toHaveLength(0);

    // Swap the bomb (2,2) with its ordinary right neighbour (2,3).
    const result = applyMove(stateWith(board, 'A'), { row: 2, col: 2 }, { row: 2, col: 3 });

    // The blast is the 3x3 centered on the bomb's own cell (rows 1-3, cols 1-3),
    // regardless of the partner — the bomb isn't physically swapped first, so its
    // blast geometry never depends on what it swapped with.
    const blastIds = ['1-1', '1-2', '1-3', '2-1', '2-2', '2-3', '3-1', '3-2', '3-3'];
    for (const id of blastIds) expect(hasId(result.state.board, id)).toBe(false);
    // A cell just outside the 3x3 survives (proving the clear is the local 3x3).
    expect(hasId(result.state.board, '2-4')).toBe(true);
    // The bomb consumed itself; none left.
    expect(countType(result.state.board, 'area_bomb')).toBe(0);
    // Nine cells cleared. Only the two ordinary A's credit the objective — the
    // colorless bomb credits nothing (its own cell has no matchType).
    expect(survivingGridPieces(result.state.board)).toBe(25 - 9);
    expect(result.state.objectives[0].currentCount).toBe(2);
    // A committed move even though the swap formed no run.
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a two-hit blocker caught in the 3x3 blast takes one hit and is never force-cleared', () => {
    const board = distinctBoard(5, 5);
    board[2][2] = { id: '2-2', type: 'area_bomb' };
    // A two-hit blocker inside the 3x3 (at (3,3)), adjacent to blast cells (2,3)
    // and (3,2), so it takes adjacent damage rather than a direct clear.
    board[3][3] = { id: '3-3', type: 'blocker', matchType: 'lid', hitsRemaining: 2 };

    // Fire the bomb by swapping it with an adjacent ordinary piece.
    const result = applyMove(stateWith(board, 'lid'), { row: 2, col: 2 }, { row: 2, col: 3 });

    const lid = findById(result.state.board, '3-3');
    expect(lid?.type).toBe('blocker');
    expect(lid?.hitsRemaining).toBe(1); // one hit, not force-cleared
    // It didn't clear, so nothing credited to the 'lid' objective.
    expect(result.state.objectives[0].currentCount).toBe(0);
  });

  test('area + color bomb: converts every piece of the board\'s most-common color into area bombs and fires them all at once', () => {
    // 7x7 distinct board. Four 'A's placed far enough apart (radius-1 blocks
    // centered on each don't overlap) that "several 3x3 blasts firing
    // simultaneously" is unambiguous — each block is fully isolated from the
    // others and from the swapped bomb pair at the center.
    const board = distinctBoard(7, 7);
    board[1][1] = piece('A', '1-1');
    board[1][5] = piece('A', '1-5');
    board[5][1] = piece('A', '5-1');
    board[5][5] = piece('A', '5-5');
    // 'A' (count 4) is unambiguously the board's most-common matchType — every
    // other cell is a distinct cXY type (count 1 each).
    board[3][3] = { id: '3-3', type: 'area_bomb' };
    board[3][4] = { id: '3-4', type: 'color_bomb' };
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkSquares(board)).toHaveLength(0);

    const result = applyMove(stateWith(board, 'A'), { row: 3, col: 3 }, { row: 3, col: 4 });

    // Both swapped bombs consumed themselves — no specials survive.
    expect(countType(result.state.board, 'area_bomb')).toBe(0);
    expect(countType(result.state.board, 'color_bomb')).toBe(0);
    // Each of the four 'A's fires its own isolated 3x3 block (9 cells each, no
    // overlap), proving four SEPARATE blasts landed, not one merged shape.
    const blockCorners: [number, number][] = [
      [0, 0], [2, 2], // block around (1,1)
      [0, 4], [2, 6], // block around (1,5)
      [4, 0], [6, 2], // block around (5,1)
      [4, 4], [6, 6], // block around (5,5)
    ];
    for (const [r, c] of blockCorners) expect(hasId(result.state.board, `${r}-${c}`)).toBe(false);
    // The swapped bomb pair's own cells cleared too, and they sit OUTSIDE all
    // four blocks (row 3 is exactly between the row-1 and row-5 blocks).
    expect(hasId(result.state.board, '3-3')).toBe(false);
    expect(hasId(result.state.board, '3-4')).toBe(false);
    // A cell reachable by none of the four blasts survives untouched.
    expect(hasId(result.state.board, '0-3')).toBe(true);
    // 4 isolated 3x3 blocks (9 cells each) + the 2 swapped bomb cells, no overlap.
    expect(survivingGridPieces(result.state.board)).toBe(49 - (4 * 9 + 2));
    // Each of the 4 'A' anchor cells still carries matchType 'A' pre-clear, so
    // the objective credits 4 — the surrounding cXY cells don't match it.
    expect(result.state.objectives[0].currentCount).toBe(4);
    expect(result.state.movesRemaining).toBe(9);
    // Both swapped specials fired together in the same pass — the
    // chain_reaction tutorial's own trigger signal.
    expect(result.multiSpecialFired).toBe(true);
  });

  test('area + striped: a plus-shaped blast unions the 3x3 block with the striped piece\'s full sweep line', () => {
    const board = distinctBoard(5, 5);
    board[2][2] = { id: '2-2', type: 'area_bomb' };
    board[2][3] = { id: '2-3', type: 'striped', matchType: 'S', direction: 'col' };
    // One 'A' inside the 3x3 block only, one inside the sweep-only extension —
    // proves objective credit comes from both shapes, not just one.
    board[3][1] = piece('A', '3-1');
    board[0][3] = piece('A', '0-3');
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkSquares(board)).toHaveLength(0);

    const result = applyMove(stateWith(board, 'A'), { row: 2, col: 2 }, { row: 2, col: 3 });

    expect(countType(result.state.board, 'area_bomb')).toBe(0);
    expect(countType(result.state.board, 'striped')).toBe(0);
    // The full 3x3 centered on the bomb (rows 1-3, cols 1-3).
    for (const id of ['1-1', '1-2', '1-3', '2-1', '2-2', '2-3', '3-1', '3-2', '3-3']) {
      expect(hasId(result.state.board, id)).toBe(false);
    }
    // The striped piece's own full column-3 sweep reaches beyond the 3x3
    // (rows 0 and 4), proving the plus shape, not just the block.
    expect(hasId(result.state.board, '0-3')).toBe(false);
    expect(hasId(result.state.board, '4-3')).toBe(false);
    // A cell outside both shapes survives.
    expect(hasId(result.state.board, '0-0')).toBe(true);
    // 9 (3x3) + 2 (sweep cells beyond the block: rows 0 and 4 of col 3) = 11.
    expect(survivingGridPieces(result.state.board)).toBe(25 - 11);
    expect(result.state.objectives[0].currentCount).toBe(2);
    expect(result.state.movesRemaining).toBe(9);
    expect(result.multiSpecialFired).toBe(true);
  });

  test('area + area: a single bigger 5x5 blast, not two separate 3x3s', () => {
    const board = distinctBoard(7, 7);
    board[3][3] = { id: '3-3', type: 'area_bomb' };
    board[3][4] = { id: '3-4', type: 'area_bomb' };
    // One 'A' near each end of the 5x5, to confirm objective credit spans the
    // whole bigger block.
    board[1][1] = piece('A', '1-1');
    board[5][5] = piece('A', '5-5');
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkSquares(board)).toHaveLength(0);

    const result = applyMove(stateWith(board, 'A'), { row: 3, col: 3 }, { row: 3, col: 4 });

    expect(countType(result.state.board, 'area_bomb')).toBe(0);
    // The full 5x5 centered on posA=(3,3): rows 1-5, cols 1-5.
    for (let r = 1; r <= 5; r++) {
      for (let c = 1; c <= 5; c++) expect(hasId(result.state.board, `${r}-${c}`)).toBe(false);
    }
    // Cells just outside the 5x5 on every side survive — proving it's exactly
    // 5x5, not e.g. two separate 3x3s that would leave (0,3)/(6,3) cleared too
    // only if they happened to fall in a 3x3, which they don't either way, so
    // check the cells a real "two separate 3x3s" reading WOULD still clear
    // (they're all inside this 5x5 too) plus cells only a bigger 5x5 reaches.
    expect(hasId(result.state.board, '1-5')).toBe(false); // only reachable if the blast is 5 wide, not 3
    expect(hasId(result.state.board, '0-0')).toBe(true); // outside the 5x5 entirely
    expect(hasId(result.state.board, '6-6')).toBe(true); // outside the 5x5 entirely
    expect(survivingGridPieces(result.state.board)).toBe(49 - 25);
    expect(result.state.objectives[0].currentCount).toBe(2);
    expect(result.state.movesRemaining).toBe(9);
    expect(result.multiSpecialFired).toBe(true);
  });

  test('hasLegalMoves keeps a board playable when its only move forms a 2x2 square', () => {
    // Distinct 3x3 with a small A cluster; the ONLY productive swap makes a pure
    // square (no run). This guards the area-bomb SPAWN path, the same way the
    // color bomb needed its own clause.
    const board = buildBoard([
      ['A', 'A', 'p'],
      ['A', 'z', 'A'],
      ['q', 'r', 's'],
    ]);
    expect(hasLegalMoves(board)).toBe(true);
  });

  test('hasLegalMoves: an area-bomb swap is legal with an ordinary neighbour AND with any special partner (all three combos)', () => {
    // An all-distinct board with no run or square possible is stuck on its own.
    const board = buildBoard([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
    ]);
    expect(hasLegalMoves(board)).toBe(false);
    // Drop a colorless area bomb into the middle: swapping it with any ordinary
    // neighbour fires its blast, which is always a legal move (mirrors the color
    // bomb clause) — so the board is playable again.
    board[1][1] = { id: '1-1', type: 'area_bomb' };
    expect(hasLegalMoves(board)).toBe(true);

    // An area bomb whose ONLY neighbour is another special is now ALSO legal —
    // each of the three area+special pairings fires a real combo (see
    // resolveAreaColorCombo / resolveAreaStripedCombo / resolveAreaAreaCombo),
    // so none of these tiny 1x2 boards is wrongly judged stuck any more.
    const areaPlusColorBomb: Board = [
      [{ id: 'x', type: 'area_bomb' }, { id: 'y', type: 'color_bomb' }],
    ];
    expect(hasLegalMoves(areaPlusColorBomb)).toBe(true);

    const areaPlusStriped: Board = [
      [
        { id: 'x', type: 'area_bomb' },
        { id: 'y', type: 'striped', matchType: 'A', direction: 'row' },
      ],
    ];
    expect(hasLegalMoves(areaPlusStriped)).toBe(true);

    const areaPlusArea: Board = [
      [
        { id: 'x', type: 'area_bomb' },
        { id: 'y', type: 'area_bomb' },
      ],
    ];
    expect(hasLegalMoves(areaPlusArea)).toBe(true);
  });

  test('an unambiguous square embedded in a straight run now spawns an area bomb — a real playtest gap, fixed', () => {
    // Real playtest report: two cells on one row plus three on the row/column
    // beside it, sharing two columns/rows — a 2x3 rectangle missing one
    // corner. Investigated: checkSquares (matrix.ts) already finds this
    // embedded square unconditionally (it scans every 2x2 window on the
    // board with no isolation requirement) — the gap was resolveMatchEffects
    // standing down EVERY square touching a run, indiscriminately, rather
    // than only the genuinely ambiguous/conflicting cases (see
    // isUnambiguousEmbeddedSquare in gameState.ts). This test covers the
    // column-oriented transpose of the report; the row-oriented literal shape
    // is covered by the next test.
    const board = distinctBoard(5, 5);
    // Four A's placed so ONE swap forms the shape: a vertical 3-run in column
    // 1 (rows 0-2) AND the 2x2 {(0,1),(0,2),(1,1),(1,2)} at once. Neither the
    // run nor the square pre-exists (both need cell (0,1), which the swap
    // fills). NOTE: there is no horizontal run of length >= 3 anywhere in
    // this configuration (row 0 and row 1 each only have 2 A's), so this was
    // never a genuine two-arm crossing — a true L/T/plus crossing is a
    // separate, already-built trigger (see the crossing-run describe block
    // below), unaffected by this fix.
    board[1][1] = piece('A', '1-1');
    board[2][1] = piece('A', '2-1');
    board[0][2] = piece('A', '0-2');
    board[1][2] = piece('A', '1-2');
    // The A that completes the shape, parked at (0,0), swapped into (0,1).
    board[0][0] = piece('A', '0-0');
    // Pre-move sanity: no run and no square yet.
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkSquares(board)).toHaveLength(0);

    const swapped = swapPieces(board, { row: 0, col: 0 }, { row: 0, col: 1 });
    // Defensive proof this is not a genuine crossing: no horizontal run of
    // length >= 3 exists through the shared cells, so checkCrossShapes must
    // find nothing here, independent of the embedded-square outcome below.
    expect(checkCrossShapes(swapped)).toHaveLength(0);
    // Exactly one embedded square exists — the unambiguous case this fix
    // allows through (contrast with the genuinely ambiguous test below).
    expect(checkSquares(swapped)).toHaveLength(1);

    const result = applyMove(stateWith(board, 'A'), { row: 0, col: 0 }, { row: 0, col: 1 });

    // The embedded square fired: exactly one area bomb, not an ordinary clear.
    expect(countType(result.state.board, 'area_bomb')).toBe(1);
    // The anchor is the square's top-left cell (0,1) — the piece that landed
    // there after the swap, id '0-0'.
    const bomb = findById(result.state.board, '0-0');
    expect(bomb?.type).toBe('area_bomb');
    expect(bomb?.matchType).toBeUndefined();
    expect(bomb?.direction).toBeUndefined();
    // The other 4 cells of the combined run+square shape cleared: the run's
    // other two cells, plus the square's other two cells.
    for (const id of ['1-1', '2-1', '0-2', '1-2']) expect(hasId(result.state.board, id)).toBe(false);
    // 4 objective credits + 1 anchor — the same accounting shape a 5-run's
    // color bomb and the L/T/plus cross both use, since this is also a
    // 5-cell shape.
    expect(result.state.objectives[0].currentCount).toBe(4);
    expect(survivingGridPieces(result.state.board)).toBe(25 - 4);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('the literal reported shape (2 cells top row, 3 cells bottom row, sharing the left 2 columns) spawns an area bomb', () => {
    const board = distinctBoard(5, 5);
    // Target shape once the swap lands: (0,0),(0,1) on top, (1,0),(1,1),(1,2)
    // below — a 2x3 box missing its top-right corner, exactly as reported.
    // Four of the five cells are pre-filled; the fifth, (1,1), is filled by
    // swapping in a donor from OUTSIDE the shape (one cell below, at (2,1)) —
    // the same "foreign donor" recipe the crossing-run tests use, so the
    // swap doesn't have to rob one of the other 4 cells to fill this one.
    board[0][0] = piece('A', '0-0');
    board[0][1] = piece('A', '0-1');
    board[1][0] = piece('A', '1-0');
    board[1][2] = piece('A', '1-2');
    board[2][1] = piece('A', '2-1'); // donor, one cell below the gap at (1,1)
    // Pre-move sanity: no run and no square yet — (1,1) itself is still an
    // unrelated grid piece, breaking every line through it.
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkSquares(board)).toHaveLength(0);

    const swapped = swapPieces(board, { row: 1, col: 1 }, { row: 2, col: 1 });
    expect(checkCrossShapes(swapped)).toHaveLength(0); // never a genuine crossing
    expect(checkSquares(swapped)).toHaveLength(1); // exactly one, unambiguous

    const result = applyMove(stateWith(board, 'A'), { row: 1, col: 1 }, { row: 2, col: 1 });

    expect(countType(result.state.board, 'area_bomb')).toBe(1);
    // The anchor is the square's top-left cell (0,0), untouched by this swap.
    const bomb = findById(result.state.board, '0-0');
    expect(bomb?.type).toBe('area_bomb');
    expect(bomb?.matchType).toBeUndefined();
    // The other 4 cells cleared: the run's 3 cells (1,0)/(1,1 = the donor,
    // id '2-1')/(1,2), plus the square's remaining corner (0,1).
    for (const id of ['0-1', '1-0', '2-1', '1-2']) expect(hasId(result.state.board, id)).toBe(false);
    expect(result.state.objectives[0].currentCount).toBe(4);
    expect(survivingGridPieces(result.state.board)).toBe(25 - 4);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a genuinely ambiguous embedded square (two overlapping candidates) still stands down — never silently guessed', () => {
    // A full, aligned 2x3 rectangle: BOTH rows are independently exactly-3
    // runs (row 0 cols 0-2, row 1 cols 0-2), so checkSquares finds TWO valid,
    // overlapping 2x2 candidates (cols 0-1 and cols 1-2) — genuinely
    // ambiguous, unlike the two tests above (each has only one embedded
    // candidate). This is the harder case explicitly flagged as still
    // deferred rather than silently resolved: no bomb spawns for either
    // candidate, and both rows just clear as ordinary 3-matches.
    const board = distinctBoard(5, 5);
    for (const col of [0, 1, 2]) {
      board[0][col] = piece('A', `0-${col}`);
      board[1][col] = piece('A', `1-${col}`);
    }
    expect(checkMatches(board)).toHaveLength(2); // both rows, independently
    expect(checkSquares(board)).toHaveLength(2); // two overlapping candidates

    // An unrelated swap elsewhere on the board — the ambiguous shape already
    // exists before this swap, so this just exercises applyMove's real
    // resolution path against it (no snap-back, since the board already has
    // matches regardless of this swap's own two cells).
    const result = applyMove(stateWith(board, 'A'), { row: 4, col: 4 }, { row: 4, col: 3 });

    expect(countType(result.state.board, 'area_bomb')).toBe(0);
    // Both rows cleared as ordinary matches — no anchor withheld from either.
    for (const id of ['0-0', '0-1', '0-2', '1-0', '1-1', '1-2']) {
      expect(hasId(result.state.board, id)).toBe(false);
    }
    expect(result.state.objectives[0].currentCount).toBe(6);
  });
});

describe('applyMove — area bombs (L/T/plus crossing-run trigger)', () => {
  // Same pattern as the 2x2-square block above (distinct grid, explicit
  // per-test overrides, redeclared locally per this file's convention).
  const distinctBoard = (rows: number, cols: number): Board =>
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => piece(`c${r}${c}`, `${r}-${c}`))
    );
  const distinctSpawns = (): (() => Piece) =>
    queueSpawnPiece(Array.from({ length: 40 }, (_, i) => `s${i}`));
  const hasId = (board: Board, id: string): boolean => board.flat().some((p) => p.id === id);
  const findById = (board: Board, id: string): Piece | undefined => board.flat().find((p) => p.id === id);
  const countType = (board: Board, type: string): number => board.flat().filter((p) => p.type === type).length;
  const survivingGridPieces = (board: Board): number =>
    board.flat().filter((p) => /^\d+-\d+$/.test(p.id)).length;

  const stateWith = (board: Board, targetMatchType: string): GameState => ({
    board,
    movesRemaining: 10,
    lives: 5,
    objectives: [{ type: 'collect', targetMatchType, targetCount: 100, currentCount: 0 }],
    status: 'in_progress',
    pauseReason: null,
    totalCleared: {},
    layerCells: {},
    spawnPiece: distinctSpawns(),
  });

  // NOTE (a structural finding from designing these tests): a full 4-armed
  // plus cannot be produced by a single legal adjacent swap from a
  // match-free board — the crossing cell's only grid-neighbours are its own
  // two arms, so any swap into it necessarily "steals" that neighbour's own
  // arm-tip content, breaking the very arm it belongs to. An L (crossing is
  // the endpoint of both arms) or a T (crossing is the endpoint of one arm,
  // the middle of the other) both work via one real swap, because the
  // crossing cell then has a free neighbour OUTSIDE the shape to donate a
  // foreign matching piece without robbing either arm. So the tests below use
  // that "foreign donor one cell beyond the crossing cell" recipe; the plus's
  // degree-4 geometry is covered at the checkCrossShapes unit level only (see
  // matrix.test.ts), since resolveMatchEffects' cross loop treats every
  // degree identically regardless of how many arm cells there are.

  test('a genuine T-shape crossing swap spawns exactly one area bomb, crediting the other four cells', () => {
    const board = distinctBoard(5, 5);
    board[1][2] = piece('A', '1-2'); // donor, one cell above the crossing point (2,2)
    board[2][1] = piece('A', '2-1');
    board[2][3] = piece('A', '2-3');
    board[3][2] = piece('A', '3-2');
    board[4][2] = piece('A', '4-2');
    // Pre-move sanity: neither arm exists yet — both need (2,2), still distinct.
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkSquares(board)).toHaveLength(0);
    expect(checkCrossShapes(board)).toHaveLength(0);

    // Swapping the donor into (2,2) completes row 2 cols 1-3 (middle) AND
    // column 2 rows 2-4 (top endpoint) — a T, both arms exactly length 3.
    const result = applyMove(stateWith(board, 'A'), { row: 2, col: 2 }, { row: 1, col: 2 });

    expect(countType(result.state.board, 'area_bomb')).toBe(1);
    expect(countType(result.state.board, 'striped')).toBe(0);
    expect(countType(result.state.board, 'color_bomb')).toBe(0);
    // The anchor keeps the id of whichever piece ends up AT the crossing cell
    // after the swap — here that's the donor, id '1-2' (swapPieces moves the
    // piece object, including its id, not just its matchType).
    const bomb = findById(result.state.board, '1-2');
    expect(bomb?.type).toBe('area_bomb');
    expect(bomb?.matchType).toBeUndefined();
    expect(bomb?.direction).toBeUndefined();
    // The other four cross cells cleared (the anchor converted, not cleared).
    for (const id of ['2-1', '2-3', '3-2', '4-2']) expect(hasId(result.state.board, id)).toBe(false);
    // The piece the swap displaced (the crossing cell's original occupant,
    // now sitting at (1,2)) is untouched, ordinary content.
    expect(hasId(result.state.board, '2-2')).toBe(true);
    // 4 objectives + 1 anchor — the same accounting shape a 5-run's color
    // bomb uses, since a pure 3x3 cross is also exactly 5 cells.
    expect(result.state.objectives[0].currentCount).toBe(4);
    expect(survivingGridPieces(result.state.board)).toBe(25 - 4);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a genuine L-shape crossing swap spawns exactly one area bomb', () => {
    const board = distinctBoard(5, 5);
    board[1][2] = piece('A', '1-2'); // donor, one cell above the crossing point (2,2)
    board[2][3] = piece('A', '2-3');
    board[2][4] = piece('A', '2-4');
    board[3][2] = piece('A', '3-2');
    board[4][2] = piece('A', '4-2');
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkCrossShapes(board)).toHaveLength(0);

    // Completes row 2 cols 2-4 AND column 2 rows 2-4 — crossing (2,2) is the
    // shared endpoint of both arms, a genuine L.
    const result = applyMove(stateWith(board, 'A'), { row: 2, col: 2 }, { row: 1, col: 2 });

    expect(countType(result.state.board, 'area_bomb')).toBe(1);
    const bomb = findById(result.state.board, '1-2');
    expect(bomb?.type).toBe('area_bomb');
    expect(bomb?.matchType).toBeUndefined();
    for (const id of ['2-3', '2-4', '3-2', '4-2']) expect(hasId(result.state.board, id)).toBe(false);
    expect(result.state.objectives[0].currentCount).toBe(4);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a 4-long arm crossing an exactly-3 arm preserves old behavior — no area bomb, striped spawns as usual', () => {
    const board = distinctBoard(5, 5);
    board[1][2] = piece('A', '1-2'); // donor
    board[2][1] = piece('A', '2-1');
    board[2][3] = piece('A', '2-3');
    board[2][4] = piece('A', '2-4'); // stretches the row arm to length 4
    board[3][2] = piece('A', '3-2');
    board[4][2] = piece('A', '4-2');
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkCrossShapes(board)).toHaveLength(0);

    const result = applyMove(stateWith(board, 'A'), { row: 2, col: 2 }, { row: 1, col: 2 });

    // The crossing candidate involved a 4-long arm, so it stood down entirely
    // — the confirmed precedence rule. The 4-run's own striped spawn fires
    // exactly as it does today, at the run's own leftmost cell, unaffected by
    // the perpendicular exactly-3 arm's existence.
    expect(countType(result.state.board, 'area_bomb')).toBe(0);
    expect(countType(result.state.board, 'striped')).toBe(1);
    const striped = findById(result.state.board, '2-1');
    expect(striped?.type).toBe('striped');
    expect(striped?.direction).toBe('row');
    expect(striped?.matchType).toBe('A');
    for (const id of ['1-2', '2-3', '2-4', '3-2', '4-2']) expect(hasId(result.state.board, id)).toBe(false);
    expect(result.state.objectives[0].currentCount).toBe(5);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a 5-long arm crossing an exactly-3 arm preserves old behavior — no area bomb, color bomb spawns as usual', () => {
    const board = distinctBoard(5, 5);
    board[1][2] = piece('A', '1-2'); // donor
    board[2][0] = piece('A', '2-0');
    board[2][1] = piece('A', '2-1');
    board[2][3] = piece('A', '2-3');
    board[2][4] = piece('A', '2-4'); // full row of 5 once the swap lands
    board[3][2] = piece('A', '3-2');
    board[4][2] = piece('A', '4-2');
    expect(checkMatches(board)).toHaveLength(0);
    expect(checkCrossShapes(board)).toHaveLength(0);

    const result = applyMove(stateWith(board, 'A'), { row: 2, col: 2 }, { row: 1, col: 2 });

    expect(countType(result.state.board, 'area_bomb')).toBe(0);
    expect(countType(result.state.board, 'color_bomb')).toBe(1);
    const bomb = findById(result.state.board, '2-0');
    expect(bomb?.type).toBe('color_bomb');
    expect(bomb?.matchType).toBeUndefined();
    expect(result.state.objectives[0].currentCount).toBe(6);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a live striped piece anywhere in the cross stands down the area bomb — the striped piece fires its own sweep instead', () => {
    const board = distinctBoard(5, 5);
    board[1][2] = piece('A', '1-2'); // donor
    board[2][1] = piece('A', '2-1');
    board[2][3] = piece('A', '2-3');
    board[3][2] = piece('A', '3-2');
    // The far vertical tip is already a live striped piece, same matchType.
    board[4][2] = { id: '4-2', type: 'striped', matchType: 'A', direction: 'row' };

    const result = applyMove(stateWith(board, 'A'), { row: 2, col: 2 }, { row: 1, col: 2 });

    // No area bomb — the cross stood down because it caught a live special.
    expect(countType(result.state.board, 'area_bomb')).toBe(0);
    // The striped piece consumed itself firing its own sweep.
    expect(countType(result.state.board, 'striped')).toBe(0);
    expect(hasId(result.state.board, '4-2')).toBe(false);
    // Its 'row' direction sweeps the WHOLE of row 4, reaching beyond the
    // cross's own 5 cells — proof a genuine sweep fired, not just the ordinary
    // clear a plain cross would have produced.
    for (const id of ['4-0', '4-1', '4-3', '4-4']) expect(hasId(result.state.board, id)).toBe(false);
    // The rest of the cross (the row arm + the other col-arm cell) cleared
    // alongside it.
    for (const id of ['2-1', '2-3', '3-2']) expect(hasId(result.state.board, id)).toBe(false);
    expect(result.state.movesRemaining).toBe(9);
  });

  test('a square overlapping a crossing arm stands down — only the cross\'s one area bomb spawns', () => {
    const board = distinctBoard(5, 5);
    board[1][2] = piece('A', '1-2'); // donor
    board[2][1] = piece('A', '2-1');
    board[2][3] = piece('A', '2-3');
    board[3][2] = piece('A', '3-2');
    board[4][2] = piece('A', '4-2');
    // A 2x2 at {(2,2),(2,3),(3,2),(3,3)} reuses three cells already in the
    // cross's two arms and adds just one new cell (3,3) — it shares cells
    // with both arms, so it should stand down via the existing runCovered
    // check (the same rule that stands down any square overlapping any run),
    // proving squares and crosses never conflict.
    board[3][3] = piece('A', '3-3');

    const result = applyMove(stateWith(board, 'A'), { row: 2, col: 2 }, { row: 1, col: 2 });

    // Exactly one area bomb — the cross's, not a second one from the square.
    expect(countType(result.state.board, 'area_bomb')).toBe(1);
  });
});

describe('applyMove — dynamic denial-zone spread', () => {
  // A blocker piece with an explicit hit count. matchType is carried purely so
  // a spread cell can inherit it (blockers never join runs — piecesMatch
  // excludes them), never for matching.
  const blocker = (id: string, matchType: string, hits: number): Piece => ({
    id,
    type: 'blocker',
    matchType,
    hitsRemaining: hits,
  });

  // A 4x4 board with ONE blocker at (3,0). Its only open frontier is the
  // ordinary cell directly above it at (2,0) — findSpreadTarget scans up first,
  // so (2,0) is the deterministic spread target. Swapping SWAP_A/SWAP_B forms a
  // 3-in-a-row of 'A' along the top row (cols 1-3), far from the blocker, so the
  // move is legal and NEVER damages the zone (it stays unaddressed). Rebuilt
  // fresh each move by unaddressedMove so the identical legal move repeats while
  // the spread clock carries forward on GameState.
  const SWAP_A: Position = { row: 0, col: 3 };
  const SWAP_B: Position = { row: 1, col: 3 };
  const freshZoneBoard = (): Board => [
    [piece('P', 'p0'), piece('A', 'a1'), piece('A', 'a2'), piece('C', 'c3')],
    [piece('Q', 'q0'), piece('R', 'r1'), piece('S', 's2'), piece('A', 'a3')],
    [piece('P', 'p2'), piece('S', 's3'), piece('R', 'r2'), piece('T', 't3')],
    [blocker('blk', 'Z', 1), piece('T', 't0'), piece('P', 'p1'), piece('Q', 'q1')],
  ];

  const countBlockers = (board: Board): number =>
    board.flat().filter((p) => p.type === 'blocker').length;
  const countWarnings = (board: Board): number =>
    board.flat().filter((p) => p.spreadWarning === true).length;

  const makeSpreadState = (spreadInterval: number | null, blockerSpecialOnly = false): GameState => ({
    board: freshZoneBoard(),
    movesRemaining: 50,
    lives: 5,
    // Unreachable target, so the level never wins mid-run and the spread clock
    // can keep advancing.
    objectives: [{ type: 'collect', targetMatchType: 'never', targetCount: 999, currentCount: 0 }],
    status: 'in_progress',
    pauseReason: null,
    totalCleared: {},
    layerCells: {},
    spawnPiece: queueSpawnPiece(['M', 'N', 'O', 'M', 'N', 'O']),
    denialSpread:
      spreadInterval === null
        ? undefined
        : {
            movesUnaddressed: 0,
            spreadInterval,
            blockerHitsToClear: 1,
            ...(blockerSpecialOnly ? { blockerSpecialOnly: true } : {}),
          },
  });

  // One unaddressed move: reset board + spawn queue so the same legal top-row
  // match repeats, carrying the spread clock (and movesRemaining) forward.
  const unaddressedMove = (state: GameState): GameState => {
    const seeded: GameState = {
      ...state,
      board: freshZoneBoard(),
      spawnPiece: queueSpawnPiece(['M', 'N', 'O', 'M', 'N', 'O']),
    };
    return applyMove(seeded, SWAP_A, SWAP_B).state;
  };

  test('below the difficulty threshold (no denialSpread state) a zone never spreads, no matter how many moves pass', () => {
    let state = makeSpreadState(null);
    expect(state.denialSpread).toBeUndefined();
    // Ten unaddressed moves — well past any interval a real level would use.
    for (let i = 0; i < 10; i++) {
      state = unaddressedMove(state);
      expect(countBlockers(state.board)).toBe(1);
      expect(countWarnings(state.board)).toBe(0);
    }
  });

  test('a gated zone spreads into its frontier cell exactly on the interval-th unaddressed move (18-move budget → interval 5)', () => {
    // interval 5 is what createGameState derives from an 18-move budget (see the
    // proportional-derivation test below).
    let state = makeSpreadState(5);
    const boards: Board[] = [];
    for (let i = 0; i < 5; i++) {
      state = unaddressedMove(state);
      boards.push(state.board);
    }

    // Moves 1-3: clock ticking, nothing visible yet.
    for (let i = 0; i < 3; i++) {
      expect(countBlockers(boards[i])).toBe(1);
      expect(countWarnings(boards[i])).toBe(0);
    }
    // Move 4 (interval-1): the warning appears — still one blocker, no spread.
    expect(countBlockers(boards[3])).toBe(1);
    expect(countWarnings(boards[3])).toBe(1);
    // Move 5 (interval): the zone spreads — a second blocker exists, warning gone,
    // clock reset.
    expect(countBlockers(boards[4])).toBe(2);
    expect(countWarnings(boards[4])).toBe(0);
    expect(state.denialSpread?.movesUnaddressed).toBe(0);
  });

  test('the spread interval scales with the level move budget (30-move budget → interval 8, not 5)', () => {
    // Same mechanic, wider interval: with a 30-move budget the derived interval
    // is 8, so the zone must NOT have spread by move 5 (when the 18-move level
    // already did), warns at move 7, and spreads at move 8. This is the direct
    // proof the timing is proportional, not a fixed universal number.
    let state = makeSpreadState(8);
    const boards: Board[] = [];
    for (let i = 0; i < 8; i++) {
      state = unaddressedMove(state);
      boards.push(state.board);
    }

    // Move 5: an 18-move level spreads here; a 30-move level must not.
    expect(countBlockers(boards[4])).toBe(1);
    expect(countWarnings(boards[4])).toBe(0);
    // Move 6: still nothing.
    expect(countBlockers(boards[5])).toBe(1);
    expect(countWarnings(boards[5])).toBe(0);
    // Move 7 (interval-1): warning.
    expect(countBlockers(boards[6])).toBe(1);
    expect(countWarnings(boards[6])).toBe(1);
    // Move 8 (interval): spread.
    expect(countBlockers(boards[7])).toBe(2);
    expect(countWarnings(boards[7])).toBe(0);
  });

  test('createGameState derives the spread interval proportionally from movesLimit (18 → 5, 30 → 8)', () => {
    const base = {
      seed: 1,
      rows: 8,
      cols: 8,
      pieceTypeIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      lives: 5,
      objectives: [{ targetMatchType: 'a', targetCount: 10 }],
      denialSpread: true,
    };
    const s18 = createGameState({ ...base, movesLimit: 18 });
    const s30 = createGameState({ ...base, movesLimit: 30 });
    expect(s18.denialSpread?.spreadInterval).toBe(5);
    expect(s30.denialSpread?.spreadInterval).toBe(8);
    // A quarter of the budget: 18 and 30 are 12 apart, their intervals 3 apart —
    // the pressure genuinely scales with level length rather than being fixed.
  });

  test('createGameState threads blockerSpecialOnly into denialSpread state', () => {
    const base = {
      seed: 1,
      rows: 8,
      cols: 8,
      pieceTypeIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      lives: 5,
      objectives: [{ targetMatchType: 'a', targetCount: 10 }],
      movesLimit: 18,
      denialSpread: true,
      blockerCount: 2,
      blockerMatchType: 'sealed_jar',
      blockerHitsToClear: 1,
    };
    const withoutFlag = createGameState(base);
    const withFlag = createGameState({ ...base, blockerSpecialOnly: true });

    expect(withoutFlag.denialSpread?.blockerSpecialOnly).toBeUndefined();
    expect(withFlag.denialSpread?.blockerSpecialOnly).toBe(true);
  });

  test('the warning state is distinguishable from the pre-warning board before any spread occurs', () => {
    let state = makeSpreadState(5);
    let preWarning: Board = state.board;
    let warning: Board = state.board;
    for (let i = 0; i < 4; i++) {
      state = unaddressedMove(state);
      if (i === 2) preWarning = state.board; // move 3: no warning yet
      if (i === 3) warning = state.board; // move 4: warning shown
    }
    // Neither has spread yet (blocker count unchanged), but the boards differ:
    // exactly one cell is flagged on the warning board and none on the prior one.
    expect(countBlockers(preWarning)).toBe(1);
    expect(countBlockers(warning)).toBe(1);
    expect(countWarnings(preWarning)).toBe(0);
    expect(countWarnings(warning)).toBe(1);
    // The warned cell is still an ordinary, matchable piece — the crack is a
    // preview, not the blocker itself yet.
    const warned = warning.flat().find((p) => p.spreadWarning === true);
    expect(warned?.type).toBe('normal');
  });

  test('addressing the zone (damaging a blocker) resets the spread clock instead of spreading', () => {
    // A board where the swap forms a 3-run in row 2 (cols 0-2). Clearing (2,0),
    // adjacent to the blocker at (3,0), deals it one hit — "addressing" the zone.
    // The blocker has 2 hits so it survives (still a blocker) but its health
    // drops, which the engine reads as engagement.
    const addressingBoard = (): Board => [
      [piece('G', 'g0'), piece('H', 'h0'), piece('M', 'm00'), piece('I', 'i0')],
      [piece('J', 'j1'), piece('K', 'k1'), piece('M', 'm01'), piece('L', 'l1')],
      [piece('M', 'm20'), piece('M', 'm21'), piece('Z', 'z2'), piece('N', 'n2')],
      [blocker('blk', 'Z', 2), piece('O', 'o3'), piece('P', 'p3'), piece('Q', 'q3')],
    ];
    const state: GameState = {
      board: addressingBoard(),
      movesRemaining: 50,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'never', targetCount: 999, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['R', 'S', 'U', 'R', 'S', 'U']),
      // On the brink: one more unaddressed move would spread.
      denialSpread: { movesUnaddressed: 4, spreadInterval: 5, blockerHitsToClear: 2 },
    };

    // Swap (2,2)Z <-> (1,2)M forms M,M,M across row 2, clearing (2,0)/(2,1)/(2,2).
    const result = applyMove(state, { row: 2, col: 2 }, { row: 1, col: 2 });

    // The zone was addressed: clock reset to 0, no spread, no warning, and still
    // exactly one blocker (the damaged original, now at 1 hit — not cleared, not
    // multiplied).
    expect(result.state.denialSpread?.movesUnaddressed).toBe(0);
    expect(countBlockers(result.state.board)).toBe(1);
    expect(countWarnings(result.state.board)).toBe(0);
  });

  // Regression guard for a real gap the tuning-constant review caught: a
  // freshly spread blocker used to always be an ordinary blocker, even on a
  // sealed_jar-gated level (specialOnly, generated levelNumber >= 12) whose
  // zone is ALSO spread-eligible (levelNumber >= 10) — both conditions are
  // simultaneously satisfiable, so a real level could have a zone whose
  // static blockers are specialOnly but whose newly-spread cells were
  // silently vulnerable to an ordinary match. See engine/DECISIONS.md's
  // blocker-depth entry's spread-interaction fix.
  test('a freshly spread blocker inherits blockerSpecialOnly from the level, not just blockerHitsToClear', () => {
    let state = makeSpreadState(5, true);
    for (let i = 0; i < 5; i++) {
      state = unaddressedMove(state);
    }

    // The zone spread (a second blocker now exists), into (2,0) — the one
    // open frontier cell directly above the original blocker at (3,0).
    expect(countBlockers(state.board)).toBe(2);
    expect(state.board[2][0]).toEqual(
      expect.objectContaining({ type: 'blocker', specialOnly: true })
    );
  });
});

describe('applyMove — non-rectangular (void) board', () => {
  // A thin plus on a 5x5 board: only column 2 (the vertical arm) and row 2
  // (the horizontal arm) are playable; every other cell is a void.
  //   . . M . .
  //   . . N . .
  //   A A B A C
  //   . . O . .
  //   . . P . .
  function plusState(overrides: Partial<GameState> = {}): GameState {
    const board = buildShapedBoard([
      ['.', '.', 'M', '.', '.'],
      ['.', '.', 'N', '.', '.'],
      ['A', 'A', 'B', 'A', 'C'],
      ['.', '.', 'O', '.', '.'],
      ['.', '.', 'P', '.', '.'],
    ]);
    return {
      board,
      movesRemaining: 10,
      lives: 5,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 3, currentCount: 0 }],
      status: 'in_progress',
      pauseReason: null,
      totalCleared: {},
      layerCells: {},
      spawnPiece: queueSpawnPiece(['Z', 'Y', 'X']),
      ...overrides,
    };
  }

  const voidPositions: Position[] = [];
  for (const r of [0, 1, 3, 4]) {
    for (const c of [0, 1, 3, 4]) {
      voidPositions.push({ row: r, col: c });
    }
  }

  test('a swap that targets a void cell snaps back — no move spent, no state change', () => {
    const state = plusState();
    // (2,0) is a real 'A'; (1,0) directly above it is a void.
    const result = applyMove(state, { row: 2, col: 0 }, { row: 1, col: 0 });
    expect(result.state).toEqual(state);
    expect(result.events).toEqual([]);
    expect(result.steps).toEqual([]);
  });

  test('a legal swap resolves normally on a shaped board: objective credited, move spent, win fires', () => {
    const state = plusState();
    // Swap (2,2)B <-> (2,3)A → row 2 becomes A,A,A,B,C: a 3-run of A at cols 0-2.
    const result = applyMove(state, { row: 2, col: 2 }, { row: 2, col: 3 });

    expect(result.state.movesRemaining).toBe(9);
    expect(result.state.objectives[0].currentCount).toBe(3);
    expect(result.state.status).toBe('won');
  });

  test('gravity and refill never disturb the board shape — every void stays a void, nothing spawns into one', () => {
    const state = plusState();
    const result = applyMove(state, { row: 2, col: 2 }, { row: 2, col: 3 });

    for (const pos of voidPositions) {
      const cell = result.state.board[pos.row][pos.col];
      expect(cell.type).toBe('void');
    }
    // And no cell that should be playable turned into a void.
    const voidCount = result.state.board.flat().filter((p) => p.type === 'void').length;
    expect(voidCount).toBe(voidPositions.length);
    // The whole board is still legal to keep playing (or already won).
    expect(hasLegalMoves(result.state.board) || result.state.status === 'won').toBe(true);
  });

  test('running out of moves on a shaped board pauses exactly like a rectangle', () => {
    // One move left, an unreachable objective: the legal swap spends the last
    // move and the level pauses on moves rather than winning.
    const state = plusState({
      movesRemaining: 1,
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 99, currentCount: 0 }],
    });
    const result = applyMove(state, { row: 2, col: 2 }, { row: 2, col: 3 });
    expect(result.state.movesRemaining).toBe(0);
    expect(result.state.status).toBe('paused_awaiting_input');
    expect(result.state.pauseReason).toBe('moves');
  });

  // Regression coverage for the bug the playtest protocol surfaced: a
  // special's clear geometry (a striped sweep, an area-bomb blast, a
  // color-bomb detonation, or the chain reaction any of those trigger) only
  // ever excluded 'blocker' cells, the same way it did before voids existed.
  // On a shaped board that let a sweep/blast reach straight through a void,
  // which cloneBoardWithGaps then nulled and calculateCascades refilled as an
  // ordinary gap — permanently erasing the hole (and, on its way out, handing
  // the exiting-tile pipeline a void with no matchType, which resolves to the
  // undefined/"?" placeholder exactly like the original color-bomb bug). Every
  // clear-set builder now routes through the shared `isClearable` predicate,
  // which excludes both.
  describe('specials never clear through a void', () => {
    test('a striped sweep whose line crosses a void leaves the void in place', () => {
      // Row 0: A A X C void. Swapping (0,2)X with (1,2), a resting striped
      // piece, forms a 3-run of 'A' at (0,0)-(0,2) that includes the striped
      // piece, triggering its row sweep — straight through (0,4), the void.
      const board = buildShapedBoard([
        ['A', 'A', 'X', 'C', '.'],
        ['D', 'E', 'Y', 'F', 'G'],
        ['H', 'I', 'J', 'K', 'L'],
      ]);
      board[1][2] = { id: board[1][2].id, type: 'striped', matchType: 'A', direction: 'row' };
      const state: GameState = {
        board,
        movesRemaining: 10,
        lives: 5,
        objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 1, currentCount: 0 }],
        status: 'in_progress',
        pauseReason: null,
        totalCleared: {},
        layerCells: {},
        spawnPiece: queueSpawnPiece(['Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'Q']),
      };

      const result = applyMove(state, { row: 0, col: 2 }, { row: 1, col: 2 });

      expect(result.state.board[0][4].type).toBe('void');
      // The rest of the swept row did clear and refill as ordinary content —
      // the fix isn't "the sweep stopped working," only "it no longer eats
      // the void."
      expect(result.state.board[0][0].type).not.toBe('void');
      expect(result.state.board[0][1].type).not.toBe('void');
      expect(result.state.board[0][3].type).not.toBe('void');
    });

    test('an area-bomb blast overlapping a void leaves the void in place', () => {
      // A 3x3-ish board with a void at (0,2), inside the blast radius of an
      // area bomb resting at (1,1).
      const board = buildShapedBoard([
        ['A', 'B', '.'],
        ['C', 'Q', 'D'],
        ['E', 'F', 'G'],
      ]);
      board[1][1] = { id: board[1][1].id, type: 'area_bomb' };
      const state: GameState = {
        board,
        movesRemaining: 10,
        lives: 5,
        objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 1, currentCount: 0 }],
        status: 'in_progress',
        pauseReason: null,
        totalCleared: {},
        layerCells: {},
        spawnPiece: queueSpawnPiece(['Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'Q']),
      };

      // Swap the bomb with an ordinary neighbor to fire its 3x3 blast.
      const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 0 });

      expect(result.state.board[0][2].type).toBe('void');
    });

    test('a color-bomb + color-bomb whole-board detonation leaves every void in place', () => {
      const board = buildShapedBoard([
        ['A', 'B', '.'],
        ['C', 'D', 'E'],
        ['.', 'F', 'G'],
      ]);
      board[1][1] = { id: board[1][1].id, type: 'color_bomb' };
      board[1][2] = { id: board[1][2].id, type: 'color_bomb' };
      const state: GameState = {
        board,
        movesRemaining: 10,
        lives: 5,
        objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 1, currentCount: 0 }],
        status: 'in_progress',
        pauseReason: null,
        totalCleared: {},
        layerCells: {},
        spawnPiece: queueSpawnPiece(['Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'Q']),
      };

      const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 2 });

      expect(result.state.board[0][2].type).toBe('void');
      expect(result.state.board[2][0].type).toBe('void');
    });
  });
});
