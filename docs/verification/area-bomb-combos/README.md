# Area-bomb combos — the last three pairings

`filmstrip.png` verifies the three remaining area-bomb combos (area + color
bomb, area + striped, area + area), each shown as a Before (swap pair ringed)
→ Combo fires (cleared cells dashed) → After (settled) sequence driven by the
**real** `applyMove`. These three pairings previously snapped back with no
move spent (see `engine/DECISIONS.md`'s "The area+special fork" entry) — this
session replaced that snap-back with a real combined effect for each pairing.

## What the image shows

- **Combo 1 — area bomb + color bomb.** The ringed pair is the area bomb
  (burlap sack) and the color bomb (potion bottle). Four real "tomato"
  ingredient pieces are scattered far apart on the board; every other cell has
  a wholly distinct matchType so nothing can match by accident. The board's
  most-common matchType is unambiguously "tomato" (4 occurrences vs. 1 each for
  every other cell), so all four convert into area bombs and fire at once —
  four separate 3×3 blocks clear simultaneously, plus the two swapped bombs'
  own cells (`resolveAreaColorCombo`).
- **Combo 2 — area bomb + striped piece.** The ringed pair is the area bomb
  and a column-striped lemon. The result is a plus shape: the bomb's own 3×3
  block unioned with the striped piece's FULL column sweep — the cleared panel
  shows the sweep reaching rows 0 and 4, well beyond the 3×3 block itself
  (`resolveAreaStripedCombo`).
- **Combo 3 — area bomb + area bomb.** Two area bombs swapped directly into
  each other fire a single bigger 5×5 blast, not two separate 3×3s — the
  cleared panel shows one unbroken 5×5 square centered on the first bomb's own
  cell (`resolveAreaAreaCombo`).

## How the image was produced

A throwaway harness (deleted after capture, per the WSL screenshot note —
same pattern as `docs/verification/special-piece-combos/`) built each board
with a wholly distinct matchType per cell (so no ordinary match or square can
form by accident — `checkMatches`/`checkSquares` both asserted empty
pre-move), placed the two specials, and ran the **real** `applyMove`. The
cleared-cell panel is computed from a real diff between the pre-move board and
the settled board, not drawn by hand. Rendered with the real bundled `.webp`
sprite art through the same `getSpriteForPiece` → skin config path the app
uses (`resolveSpriteAsset`'s own fallback renders the deliberately-untouched
background cells as plain text labels — expected, not an error). Captured
with Windows Chrome headless (`--screenshot`), per the project's WSL
screenshot-verification convention.

## Engine outcomes asserted before the render

- Pre-move: `checkMatches` and `checkSquares` both empty for every scenario.
- Combo 1: exactly 4×9 + 2 = 38 cells cleared; `movesRemaining === 9`;
  `multiSpecialFired === true`.
- Combo 2: exactly 11 cells cleared (the 3×3 block plus 2 sweep cells beyond
  it); `movesRemaining === 9`; `multiSpecialFired === true`.
- Combo 3: exactly 25 cells cleared (the full 5×5); `movesRemaining === 9`;
  `multiSpecialFired === true`.

## Where the logic and tests live

- `engine/gameState.ts` — `resolveAreaColorCombo`, `resolveAreaStripedCombo`,
  `resolveAreaAreaCombo` (all routed through the shared `resolveClearSet`),
  and the rewired `applyMove` area-bomb branch (dispatches by partner type
  instead of snapping back; still runs before the solo-color-bomb branch, for
  the same colorless-piece reason the striped+bomb combo already established).
  `areaBlastPositions` gained an optional `radius` parameter (default 1) for
  the area+area combo's 5×5.
- `engine/matrix.ts` — `findAnyLegalMove`'s area-bomb clause collapsed to
  `return true` unconditionally, since every area-bomb pairing is legal now.
- `engine/gameState.test.ts` — the `applyMove — area bombs` describe block:
  one test per combo (exact footprint, specials fully consumed,
  `multiSpecialFired`), plus a rewritten `hasLegalMoves` test asserting all
  three area+special pairings are legal. The old snap-back test is gone,
  replaced rather than left dead alongside the new code. All 494 tests pass.

See `engine/DECISIONS.md`'s "Area-bomb combos: the last three pairings" entry
for the full design writeup.
