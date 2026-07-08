# Generator-driven clearance objectives — verification

Verifies `engine/DECISIONS.md`'s "Generator-driven clearance objectives"
entry: `appPersistence.ts`'s `buildGeneratedLevelConfig` now occasionally
places a `'clearance'` objective with real `layerCells`, past
`isClearanceObjectiveLevel`'s gate (levelNumber >= 5, every 4th level),
never mixed with blockers (forced to 0 on those levels) or placed on a void
cell.

## How this was captured

The Expo web dev server on `localhost:8082`, driven from WSL2 over raw CDP
against headless Windows Chrome, using this repo's own `node_modules/ws`.

A crafted save was written directly to `localStorage` with
`completedLevels: [1..11]` and `currentLevel: 12`, then reloaded. Real level
12 (7 hand-built `LEVEL_QUEUE` levels + generatedLevelNumber 5) is the first
level `isClearanceObjectiveLevel` gates in — and it's independently shaped
too (`generatedShapeId(5)` is on its own cadence), letting one real level
confirm clearance objectives compose correctly with board shapes and the
blocker-suppression rule at once.

1. Clicked "Start cooking" into level 12. `level12-board.png` — the real
   HUD's Target panel reads **"▤ 0/5"** (the clearance-objective glyph), the
   board is visibly non-rectangular (voids carve a diamond-like silhouette,
   narrower at top/bottom, matching a curated shape template), and **no
   blocker tile appears anywhere on the board**.
2. The target of 5 (not the "Dusty Counter" precedent's 6) confirms the
   density formula is genuinely proportional to the real *playable* cell
   count on this shaped board, not a hardcoded number: fewer playable cells
   (due to the void carve-out) correctly yields fewer layered cells,
   summed into the objective's target the same way `createGameState`
   already derives it from `layerCells` for the hand-built level.
3. The complete absence of a blocker tile is the real confirmation of the
   forced `blockerCount: 0` override — this exact levelNumber (5) would
   otherwise have had a real eligible blocker (`generatedBlockerCount(5)`
   is nonzero), so its absence here isn't a coincidence of the blocker
   rotation, it's the override actually taking effect.

## Where the logic and tests live

- `appPersistence.ts` — `isClearanceObjectiveLevel`, `generatedLayerCells`,
  and `buildGeneratedLevelConfig`'s new `useClearanceObjective` branch
  (including forcing `blockerCount` to 0).
- `appPersistence.test.ts` — new `isClearanceObjectiveLevel`/
  `generatedLayerCells` describe blocks (gate/cadence, density matching
  Dusty Counter's own ratio, void-cell exclusion, determinism), plus four
  new `buildGeneratedLevelConfig` integration tests (places a real
  clearance objective with real layerCells; gets no blockers even when the
  rotation would otherwise place them; still gets its board shape, with
  layerCells never colliding with the real generated voidCells; an
  off-cadence level stays plain collect).

Full suite: 586 tests passing (up from 574 before this session).
