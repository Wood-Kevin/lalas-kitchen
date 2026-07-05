# Special-piece combos — the striped + bomb payoff

`combos-filmstrip.png` verifies the two special-piece combinations, each shown as
a before → combo-fires → after sequence driven by the **real** `applyMove`.

## What the image shows

Each row is one combo. The middle "Combo fires — cells cleared" panel is the
pre-move board with the cells the combo cleared knocked out (dashed slots), so
the footprint is directly visible. The cleared set is computed with the **real**
`diffBoards` (pre-move board vs. the first settled step), not drawn by hand.

- **Combo 1 — two striped pieces swapped clear a full cross.** The ringed pair is
  a striped tomato (a row-clearer) and a striped lemon (a column-clearer),
  swapped into each other. The result is one **full cross** — the entire row and
  entire column through the swap cell — not two parallel lines: the combo
  overrides each piece's own direction (see `resolveStripedCross`).
- **Combo 2 — striped + color bomb supercombo.** The ringed pair is a striped
  tomato and the color bomb (the glowing potion bottle). Every tomato on the
  board is converted to a striped piece and fired at once, clearing a lattice of
  full rows and columns. The surviving cells are exactly those on no swept line —
  the alternating row/col directions assigned by discovery order (see
  `resolveStripedBombCombo`).

## How the image was produced

A throwaway harness (deleted after capture, per the WSL screenshot note) built
each board on a diagonal Latin square (`type = TYPES[(r+c) % 6]`, so the base
board has zero ordinary matches — every cleared cell is the combo, not an
incidental cascade), placed the special pieces, and ran the **real** `applyMove`.
Rendered with the **real** bundled `.webp` art through the same
`getSpriteForPiece` → `resolveSpriteAsset` path the app uses, captured with
Windows Chrome headless.

## Where the logic and tests live

- `engine/gameState.ts` — `resolveStripedCross`, `resolveStripedBombCombo`, the
  shared `resolveClearSet` pipeline, and the combo precedence in `applyMove`
  (striped+bomb checked before the solo-bomb branch — see that block's comment).
- `engine/matrix.ts` — `hasLegalMoves` treats a striped+striped pair as always
  legal (striped+bomb is already legal via the color-bomb clause).
- `engine/gameState.test.ts` — the `applyMove — special piece combos` block:
  cross clears the exact cross and nothing else; the supercombo converts and
  clears every matching piece; both combo swaps are legal with no ordinary match;
  and a blocker caught in either combo takes one adjacent hit, never a
  force-clear. All 227 tests pass.
