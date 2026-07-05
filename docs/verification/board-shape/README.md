# Board shape / void cells — live verification

`showcase-plus.png` is the hand-built showcase level **Level 4 · Cutting Board**
(App.tsx's `LEVEL_QUEUE`) rendered from the **real** engine: `createGameState`
with `seed: 314`, `rows: 7`, `cols: 7`, and the plus-shaped `voidCells` (the four
2×2 corner blocks). Each tile's sprite is resolved through the same
`components/spriteMap.ts` `getSpriteForPiece` the running app uses, drawing the
real `skins/lalas-kitchen/sprites/*.webp` art on the skin's real background
gradient. Void cells render **nothing** — exactly `components/Board.tsx`'s
`if (piece.type === 'void') return null` — so the four corners show the board
background through as the cutout.

What the capture proves end-to-end:

- The board is genuinely **non-rectangular**: 16 void corner cells, 33 playable
  cells forming a bold plus.
- Rendering treats voids as nonexistent (no tile, no placeholder, background
  shows through), and every playable cell holds a real, arted piece.
- The board is **match-free on creation** — `generateLevel` (void-aware
  `checkMatches`/`checkSquares` + `hasLegalMoves` → `shuffle`) guarantees it for a
  shaped board exactly as it does for a rectangle. A piece is never generated
  into a void.

The capture recipe (per the WSL screenshot memory): a throwaway
`_harness.test.ts` ran the real engine + sprite resolution and emitted HTML
mirroring `Board.tsx`'s tile layout, captured with headless Windows Chrome
(`--force-device-scale-factor=2`). The harness is deleted after capture; the
behaviour it exercised is covered permanently by the automated tests below.

## Automated coverage (jest, always-on)

- `engine/matrix.test.ts` › **void cells — matching / gravity / hasLegalMoves /
  shuffle**: a void breaks a run; a void corner blocks a 2×2 square; a piece
  rests on top of a void instead of falling through it; an enclosed segment
  refills from its own top; a void-free column is unchanged; voids are never
  swap candidates; shuffle keeps voids fixed.
- `engine/generator.test.ts` › **non-rectangular (void) board shape**: voids
  land exactly where requested and nowhere else; no piece is generated into a
  void; a shaped board is match-free and playable on creation; deterministic per
  seed; blockers never land on a void.
- `engine/gameState.test.ts` › **applyMove — non-rectangular (void) board**: a
  swap targeting a void snaps back (no move spent); a legal swap resolves
  normally with the objective credited and win firing; gravity/refill never
  disturb the shape; running out of moves pauses exactly like a rectangle.
