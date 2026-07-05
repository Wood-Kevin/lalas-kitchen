# 2x2 square with a striped corner — fires the sweep, not a new area bomb

`before-after.png` — captured via the same headless-Chromium pass the prior
verifications used, against a throwaway harness (not in the repo) that drives
the **real `applyMove`** and the **real `getSpriteForPiece`** sprite-resolution
path with the real bundled sprite art.

The scenario: a resting striped tomato (`direction: 'col'`, green-ringed in the
capture) sits at one corner of an otherwise-complete 2x2 block of tomatoes.
Swapping the fourth tomato into place completes the square.

What the capture proves end-to-end:

- **Before the fix**, this exact shape silently did nothing — `checkSquares`
  required all four corners to be `type: 'normal'`, so a live striped piece in
  a corner (same as a blocker or a void) meant the square was never even
  detected, regardless of matching `matchType`.
- **After the fix**, the square is detected and the pre-existing striped piece
  fires its own sweep instead of a new area bomb spawning: the "after" panel
  shows the striped tomato and its whole swept column gone, refilled with
  ordinary content, and **zero** area bombs anywhere on the board.
- Real ingredient art renders throughout both panels — no placeholder, no `?`.

## The design question and the confirmed answer

Real play surfaced the null result (nothing happens when a square's fourth
piece would complete it, because one of the other three is already a special).
The question had a real fork — architect-confirmed before building:

- **(Built)** A live special corner still counts toward the square; instead of
  spawning a new special, the existing one fires its own effect (the striped
  piece sweeps and clears itself, alongside the other three cells), mirroring
  the identical rule the run path already applies (a run containing a live
  striped piece fires it rather than spawning a second special).
- (Rejected) Leave it as a silent non-event, identical to a blocker/void corner.
- (Rejected) Convert the striped piece into a new area bomb without firing its
  sweep — silently destroys the earned special without giving its effect,
  conflicting with the "a special never just vanishes as ordinary content"
  principle chaining already established.

## Root cause (see `engine/DECISIONS.md`'s square+striped entry for the full account)

`matrix.ts`'s `checkSquares` required every corner to satisfy `type ===
'normal'` — the same gate that (correctly) excludes a blocker or void also
excluded an already-special piece, even though `piecesMatch`'s own matchType
comparison would have accepted it. This was a deliberate but under-considered
choice (an existing `matrix.test.ts` case explicitly asserted a striped corner
made a square disappear, lumped in with the blocker case) that never accounted
for the run path's own precedent.

Fix: `checkSquares` now accepts a `'normal'` OR live `'striped'` corner (via a
new `squareEligible` predicate — blocker/void remain excluded, and
color_bomb/area_bomb are moot since they carry no matchType to share).
`gameState.ts`'s `resolveMatchEffects` now checks a detected square for a live
striped corner and, if found, fires that piece's sweep instead of spawning a
new area bomb — reusing the exact sweep-firing logic the run branch already
used (factored into one shared `fireStripedTriggersAndClearAll` helper rather
than duplicated per shape).

## Automated coverage (jest, always-on)

- `engine/matrix.test.ts` › **checkSquares — 2x2 block detection**: a blocker
  corner still rejects a square; a live striped corner with the same matchType
  now **is** detected; a color-bomb/area-bomb corner still rejects (colorless,
  no matchType to share).
- `engine/gameState.test.ts` › **applyMove — area bombs (2x2 square trigger)**:
  a square with one striped corner fires that piece's sweep (reaching beyond
  the square itself, down its whole line), spawns no area bomb, and credits
  the objective for the matchType-'A' cells cleared.
