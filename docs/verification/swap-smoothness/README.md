# Swap smoothness — a missing travel animation, an unsynchronised clear, and a snap-back nobody designed

## The report

> "I don't like how snappy swaps feel. seems like they could be much smoother"

## What it actually was — three findings, not a duration problem

Measured against the real running app over CDP: real tap and pointer-drag
gestures onto the real `react-native-gesture-handler` Pan, real `applyMove`,
sampling every rendered tile's bounding box and opacity **every animation
frame**. Level 1, fresh save, board seed as dealt.

The obvious hypothesis — "140ms is too fast" — was true but was the *smallest*
of three contributors, and would not have fixed the feel on its own.

### 1. The piece that MATCHES never animated its swap at all

A frame trace of an ordinary horizontal 3-match, swapping a Herb into place:

```
tile-2-3 (the piece that matched)     exiting-2-3 (its clearing copy)
  t66   x1325   (its origin cell)
  t83   GONE                    -->     t83   x1235   <-- appears, already there
```

**A 90px jump — one full tile — between two consecutive frames.** The tile was
never animated from one cell to the other; its live `Tile` was unmounted at the
origin and an `ExitingTile` was mounted at the destination.

Root cause, confirmed in code: `Tile.tsx`'s `ExitingTile` positioned itself with
`top: row * tileSize, left: col * tileSize` — **plain numbers, not shared
values**. It structurally could not move. For every other clear that is exactly
right (a piece dies where it stood), but the two swapped cells are the one case
where a cleared piece genuinely travelled first.

Only the *surviving* half of a swap slid. So on every matching swap, half the
gesture animated and half teleported.

**This is partly a regression I introduced earlier in this same session.** The
swap-anchor fix added `relocateSwappedClears`, which moved the exiting tile's
render position from the origin to the *destination* — necessary, because a
swapped area bomb's blast is anchored there. Before it, the tile popped at its
origin: no jump, but the swap simply never happened visually. After it, the
endpoint became correct and the absent travel animation became a visible
teleport. The missing animation predates the fix; the fix made it legible.
(For *drags* the earlier fix was a clear improvement either way — it removed a
**backward** teleport of up to a full tile.)

### 2. The match cleared before the swap finished

```
clear begins   t117
swap slide ends t233     -->  116ms of full overlap
```

`runStep(0)` is called synchronously from `attemptSwap`, so pass 0's clears
start on the same frame the swap starts. The swap never visually resolved
before the match began dissolving.

### 3. Snap-back was an accidental composition, not a gesture

An illegal swap, frame-traced:

```
t116 -> t313   out    (197ms)
t313 -> t342   FROZEN (~184ms of nothing)
t342 -> t832   back   (416ms drift)
```

Fast out, a dead hold, then a slow drift home — about 716ms, wildly asymmetric.
Nobody designed this. Two independent defaults collided:

- the hold was `swapDurationMs * 2`, so the pair sat frozen for a whole extra
  swap duration after the outward leg had already landed, and
- the return leg fell through to **`cascadeDurationMs` (480ms)** — because
  `snapBack` was already null by then, and these pieces were never added to
  `swapDurationIds`, which is the only other thing that selects the swap
  duration.

### 4. (Tuning) The swap was the one fast motion in a deliberately calm game

`swapDurationMs` 140 against `matchDurationMs` 300 and `cascadeFallSpeed`
480 — 3.4x faster than everything around it. `cascadeTiming.ts` documented this
as deliberate ("the direct response to a player's own tap, not a passive
animation they're just watching"), but that note was written when cascade was
350; the later retune to 480/300 widened the gap without revisiting it.

Easing was Reanimated's default `Easing.inOut(Easing.quad)` — **symmetric**,
accelerating as hard as it decelerates. Measured per-frame deltas:
`3, 8, 13, 19, 19, 14, 10, 4` — a hard burst through the middle, abrupt arrival.

## The fix

- **`ExitingTile` can travel.** New optional `fromRow`/`fromCol`/`travelMs`.
  `boardDiff.ts`'s `relocateSwappedClears` now records **both** ends
  (`travelFrom` = origin, `from` = resting cell, where the effect stays
  anchored). Only a swapped-and-cleared cell gets them.
- **The whole first pass waits for the swap.** `Board.tsx`'s `passTravelMs`
  delays every tile in pass 0, not just the two that moved — see the false
  start below. The next pass's start and the terminal-overlay hold shift by the
  same amount, the way `chainHoldMs` already does for a staged chain.
- **Snap-back is one symmetric there-and-back.** The pair goes into
  `swapDurationIds` for the whole round trip (fixing the return leg's duration)
  and the hold is exactly one `swapDurationMs` (removing the freeze).
- **`swapDurationMs` 140 -> 220**, and a shared `SWAP_EASING`
  (`Easing.bezier(0.33, 0, 0.15, 1)`) on every swap motion: gentle start — a
  tile at rest should ease into motion, so an out-only curve would read as a
  yank — with a long decelerating tail so it settles rather than arrives.

### A false start, caught by measuring rather than assuming

Delaying only the *travelling* tile was tried first. The trace showed the two
cells that never moved fading at **t135** while the swapped piece was still
sliding and didn't fade until **t368** — a 233ms split, so the match cleared
before the piece completing it had arrived. Worse than the original bug. The
swap is one gesture; the pass resolving it is one beat.

### A second artifact, also caught by measuring

The first snap-back fix produced a **21px lurch back outward at t533**, mid
return. Cause: clearing `swapDurationIds` flipped the `durationMs` prop while
the return was still in flight, and `Tile`'s position effect listed `durationMs`
in its dependencies — so it restarted the animation. `durationMs` is no longer a
dependency: it's read fresh whenever the effect runs (so a moving tile always
animates at the right duration), but a tile that is standing still or mid-slide
no longer restarts because a bookkeeping flag flipped.

## The trace — before vs after, same board, same swap

| | before | after |
|---|---|---|
| matched piece's travel | **90px jump in 1 frame** | **90px slide, t118 -> t318** |
| the 3 cleared tiles' fade start | 135 / 135 / 368 (**233ms split**) | **366 / 366 / 366** |
| swap slide, per-frame deltas | `3,8,13,19,19,14,10,4` | `1,5,13,19,16,12,7,6,4,3,2,1,1` |
| clear vs swap | clear starts 116ms **before** swap ends | clear starts ~50ms **after** swap lands |
| snap-back | 197 out / **184 frozen** / 416 back | 201 out / ~33 beat / 184 back |
| snap-back backward lurch | n/a (drift) | **0px** |

## Regression checks (real app, real gestures)

- **15 consecutive real moves**, tap-driven: board stayed at 40 tiles every
  move, **zero stuck exiting tiles**, **zero console errors**, objective and
  move counter tracked correctly (0/12 -> 9/12, 24 -> 13).
- **Striped sweep stagger preserved** — a real sweep cleared 10 tiles with a
  **367ms staggered fade spread** (`5376, 5376, 5460, 5526, 5526, 5576, 5576,
  5632, 5693, 5743`), while ordinary matches in the same run showed
  `fadeSpread=0`. Travel composes with `sweepDelayMs` rather than replacing it.
- **Committed pointer-drag swap**: dragged tile travelled, all three cleared
  tiles faded together at t470, move counted 22 -> 21, zero errors.
- **Sub-threshold drag cancel**: followed the finger to x1248 and returned
  exactly to x1235, zero errors — this is the one path where `SWAP_EASING` runs
  inside a gesture **worklet**, which can fail differently, so it was tested
  explicitly rather than assumed.
- 703/703 tests pass (up from 696 — 7 new cases covering both ends of the
  travel and the "no travel for an ordinary clear" guarantee).

## What is NOT verified

- **No human has felt this.** Every number here is geometry sampled from the
  DOM. 220ms and the bezier are a considered judgment call against this
  project's calm brief, not a playtested value — and this game is built for one
  specific player. The single most useful next step is her opinion, not another
  trace.
- **Web only.** Reanimated runs on the JS thread on web, with no separate UI
  thread; on a real device the same animations run on the UI thread. Nothing
  here depends on thread skew (all three fixes are about ordering and
  duration, not race timing), but it is untested on a device — the standing
  disclosed gap for every native path in this repo.
- A single-pass match now takes roughly **670ms** end to end (swap ~200ms,
  settle, clear ~300ms) versus ~380ms before. That is intentional and sits in
  the same register as the 480ms cascade beat, but it *is* slower per move.
