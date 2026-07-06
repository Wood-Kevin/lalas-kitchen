# Embedded square in a straight run — live verification

`embedded-square-filmstrip.png` verifies the real playtest bug fix: a 2x2
square embedded inside an ordinary 3-length run — specifically the exact
shape reported (2 cells on one row, 3 cells on the row below, sharing the
left two columns — a 2x3 rectangle missing its top-right corner) — now
spawns a real area bomb instead of standing down and clearing as an ordinary
match. Driven end-to-end through the **real** `applyMove` in
`engine/gameState.ts`, with no source file modified for this capture.

## What the image shows

Three panels, left to right, all built from one real `applyMove` call:

1. **Pre-move board.** Four tomatoes pre-placed at `(0,0)`, `(0,1)`, `(1,0)`,
   `(1,2)` — an L missing its shape's fifth cell — plus a donor tomato
   parked at `(2,1)`, one cell below the gap. No run and no square exists
   yet (`checkMatches`/`checkSquares` both empty), asserted before the swap.
2. **Shape forms — cells clearing.** The board immediately after swapping
   `(1,1)` with the donor at `(2,1)`, which pulls the donor up into `(1,1)`
   and completes the shape in one move: a horizontal 3-run at row 1
   (`(1,0)`–`(1,2)`) **and** the embedded 2x2 square
   `{(0,0),(0,1),(1,0),(1,1)}` at once — exactly the reported shape (2 on
   top, 3 on bottom, left two columns shared). The four cells the real
   engine goes on to clear are hatched; the surviving anchor at `(0,0)` is
   ringed. This cleared set comes from the real `diffBoards` (comparing the
   post-swap board to the real settled result), not hand-picked.
3. **Settled: real area bomb spawned.** The fully resolved, gravity-settled
   board returned by `applyMove`. Exactly one `area_bomb` piece exists,
   still carrying the original anchor's id, rendered with the real
   `area_bomb.webp` art (it fell one row via ordinary gravity, since the
   cleared cells below it in column 0 left a gap — nothing in the fix
   pins it to its pre-clear position). The other four cells are gone.

Every other cell on the board is a distinct, never-matching filler
piece (`c<row><col>` matchTypes, mirroring `gameState.test.ts`'s
`distinctBoard` helper) with no config entry, so it renders through the
same real fallback every un-arted piece gets: the `?` text-label
placeholder from `resolveSpriteAsset`/`spriteLabel` — not a made-up color.

## How the image was produced

A throwaway `engine/_embeddedSquareHarness.test.ts` (deleted after capture,
per the WSL screenshot note) built the board and ran the swap exactly as
`engine/gameState.test.ts`'s `'the literal reported shape (2 cells top row, 3
cells bottom row, sharing the left 2 columns) spawns an area bomb'` test does
— same positions, same swap, same assertions re-checked inline before
rendering — substituting the test's abstract `'A'` matchType for the real
skin piece type `'tomato'` so the shape renders with real art. Rendered
through the real `getSpriteForPiece` (`components/spriteMap.ts`) →
`resolveSpriteAsset` (`components/spriteAsset.ts`) path, with `tomato.webp`
and `area_bomb.webp` inlined as base64 data URIs from the real
`skins/lalas-kitchen/sprites/` files (the same bytes `spriteRegistry.ts`
`require()`s, just loaded from Node instead of Metro). Captured with
headless Windows Chrome (`--force-device-scale-factor=2`) from WSL2, per
the standing screenshot-verification note.

## Where the logic and tests live

- `engine/gameState.ts` — `resolveMatchEffects`'s `isUnambiguousEmbeddedSquare`
  helper (three independent guards: the square must be the only embedded
  candidate, and must not overlap a genuine L/T/plus cross) and the run/square
  reconciliation it gates.
- `engine/DECISIONS.md` — "Embedded square in a straight run: a real playtest
  gap, distinct from the still-deferred ambiguous case."
- `engine/gameState.test.ts`, describe block `'applyMove — area bombs (2x2
  square trigger)'`:
  - `'an unambiguous square embedded in a straight run now spawns an area
    bomb — a real playtest gap, fixed'` — the column-oriented transpose of
    the report (the original fix's test).
  - `'the literal reported shape (2 cells top row, 3 cells bottom row,
    sharing the left 2 columns) spawns an area bomb'` — the row-oriented
    literal shape from the report, exactly what this screenshot captures.
  - `'a genuinely ambiguous embedded square (two overlapping candidates)
    still stands down — never silently guessed'` — the still-deferred
    harder case (a full aligned 2x3 rectangle, two valid overlapping square
    candidates), confirming the fix doesn't over-fire.

All three tests pass as part of the full suite (401/401 at the time of this
fix).
