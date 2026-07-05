# Void-cell clearing fix — specials no longer eat through a void

`striped-sweep-through-void.png` — captured via the same headless-Chromium
pass the prior verifications used, against a throwaway harness (not in the
repo) that drives the **real `applyMove`**, the **real `getSpriteForPiece` +
`spriteLabel`** sprite-resolution path, and the real bundled sprite art
(`skins/lalas-kitchen/sprites/*.webp`), on the **real Cutting Board shape**
(`App.tsx`'s `PLUS_SHOWCASE_VOIDS` — the four 2×2 corner blocks on a 7×7 grid).

The scenario: a resting striped piece (`direction: 'row'`) sits one cell below
the top of the shape's vertical arm. Swapping it up completes a 3-run of
`tomato` at the top of the arm, which is only 3 cells wide there (the rest of
that row is void) — so the piece's row sweep reaches straight through the
board edge on both sides, directly into the void corners on either flank.

Four panels: the shaped board before and after the sweep, then the identical
scenario replayed on a plain rectangle of the same size (no `voidCells`) before
and after, for direct comparison.

What the capture proves end-to-end:

- **Before the fix**, this exact scenario turned two of the shaped board's void
  corners into ordinary spawned content, and the exiting piece rendered as the
  `'?'` placeholder on its way out.
- **After the fix**, every void corner is still empty (no tile at all,
  background showing through) in the "after sweep" panel — the fix, not just
  "the sweep stopped clearing anything": the sweep still resolves normally,
  crediting the objective and refilling the arm's playable cells with real,
  arted ingredient sprites.
- No panel — shaped or rectangular, before or after — ever renders the `'?'`
  placeholder. The harness also asserts this directly in code (scanning every
  live cell's resolved sprite label) before writing the image, so the capture
  can't claim success on a broken run.
- The rectangular replay behaves identically to the shaped board's playable
  region — confirming the bug (and the fix) is specific to boards with void
  cells, not a general regression in the sweep/sprite pipeline.

The harness is deleted after capture; the behaviour it exercised is covered
permanently by the automated tests below.

## Root cause (see `engine/DECISIONS.md`'s "Fixed: the ... claim above didn't
hold" entry for the full account)

Five places that build a special's swap-triggered clear set (`resolveMatchEffects`'s
striped sweep, `expandChainClears`, `resolveAreaBomb`, `resolveColorBomb`, and
`keysToClearablePositions`) were written before non-rectangular boards existed
and only ever excluded `'blocker'` cells from the clear set, never `'void'`.
A sweep/blast that geometrically reached a void cell added it to the clear set;
`calculateCascades`'s segmented-gravity refill then read the nulled void
position as an ordinary gap (its `isVoid` check requires an actual void
`Piece`, not `null`) and refilled it with a spawned piece — permanently
erasing part of the board's shape. The swallowed void also reached the
exiting-tile pipeline with no `matchType`, resolving to the same `'?'`
placeholder the original color-bomb bug produced (see the two-sprite-path
entry in `DECISIONS.md`), one layer upstream of that fix.

Fix: a single shared `isClearable(piece)` predicate in `engine/gameState.ts`
(`type !== 'blocker' && type !== 'void'`, mirroring `matrix.ts`'s existing
`swappable` guard in `hasLegalMoves`), used at all five sites instead of five
independent `!== 'blocker'` checks.

## Automated coverage (jest, always-on)

- `engine/gameState.test.ts` › **applyMove — non-rectangular (void) board ›
  specials never clear through a void**: a striped sweep whose line crosses a
  void, an area-bomb blast overlapping a void, and a color-bomb+color-bomb
  whole-board detonation — each confirms every void cell in reach stays a void.
- `components/exitingTile.test.ts` (unchanged, still passing): confirms the
  exit-tile pipeline itself was never reverted — this bug was one layer
  upstream of that fix, not a regression of it.
