# Color bomb — verification

`color-bomb-detonation.png` — captured via the same headless-Chromium pass the
phase-5 / striped-badge verifications used, against a throwaway harness (not in
the repo) that drives the **real `applyMove`** and renders each board with the
**real `getSpriteForPiece` + `spriteLabel`** and the skin's real palette. So
the tiles/labels/colors are exactly what the app renders today — including the
color bomb showing the `CO` text-label placeholder, since no dedicated
`color_bomb` art exists yet (same graceful fallback every un-arted piece uses).

The harness asserts the outcome (`tomatoes remaining === 0`, objective credited
`12`) before writing the artifact, so the image can't claim success on a broken
run. Three panels, left to right / top to bottom:

- **1 · Before** — a full 6×6 board with the color bomb (`CO`, dark tile) and
  **12 tomatoes** (`TO`) scattered everywhere, each ringed. The bomb is about to
  be swapped with the adjacent tomato at its right.
- **2 · Detonation** — the exact clear set the swap produces: **every one of the
  12 tomatoes, anywhere on the board, plus the bomb itself** (13 cells) cleared
  at once (dashed-empty). Every non-tomato piece is untouched — proof the clear
  keys off the swapped piece's matchType across the whole board, not off any
  ordinary run (there is none) and not off proximity to the bomb.
- **3 · After** — the settled, refilled board straight from `applyMove`'s
  output: **zero tomatoes remain**. The refill deliberately draws non-tomato
  pieces so the "every tomato cleared" result is visually unambiguous.

Confirms the defining color-bomb behavior end-to-end: a swap that forms no
ordinary match still commits (a move is spent) and detonates every piece of the
swapped-with type across the entire board. All 191 engine/component tests pass
(9 new: 5 in `engine/gameState.test.ts`, 2 in `engine/matrix.test.ts`, 2 in
`components/spriteMap.test.ts`).

## `color-bomb-art.png` — dedicated art landed

Captured the same way, from a throwaway harness that runs the real
`getSpriteForPiece` → `resolveSpriteAsset` path and parses the actual
`spriteRegistry.ts` entry to load the real `color_bomb.webp`. Two tiles: the
**before** state (no registry entry → the "CO" text-label placeholder) and the
**now** state (the `'color_bomb'` registry entry present → the real glowing
potion-bottle art). Confirms `color_bomb.webp` renders on the live board through
the fixed `'color_bomb'` key, no code change — and that the key is correctly the
bare `'color_bomb'` string (what `getSpriteForPiece` returns), not
`'color_bomb.webp'`, which would have missed the lookup and kept the placeholder.
