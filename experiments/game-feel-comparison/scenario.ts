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
//
// Real Lala's Kitchen ingredient ids (skins/lalas-kitchen/config.json's
// pieceTypes), not abstract letters — a real playtest report ("both are
// empty ass boxes, hard to say [how the juice feels]") found the original
// A-F/G-L placeholder scheme unusable for judging the actual comparison:
// getSpriteForMatchType only resolves a piece to real sprite art when its
// matchType is one of these six real ids, so the dev harness rendered every
// tile as a bare "?" text-label placeholder. Swapping in the real ids costs
// nothing structurally — checkMatches only cares that adjacent cells
// differ, never what the string itself means — and the RN dev harness
// already has these sprites bundled, so this is a same-session, same-risk
// substitution, re-verified against the real engine below exactly like the
// original scheme was.
const LETTERS = ['tomato', 'lemon', 'herb', 'garlic', 'chili', 'spoon'];
const baseLetters: string[][] = Array.from({ length: 6 }, (_, r) =>
  Array.from({ length: 6 }, (_, c) => LETTERS[(c + r) % 6])
);
// (0,2) and (0,3): herb,garlic -> tomato,tomato — sets up the 4-run's tail
// once (0,1) becomes 'tomato'.
baseLetters[0][2] = 'tomato';
baseLetters[0][3] = 'tomato';
// (1,1): herb -> tomato — the piece swapped up into (0,1) to complete the run.
baseLetters[1][1] = 'tomato';
// A dormant, unrelated legal move (row 3 cols 1/2/4 = 'M', with a fourth 'M'
// parked one row below the col-3 gap) — rows 2-5 are never touched by this
// scenario's own clear/refill, so this sits inert throughout, existing only
// to satisfy applyMove's own "board must have a legal move after this
// settles" rescue (engine/gameState.ts, ~line 2180) so it doesn't fire a
// nondeterministic shuffle over an otherwise-legal-move-free hand-built board.
// Deliberately LEFT as the abstract 'M' (not remapped to a real ingredient
// id) alongside the real-sprite change above: 'M' cells never participate in
// the scripted move/clear/refill a viewer actually watches (they exist only
// to keep the shuffle-rescue from firing), and picking a real id for them
// risks colliding with a real-ingredient neighbor by coincidence in a way
// 'M' — deliberately chosen distinct from every cyclic neighbor — cannot.
// Four placeholder-labeled tiles in a corner nobody's attention goes to is a
// real, disclosed, low-cost tradeoff, not an oversight.
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
// First three (cols 0/2/3's pass-0 refill) mirror the cleared run's own
// ingredient (tomato, tomato, herb — herb because col3's cleared cell was
// itself a 'garlic', but the ORIGINAL A-F scheme's third queue entry was
// 'C' independent of what it replaced, since a refill's matchType was never
// tied to the cell it fills; kept as 'herb' — LETTERS[2] — to preserve that
// same "arbitrary but structurally safe" property). The final six (the
// post-sweep full-row refill) reuse the same six real ids one more time —
// re-verified below against the real engine, exactly like the original
// scheme's own G-L letters were, to confirm no accidental new match forms
// against row 1's real-ingredient values.
export const SCENARIO_SPAWN_QUEUE = [
  'tomato', 'tomato', 'herb',
  'tomato', 'lemon', 'herb', 'garlic', 'chili', 'spoon',
];

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
