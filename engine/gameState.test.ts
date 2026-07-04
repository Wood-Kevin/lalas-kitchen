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
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 6, currentCount: 0 }],
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
      objectives: [{ type: 'collect', targetMatchType: 'A', targetCount: 100, currentCount: 0 }],
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
      objectives: [{ type: 'collect', targetMatchType: 'ZZ', targetCount: 100, currentCount: 0 }],
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
      spawnPiece: queueSpawnPiece([]),
    };

    const result = applyMove(state, { row: 1, col: 1 }, { row: 1, col: 0 });
    expect(result.state).toEqual(state);
    expect(result.events).toEqual([]);
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
