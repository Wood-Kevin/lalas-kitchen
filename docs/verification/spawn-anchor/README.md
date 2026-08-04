# Spawn-anchor — a new special piece lands where the player made the match

Verifies the fix for a real playtest report — *"when the special pieces are
created they always default to the far left column of the match; they should be
created at the combination point"* — which was correct, and turned out to be
**systematically** wrong for straight runs rather than occasionally wrong. See
`engine/DECISIONS.md`'s spawn-anchor entry.

The cause: `resolveMatchEffects` used `positions[0]` as the anchor cell, and
`checkMatches` builds `positions` in pure scan order — left-to-right for a row
run, top-to-bottom for a column run. So the special always spawned at the run's
far left (or top), with no relation to where the player actually swapped.

This is a sibling of the swap-anchor bug fixed just before it
(`docs/verification/swap-anchor/`) — both are special-piece geometry derived
from array order rather than from the player's gesture — but a different code
path: that one was `applyMove`'s swap branches deciding where an existing
special FIRES, this one is `resolveMatchEffects` deciding where a new special
is BORN.

---

## 1 · Engine behaviour, before and after (real `applyMove`)

Measured with a throwaway probe on 7x7 boards, each **asserted legal pre-move**
(`checkMatches` and `checkSquares` both empty — a board that could genuinely
exist in play, not a contrived one).

| Case | Player completed the match at | Spawned BEFORE | Spawned AFTER |
|---|---|---|---|
| 4-run → striped | col 3 | col 1 | **col 3** |
| 4-run → striped | col 2 | col 1 | **col 2** |
| 5-run → color bomb | col 2 | col 0 | **col 2** |
| 2x2 square → area bomb | (4,2) | col 1 | **col 2** |
| 2x2 square → area bomb | (3,1) | col 1 | col 1 |

Column is the decisive axis throughout: gravity only ever moves a piece
vertically, so the spawn **column** is the anchor's column, untouched by any
subsequent falling. (Rows do shift — in the last row of the table the bomb
spawns at (3,1) and then falls to (4,1) because the cells below it cleared.
That is correct behaviour, not a mis-anchor.)

### Why it was never right for a straight run

Not "usually" wrong — **always** wrong, for a structural reason worth recording:

- A horizontal **4-run** can only legally be completed at its **2nd or 3rd**
  cell. Completing it at either end would mean the other three were already a
  3-in-a-row, which cannot exist on a settled board. The old anchor was the 1st
  cell, so it was never the completion cell.
- A **5-run** can only ever be completed **dead centre**, for the same reason —
  so its anchor was reliably exactly two cells off.
- A **2x2 square** can be completed at any of its four corners, so the old
  top-left anchor happened to be right 1 time in 4.

## 2 · Live, in the real running app

Seeded a hand-built board via a temporary override hook (removed before commit;
a repo-wide grep for it returns nothing) on the real level 1: a diagonal Latin
square of the four rendered ingredient types with **no run and no 2x2
anywhere**, plus three tomatoes at row 3 cols 0, 1 and 3 and a fourth parked
directly above at (2,2). The only productive move is to bring that donor down
into **(3,2)**, completing a 4-run at its 3rd cell.

Played as a real two-tap swap against the running app. Result read straight off
the DOM:

```
moves:  20 -> 19          (a genuinely committed move)
target: 0/15 -> 3/15      (the run's other three cells credited; the
                           anchor became the special rather than clearing)

accessibility label of the new piece:
  "Striped tomato, sweeps its row, row 4, column 3"
                                    ^^^^^^^^^^^^^^
  = row 3, column 2 zero-indexed — exactly the cell the match was
    completed at. The old behaviour would have put it at column 0.

sprite on screen: striped_tomato.webp at CSS x=960  ->  grid column 2
```

`striped-spawned-live.jpg` is the frame immediately after, showing the
first-time "A Striped Treat" tutorial firing — corroborating that a real striped
piece was genuinely forged by this move.

## What this does NOT cover, disclosed rather than implied

- **Only the 4-run case was driven live.** The 5-run, the square and the
  cascade-centre fallback are verified by the real-`applyMove` probe and by unit
  tests, but no real gesture was dispatched for them.
- **No clean post-move board screenshot.** The dev-environment renderer became
  unstable during this session (repeated `Page.captureScreenshot` timeouts, and
  one corrupted tiled capture). The DOM was confirmed healthy at the time (40
  tiles, no zoom or transform) and the app rendered normally again after a
  reload, so this was a capture artifact rather than an app fault — but it means
  the visual record here is thinner than the trace record. The accessibility
  label above is the stronger evidence anyway: it is the piece's actual semantic
  position, not an inference from pixels.
- **No native device, and no human has played it.** The same standing gap every
  other feature in this repo discloses.

## Where the logic and tests live

- `engine/gameState.ts` — `swappedCellIn`, `runCentreIndex`, the anchor
  selection in `resolveMatchEffects`' run and square loops, and the `swapCells`
  parameter threaded through `resolveCascades` from `applyMove`.
- `engine/gameState.test.ts` — the `applyMove — where a newly spawned special
  lands` block, including a cascade-formed run (dictated spawn queue, so the
  cascade is deterministic rather than random) and the crossing-run exemption.
