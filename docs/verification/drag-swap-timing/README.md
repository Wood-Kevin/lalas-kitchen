# Drag-swap release timing — the "jumpy swap" fix

## The report

Continued play surfaced that the swap animation "feels jumpy, not switching
positions cleanly." The diagnostic question was **which input path** it happens
on: the original tap-then-tap, or the newer drag gesture (see the
`Add drag-to-swap` commit). That answer localises the bug immediately.

## Diagnosis — drag-specific

A tapped tile's on-screen position is a single animated source: the row/col grid
slide (`Tile.tsx`'s position effect). A **dragged** tile carries a second one on
top — the finger-follow transform `dragX/dragY`. On release those two animated
on **different clocks**:

- the finger-offset decayed to 0 over `DRAG_RETURN_MS` (120 ms), started
  immediately in the pan's `onFinalize`, while
- the committed grid slide ran `origin → neighbour` over `swapDurationMs`
  (140 ms), starting a couple of frames later (after `onDragEnd → applyMove →
  setGameState → re-render → effect`).

Their **sum is non-monotonic** for a firm drag: the offset collapses faster than
the grid advances, so the tile briefly **retreats toward its origin cell** and
then slides back out to the destination. That backward hitch is the "jump."
This is the "two separate sources of truth that can disagree" case.

## The fix

Fold the drag offset back to rest on the **same clock** as the grid slide, so
the committed motion is one continuous curve from where the finger left the tile
straight to its landing cell:

- `Tile.tsx` position effect now also animates `dragX/dragY → 0` over the same
  `durationMs` it animates `row/col` — same render, same duration, same easing,
  so the sum is monotonic.
- The pan's `onFinalize` no longer starts a competing decay when the release
  resolves to a real neighbour (a swap will commit / snap back, and the
  re-render's effect carries the offset home). It only springs the tile back for
  the one case that produces no re-render — a drag that resolved to nothing.
  It reuses `resolveDragDirection` (now a worklet) so the "will this commit?"
  geometry is the single source Board already uses.
- `Board.tsx` tightens `dragEnabled` to the same conditions `canAcceptMove`
  gates on that persist across a finger-down (`!snapBack && !displayBoard`), so
  a drag that can start is always one whose release is accepted — which is what
  makes "resolves to a neighbour" a safe proxy for "will re-render."

## The trace — real app, frame-by-frame, A/B

Both builds were driven through the **real Expo-web app** over the Chrome
DevTools Protocol (real pointer events onto the real `react-native-gesture-handler`
Pan, real `applyMove`), the same rig the original drag-swap verification used.
The dragged tile's sprite centre was sampled every animation frame from release
through settle. A firm downward drag (~0.95 tile) on an **illegal** pair (so the
tile survives the whole slide) on the seed-1 / level-1 board, cell (3,2),
neighbour row centre = **513 px**:

```
tile centre y, per frame, from release → settle (bigger y = toward the neighbour):

BUGGY (pre-fix Tile.tsx, HEAD):
  502 502 499 499 493 487 482 483 491 500 508 512 513 513 ...
                    └─ retreats UP to 482 first (19.7 px ≈ 0.29 tile toward origin) ─┘
                       then reverses and slides down to the neighbour (513)

FIXED (this change):
  502 502 502 502 502 503 504 506 509 511 512 513 513 513 ...
  └─ strictly monotonic: eases straight into the neighbour, zero backward motion ─┘
```

Metric = max retracement below the running maximum along the drag axis:

| Build | backward hitch | verdict |
|-------|----------------|---------|
| Buggy (HEAD `Tile.tsx`)  | **19.67 px (0.29 tile)** | visible jump |
| Fixed (this change)      | **0.00 px**              | clean |
| Tap swap (control, fixed)| **0.00 px** (`444 → 513` monotonic) | always clean, confirms drag-specific |

The buggy baseline was produced by stashing **only** `Tile.tsx` back to HEAD
(the fix lives almost entirely there) and reloading, so the A/B isolates exactly
this change. Raw per-frame samples: `traj-buggy.json`, `traj-fixed.json`,
`traj-tap.json`. Mid-slide stills: `board-buggy-midslide.png`,
`board-fixed-midslide.png`.

## Caveat on the web measurement

Reanimated runs on the **JS thread on web** (no separate UI thread), so the
thread-skew half of the bug — `onFinalize` firing on the UI thread before the
JS re-render — is muted here; what the web trace captures is the **rate-mismatch**
half (120 ms offset decay summed with the 140 ms grid slide). That is why the
firm ~0.95-tile drag is needed to expose it on web (the retreat only appears once
the offset decay outruns the grid slide). On a native device the thread skew adds
to this, so the native hitch is at least as large as the 0.29 tile measured here.
The fix removes both halves: a single shared clock has neither a rate mismatch
nor a start-time skew.
