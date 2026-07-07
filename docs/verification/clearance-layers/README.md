# Clearance layers — verification

Verifies the new `'clearance'`-type objective (see `engine/gameState.ts`'s
`ObjectiveType`, `GameState.layerCells`, `decrementLayers`, and
`engine/DECISIONS.md`'s clearance-layers entry): certain grid cells carry a
hidden per-cell layer count (1 or 2, the level author's choice) that
decrements whenever the piece sitting on that cell is cleared by ANY
effect — not a piece type itself, a property of the cell — with the win
condition being every layered cell reaching zero layers remaining.

## How it was captured

Real Expo-web app (`expo start --web`), driven over CDP against headless
Windows Chrome from WSL — the same rig `docs/verification/score-objective/`
and `docs/verification/denial-zone-spread/` established. A save was seeded
directly into `localStorage` (the real key is `save:cooking-lalas-kitchen` —
no app-slug prefix, confirmed empirically against a genuinely fresh Chrome
profile before trusting it, since an earlier assumption borrowed from a
different verification session's README turned out not to hold in this
environment) with `completedLevels: [1, 2, 3, 4, 5]`, so the real "next
unplayed level" logic (`resolveNextUnplayedLevel`) resolved to Level 6 —
App.tsx's new hand-built "Dusty Counter" level (`objectives: [{ type:
'clearance' }]`, `layerCells: DUSTY_COUNTER_LAYERS`) — reachable through
Home's ordinary "Start cooking" flow, not a temporary code change. The two
legal moves were found by running the real, unmocked engine
(`engine/generator.ts`'s `generateLevel(501, ...)` — Level 6's actual seed —
piped into `engine/matrix.ts`'s `checkMatches` over every adjacent swap, in a
throwaway jest test deleted after use) to find swaps that land a match
directly on a layered cell, then dispatched as real tap gestures
(`Input.dispatchMouseEvent`) on the actual tile DOM nodes
(`[data-testid="tile-<row>-<col>"]`), matching this repo's established
tap-to-select-then-tap-adjacent convention.

## What the images show

- **`01-home-up-next.png`** — Home's "Up Next" card for Level 6, showing the
  new ▤ glyph (`components/spriteAsset.ts`'s `CLEARANCE_OBJECTIVE_SPRITE`)
  instead of a piece-type icon (`components/Home.tsx`'s
  `nextLevel.objectiveType === 'clearance'` branch) — confirms the Home
  preview never resolves a `'clearance'` objective's absent `targetMatchType`
  through `getSpriteForMatchType` (which would produce the "?" placeholder
  this codebase treats as a genuine-bug signal elsewhere).
- **`02-level-loaded.png`** — Level 6 "Dusty Counter" freshly loaded: the
  HUD's Target panel reads "▤ 0/8" (`components/Hud.tsx`) — 8 is the sum of
  `DUSTY_COUNTER_LAYERS`' layer counts (App.tsx), never hand-authored
  separately (see `createGameState`'s derived `targetCount`). Six tiles show
  a visibly lighter dusting wash (`components/Tile.tsx`'s new
  `LayerOverlay`) than the rest of the board — the two 2-layer cells read
  slightly denser than the four 1-layer cells, per `LAYER_OPACITY_STEP`.
- **`03-after-move1-layer-1-1-lightened.png`** — after swapping (2,1)/(2,2),
  clearing a vertical 3-run in column 1 (rows 1-3) that includes the 2-layer
  cell at (1,1): Target now reads "▤ 1/8", Moves ticked down to 23 (a real
  move was spent), and the refilled cell at (1,1) still shows a wash, now
  visibly lighter (2 layers → 1, not yet fully cleared) — confirming a
  multi-layer cell survives a single clear rather than vanishing outright.
- **`04-after-move2-layer-3-0-cleared.png`** — after swapping (5,0)/(6,0)
  (column 0 was untouched by move 1, so tile ids there were still their
  original `<row>-<col>` form), clearing a vertical 3-run in column 0 (rows
  3-5) that includes the 1-layer cell at (3,0): Target now reads "▤ 2/8",
  Moves 22, and the refilled cell at (3,0) shows NO wash at all — its one
  layer reached 0 and the overlay disappeared entirely, exactly as a
  single-layer cell should. A direct DOM check confirmed 5 of the original 6
  `[data-testid="layer-overlay"]` nodes still present (the untouched 4 cells
  plus the still-1-remaining (1,1) cell), not 6 or 4 — the exact count a
  correct implementation predicts.

## Test coverage

`engine/gameState.test.ts`'s new "applyMove — clearance layers" describe
block covers, against the real engine (no mocks): a plain ordinary 3-match
reducing a 1-layer cell to 0 and winning a clearance objective at its
derived target; a 2-layer cell needing two separate clears (via two
independent `applyMove` calls carrying the layer/objective state forward)
before reaching 0; a layer under a cell reached only by an in-match striped
sweep (not the triggering 3-match itself) still decrementing — proving the
shared clear-set pipeline, not a special case; a layer under a cell caught in
a solo color-bomb detonation decrementing the same way; a clearance objective
coexisting with a collect objective on the same level, each updating
independently from one move; and a move that clears no layered cell leaving
`layerCells` and the objective untouched. `createGameState`'s existing
describe block gained cases confirming `layerCells` wires into a fresh
`GameState` keyed by `"row,col"`, that a `'clearance'` objective's
`targetCount` is derived from summing `layerCells` (never hand-authored), and
that omitting `layerCells` leaves `GameState.layerCells` an empty object. All
492 tests pass.

## Where the logic lives

- `engine/gameState.ts` — `ObjectiveType`/`Objective` (the `'clearance'`
  variant), `LevelConfig.layerCells`/`LevelConfig.objectives`' `{ type:
  'clearance' }` config shape, `GameState.layerCells`, `decrementLayers`, the
  `clearedPositions` field threaded through `CascadeResolution`/
  `resolveCascades`/`resolveClearSet` (exposing the exact same clear-set
  bookkeeping every existing effect — ordinary match, sweep, chain, combo,
  bomb — already produces, as raw positions rather than matchType counts),
  and `applyMove`'s `layersCleared`-driven objective update.
- `components/Tile.tsx` — `LayerOverlay`/`LAYER_OPACITY_STEP`, the new
  `layersRemaining` prop.
- `components/Board.tsx` — wiring `gameState.layerCells[`${r},${c}`]` into
  each `Tile`'s `layersRemaining` prop.
- `components/Hud.tsx`, `components/WonOverlay.tsx`, `components/Home.tsx`,
  `components/levelProgress.ts` — the presentation-layer fallback for a
  `'clearance'` objective's missing `targetMatchType`
  (`CLEARANCE_OBJECTIVE_SPRITE` in `components/spriteAsset.ts`).
- `App.tsx` — `LEVEL_QUEUE`'s new sixth entry, "Dusty Counter", and
  `DUSTY_COUNTER_LAYERS`.

## Scope note

Hand-built level content only, per this session's explicit scope — generator
integration (`buildGeneratedLevelConfig` never producing a `'clearance'`
objective or `layerCells`) is a separate, later step. See
`DEFERRED_COMPLEXITY.md`. Also deferred: a layered cell coexisting with a
blocker on the same cell (this session scoped layered cells to
ordinary/special matchable pieces only, a confirmed judgment call — see
`engine/DECISIONS.md`'s clearance-layers entry).
