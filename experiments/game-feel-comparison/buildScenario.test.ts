// Verifies experiments/game-feel-comparison/scenario.ts against the real
// engine and writes scenario.json — the fixed board + move both SPEC.md
// tracks (RN and Unity) build their juice pass against, per SPEC.md's
// "shared JSON fixture" decision. Not a coverage test for
// engine/gameState.ts (that lives in engine/gameState.test.ts) — this is
// the project's own "paste the exact board state into a test, read what
// comes back" debugging convention (CLAUDE.md), applied to hand-design a
// specific scenario rather than to chase a bug. scenario.ts is the single
// source of truth for the board itself (the live RN dev harness imports the
// same module), so this file only verifies and serializes it.
//
// Scenario: a 6x6 board where swapping (0,1)/(1,1) completes a horizontal
// 4-run at row 0, cols 0-3 (anchor at the swapped-in cell, (0,1), per the
// spawn-anchor rule) — spawning a striped ('row') piece there. The next
// cascade pass's gravity refill (hand-scripted via a spawn queue, not RNG)
// drops two more 'A' pieces into row 0 cols 0 and 2, forming a new 3-run
// that includes the anchor — so the striped piece fires its own sweep
// in-cascade (the ordinary "caught in a later match" trigger described in
// CLAUDE.md's chaining paragraph, not the multi-special chain-reaction
// mechanism), clearing the whole row. One real cascade + one real
// special-piece trigger, in a single move — deliberately not the most
// complex case (no combos/chains), per SPEC.md's scope.
import * as fs from 'fs';
import * as path from 'path';
import { applyMove } from '../../engine/gameState';
import { checkMatches } from '../../engine/matrix';
import { SCENARIO_BOARD, SCENARIO_MOVE, SCENARIO_SPAWN_QUEUE, buildScenarioGameState } from './scenario';

describe('game-feel comparison scenario fixture', () => {
  test('initial board is settled (no pre-existing matches)', () => {
    expect(checkMatches(SCENARIO_BOARD)).toEqual([]);
  });

  test('the swap completes a 4-run, spawns a striped piece, and it fires in-cascade', () => {
    const state = buildScenarioGameState();
    const result = applyMove(state, SCENARIO_MOVE.from, SCENARIO_MOVE.to);

    // Move committed (not a rejected snap-back).
    expect(result.state.board).not.toEqual(state.board);
    expect(result.swapCommitted).toBe(true);

    // Two cascade passes: the 4-run -> striped spawn, then the in-match
    // sweep that catches it. (steps includes one snapshot per pass.)
    expect(result.steps.length).toBe(2);

    // Pass 0: anchor (0,1) is now a live 'row' striped piece; the rest of
    // row 0's run cleared and refilled ('A' at col0/col2 per the queue).
    const pass0 = result.steps[0];
    expect(pass0[0][1]).toMatchObject({ type: 'striped', direction: 'row', matchType: 'A' });
    expect(pass0[0][0].matchType).toBe('A');
    expect(pass0[0][2].matchType).toBe('A');

    // Pass 1: the striped piece was caught in the new 3-run and fired its
    // row sweep — the entire row 0 is now fresh filler, no piece carries
    // 'A' anymore in that row, and the anchor is no longer striped (it
    // cleared as part of its own sweep).
    const finalBoard = result.state.board;
    expect(finalBoard[0].map((p) => p.matchType)).toEqual(['G', 'H', 'I', 'J', 'K', 'L']);
    expect(finalBoard[0].every((p) => p.type === 'normal')).toBe(true);

    // Nothing left unresolved — a settled board after this move.
    expect(checkMatches(finalBoard)).toEqual([]);

    // This is the ordinary "caught in a later match" trigger, not the
    // multi-special chain-reaction mechanism (only one special ever
    // existed on the board this move).
    expect(result.multiSpecialFired).toBe(false);

    // Write the shared fixture both tracks build against.
    const fixture = {
      description:
        "RN-vs-Unity game-feel comparison scenario (SPEC.md, 'shared JSON fixture' decision): " +
        'a 4-run spawns a striped piece that fires its row sweep in the same move.',
      board: {
        rows: 6,
        cols: 6,
        pieces: SCENARIO_BOARD.map((row) => row.map((p) => ({ id: p.id, matchType: p.matchType }))),
      },
      move: SCENARIO_MOVE,
      spawnQueue: SCENARIO_SPAWN_QUEUE,
      expected: {
        passCount: result.steps.length,
        steps: result.steps.map((board) =>
          board.map((row) =>
            row.map((p) => ({ id: p.id, type: p.type, matchType: p.matchType ?? null, direction: p.direction ?? null }))
          )
        ),
        finalRow0MatchTypes: finalBoard[0].map((p) => p.matchType),
        score: result.score,
        swapCommitted: result.swapCommitted,
        multiSpecialFired: result.multiSpecialFired,
        chainWaveByPieceId: result.chainWaveByPieceId,
      },
    };

    const outPath = path.join(__dirname, 'scenario.json');
    fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
  });
});
