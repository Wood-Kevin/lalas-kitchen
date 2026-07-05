# Dynamic denial-zone spread — verification

`denial-spread-filmstrip.png` verifies the **dynamic denial-zone spread**
mechanic (see `engine/DECISIONS.md`'s denial-zone-spread entry and CLAUDE.md's
Data Model Notes): on a gated generated level, a blocker denial zone that's left
unaddressed **spreads into an adjacent ordinary cell**, and the move before it
spreads the frontier cell shows a **calm crack + dimming glow** so the growth is
never silent or sudden.

Captured the same way the area-bomb / color-bomb verifications were — a throwaway
`*.test.ts` harness (deleted after capture, per the WSL screenshot note) that
drives the **real `applyMove`** through the **real `stepDenialZone`** logic and
projects each real post-move board to HTML on the skin's real palette using the
app's real bundled sprites. **Every engine outcome is asserted with `expect()`
before the image is written**, so the artifact can't claim success on a broken
run. The warning overlay's CSS mirrors `components/Tile.tsx`'s
`SpreadWarningOverlay` (dark dimming wash + accent glow + a thin diagonal crack).

## Why this level's numbers

The header numbers are the **real** gated level-10 values, not invented: a
generated level at `generatedLevelNumber === 10` has `movesLimit 20`, places 4
blockers, and — being at or past `DENIAL_SPREAD_MIN_LEVEL_NUMBER` (10) — has
`denialSpread: true` (asserted directly against `buildGeneratedLevelConfig`).
`createGameState` derives `spreadInterval = round(0.25 × 20) = 5` from that budget
(a 30-move level would derive 8 — the timing is proportional, not fixed). The
demo uses a 2×2 `cling` cluster (the blocker the generator rotates in at level
10) and an unaddressed match far from the cluster each move.

## What the image shows

- **1 · Zone at rest.** The 2×2 cling cluster sits quiet. The spread clock is at
  3 of 5 unaddressed moves — no warning. Four blockers.
- **2 · Warning (move before spread).** An unaddressed move takes the clock to 4
  of 5. The deterministic frontier cell (the ordinary cell right of the cluster)
  shows the crack + dimming glow. It is **still an ordinary, matchable piece**
  (`type === 'normal'`, `spreadWarning === true`) — matching it, which damages the
  adjacent blocker, is exactly how a player defuses the spread. Still four
  blockers: nothing has spread yet, and this board is visibly distinct from
  panel 1.
- **3 · Spread.** One more unaddressed move (clock 5): the cracked cell has become
  a `cling` blocker — the top row now shows three cling tiles. **Five** blockers;
  warning gone; clock reset to 0.

## Engine outcomes asserted before the render

- Panel 1: 4 blockers, 0 warnings on the raw board.
- Panel 2: a real move was spent (`movesRemaining 20 → 19`); **4** blockers (no
  spread); exactly **1** warning; the warned cell is `type === 'normal'` with
  `spreadWarning === true`.
- Panel 3: **5** blockers; the frontier cell is now `type === 'blocker'`; **0**
  warnings; `denialSpread.movesUnaddressed` reset to 0.

## Where the logic and tests live

- `engine/matrix.ts` — the `spreadWarning` field on `Piece`; `findSpreadTarget`
  (the deterministic frontier scan).
- `engine/gameState.ts` — `DenialSpreadState`, the `SPREAD_MOVE_FRACTION`
  interval derivation in `createGameState`, and `stepDenialZone` (called in
  `applyMove` before the legal-move rescue).
- `appPersistence.ts` — `DENIAL_SPREAD_MIN_LEVEL_NUMBER` (10) and the
  `buildGeneratedLevelConfig` gate.
- `components/Tile.tsx` / `components/Board.tsx` — `SpreadWarningOverlay` and the
  `spreadWarning` prop wiring.
- Tests: `engine/gameState.test.ts` (`applyMove — dynamic denial-zone spread`:
  below-threshold never spreads, spread at interval for two budgets, proportional
  interval derivation, warning distinguishable, addressing resets the clock) and
  `engine/matrix.test.ts` (`findSpreadTarget`). All tests pass.
