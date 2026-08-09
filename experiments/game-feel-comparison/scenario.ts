// The single source of truth for the RN-vs-Unity game-feel comparison
// scenario (SPEC.md's "shared JSON fixture" decision): a 6x6 board where
// completing a swap forms a horizontal 4-run (-> a striped piece), which the
// very next cascade pass catches in a fresh 3-run and fires in-cascade. Both
// buildScenario.test.ts (which verifies this against the real engine and
// writes scenario.json) and the live RN dev harness (App.tsx's hidden
// game-feel-scenario entry point) import from here, so the board the test
// verifies and the board the app actually plays can never drift apart.
import { GameState, Objective } from '../../engine/gameState';
import { Board, Piece, Position } from '../../engine/matrix';

function piece(matchType: string, id: string): Piece {
  return { id, type: 'normal', matchType };
}

function buildBoard(letters: string[][]): Board {
  return letters.map((row, r) => row.map((matchType, c) => piece(matchType, `${r}-${c}`)));
}

export function queueSpawnPiece(queue: string[]): () => Piece {
  let counter = 0;
  return (): Piece => {
    const matchType = queue.shift();
    if (matchType === undefined) throw new Error('spawnPiece queue exhausted');
    counter += 1;
    return { id: `scenario-spawn-${counter}`, type: 'normal', matchType };
  };
}

// A cyclic Latin square (value(r,c) = letters[(c+r) % 6]) with cells
// overridden to set up the swap and a dormant legal move. Guaranteed
// match-free everywhere except the intended run, since no two adjacent
// cells (row or column) ever repeat by construction — verified directly in
// buildScenario.test.ts via checkMatches, not just argued here.
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const baseLetters: string[][] = Array.from({ length: 6 }, (_, r) =>
  Array.from({ length: 6 }, (_, c) => LETTERS[(c + r) % 6])
);
// (0,2) and (0,3): C,D -> A,A — sets up the 4-run's tail once (0,1) becomes 'A'.
baseLetters[0][2] = 'A';
baseLetters[0][3] = 'A';
// (1,1): C -> A — the piece swapped up into (0,1) to complete the run.
baseLetters[1][1] = 'A';
// A dormant, unrelated legal move (row 3 cols 1/2/4 = 'M', with a fourth 'M'
// parked one row below the col-3 gap) — rows 2-5 are never touched by this
// scenario's own clear/refill, so this sits inert throughout, existing only
// to satisfy applyMove's own "board must have a legal move after this
// settles" rescue (engine/gameState.ts, ~line 2180) so it doesn't fire a
// nondeterministic shuffle over an otherwise-legal-move-free hand-built board.
baseLetters[3][1] = 'M';
baseLetters[3][2] = 'M';
baseLetters[3][4] = 'M';
baseLetters[4][3] = 'M';

export const SCENARIO_BOARD: Board = buildBoard(baseLetters);
export const SCENARIO_MOVE: { from: Position; to: Position } = {
  from: { row: 0, col: 1 },
  to: { row: 1, col: 1 },
};
// Column-major spawn order (matrix.ts's calculateCascades: `for c in cols`),
// only columns with a clear consume a queue entry — see scenario.json's own
// "description" field and buildScenario.test.ts for the full derivation.
export const SCENARIO_SPAWN_QUEUE = ['A', 'A', 'C', 'G', 'H', 'I', 'J', 'K', 'L'];

// A generous, never-reachable-within-one-move objective so the dev harness
// can't accidentally "win" mid-capture.
const SCENARIO_OBJECTIVE: Objective = { type: 'score', targetCount: 999_999, currentCount: 0 };

export function buildScenarioGameState(): GameState {
  return {
    board: SCENARIO_BOARD,
    movesRemaining: 10,
    lives: 5,
    objectives: [{ ...SCENARIO_OBJECTIVE }],
    status: 'in_progress',
    pauseReason: null,
    totalCleared: {},
    layerCells: {},
    spawnPiece: queueSpawnPiece([...SCENARIO_SPAWN_QUEUE]),
  };
}
