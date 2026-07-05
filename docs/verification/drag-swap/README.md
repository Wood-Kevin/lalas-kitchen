# Drag-to-swap — verification

Drag-to-swap was added **alongside** the existing tap-to-select-then-tap-adjacent
input, not as a replacement. Both were verified live against the **real app**
running under Expo web (`expo start --web`), driven through the Chrome DevTools
Protocol from a headless Chrome — real pointer events dispatched onto the real
`react-native-gesture-handler` Pan gestures, real `applyMove`, real sprites and
palette. The moves driven are guaranteed-legal moves on the deterministic seed-1
level-1 board (computed by the actual engine in a throwaway harness, since
deleted), so a committed match is proven, not hoped for.

The signals asserted in the driver (not just eyeballed):
- board mounts with all 40 tiles;
- a single tap raises the selection border (Moves stays 20 — nothing committed);
- the two-tap sequence **commits** the move (`tapSwapCommitted: true`);
- mid-drag, a `drag-target-<id>` highlight element is present in the DOM
  (`drag-target-1-1` for the downward drag — the correct targeted neighbour);
- release **commits** the swap (`dragSwapCommitted: true`) and `Moves` decrements
  20 → 19 (a snap-back would *not* decrement), and the matched run clears + refills.

Screenshots (phone viewport, 390×844 @2x):

- **`tap-selected.png`** — tap path intact: one tap on the tomato at (0,1) draws
  the thick accent selection border; Moves still 20 (no move committed yet). The
  adjacent second tap then commits (Moves → 19).
- **`drag-targeting-vertical.png`** — a downward drag from the tomato at (0,1):
  the tile follows the finger toward the cell below, and the target garlic at
  (1,1) shows the soft accent destination wash + thicker border **before**
  release. This is the "which neighbour is targeted" feedback.
- **`drag-committed.png`** — after release: the swap committed via the same
  `applyMove` path a tap uses, the three garlic in the top row matched and
  cleared, the board refilled, and Moves → 19.
- **`drag-targeting-horizontal.png`** — the same feedback for a sideways drag,
  showing the threshold rule: the finger stopped ~0.55 of a tile toward the
  neighbour (short of its centre) and the neighbour is already clearly targeted.

The pure geometry behind "which neighbour does this drag point at" is covered by
`components/dragDirection.test.ts` (diagonal collapse, 45° tie determinism,
threshold-on-dominant-axis) — the fun-to-debug part lives in a test, per
CLAUDE.md.

**Follow-up:** the drag *release* animation was later found to jump — the
finger-follow offset decayed on a different clock than the committed grid slide,
so a firm drag briefly retreated toward its origin before settling. Fixed by
folding the offset back on the grid slide's own clock; see
`../drag-swap-timing/` for the root cause and the frame-by-frame A/B trace.
