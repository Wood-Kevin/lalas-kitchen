# Generator-driven clustered denial-zone placement — verification

`clustered-denial-zone.png` verifies that a denial-zone-eligible generated
level's blockers are now placed as one contiguous region from the moment the
level loads, instead of the original independent Fisher-Yates scatter (see
`engine/DECISIONS.md`'s clustered-denial-zone-placement entry and CLAUDE.md's
Phase 8 section).

## What changed

- `engine/generator.ts` gained `GeneratorConfig.clusterBlockers?: boolean` and
  a new `clusteredPositions` helper: pick one random start cell, then grow the
  region by repeatedly claiming a random cell off the frontier of cells
  adjacent to the region-so-far (falling back to reseeding a fresh region from
  a random unclaimed cell if the frontier ever dries up before reaching the
  requested count — e.g. a shape template splitting the board into
  disconnected pockets). `placeBlockers` branches on this flag; the original
  scatter path is completely unchanged when it's false/omitted.
- `engine/gameState.ts`'s `createGameState` is the one place the *gameplay*
  flag (`LevelConfig.denialSpread`, already gated in `appPersistence.ts` at
  `DENIAL_SPREAD_MIN_LEVEL_NUMBER = 10`) gets translated into the generator's
  purely-geometric `clusterBlockers` switch — `generator.ts` itself has no
  concept of what a "denial zone" is, only "scatter or grow one region."
- No other gate changed: a level below the threshold still gets
  `denialSpread: undefined`, so `clusterBlockers` is never even passed as
  `true` — completely unaffected by this session.

## Why this level's numbers

Captured against the **real** `buildGeneratedLevelConfig` at
`generatedLevelNumber === 10` (levelIndex 16, since `App.tsx`'s real
`LEVEL_QUEUE.length` is 6) — the exact real gate `DENIAL_SPREAD_MIN_LEVEL_NUMBER`
uses, the same level number `docs/verification/denial-zone-spread/` verified
the spread mechanic itself against. At this level: `blockerCount` is 4, the
rotation lands on `cling`, and `denialSpread` is `true`.

## What the image shows

A real `createGameState` board (8 rows x 5 cols, the real generated-level board
size) rendered with the skin's real bundled sprites and palette. The four
`cling` blockers sit at `(0,3)`, `(0,4)`, `(1,3)`, `(2,3)` — an unbroken
L-shaped region, each cell orthogonally adjacent to at least one other blocker
cell in the set. Contrast with the pre-existing scatter placement (still used
below the threshold, or with `clusterBlockers` omitted), which distributes the
same count independently at random across the whole board with no adjacency
guarantee at all.

## Engine outcomes asserted before the render

A throwaway `*.test.ts` harness (deleted after capture, per the WSL screenshot
note) called the real `buildGeneratedLevelConfig` → `createGameState` and,
**before** writing any HTML:

- `config.denialSpread === true` and `config.blockerCount > 0` — this really
  is a denial-zone-eligible level, not a hand-picked config.
- Exactly `config.blockerCount` blocker cells exist on the real board.
- A BFS over 4-directional adjacency confirmed those blocker cells form
  **one single contiguous region** — the actual claim this feature makes —
  not just "the same count, coincidentally close together."

All of this is also covered by real, permanent test coverage (not just the
one-off harness): see `engine/generator.test.ts`'s "clustered blocker
placement (denial-zone-eligible levels)" describe block (contiguity via the
same BFS check, existing no-accidental-match/legal-move guarantees still hold,
a disconnected-shaped-board reseed case, determinism, and that omitting the
flag reproduces the exact pre-existing scatter output byte-for-byte) and
`engine/gameState.test.ts`'s two new `createGameState` tests (a
`denialSpread: true` level clusters; the same config without it doesn't).

## Where the logic and tests live

- `engine/generator.ts` — `GeneratorConfig.clusterBlockers`, `clusteredPositions`,
  `placeBlockers`'s branch.
- `engine/gameState.ts` — `createGameState`'s `clusterBlockers: config.denialSpread`
  translation.
- `appPersistence.ts` — `DENIAL_SPREAD_MIN_LEVEL_NUMBER` (10) and
  `buildGeneratedLevelConfig`, unchanged by this session.
- Tests: `engine/generator.test.ts`, `engine/gameState.test.ts`. All 503
  project tests pass (`npx jest`).
