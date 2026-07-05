# Exiting-tile sprites for special pieces — the "?" after detonation, fixed

`mid-clear-sprites.png` verifies the fix for the bug where a **color bomb's icon
turned into a "?" as it detonated**, and the related (quieter) bug where a
**striped piece degraded to its plain base sprite while being swept**.

## What the bug was

Two independently-correct systems that were never checked against each other:

- **The exiting-tile animation** (`components/Tile.tsx`'s `ExitingTile`, Phase 5)
  resolved its sprite from `matchType` alone — correct back when *every*
  clearable piece had a `matchType`.
- **The color bomb** (a later phase) is the first and only clearable piece with
  **no `matchType`** (it's colorless — see `engine/DECISIONS.md`'s color-bomb
  entry). A striped piece keeps its base `matchType` but also carries a `type`
  the base lookup ignores.

`Board.tsx` drew *live* tiles with `getSpriteForPiece(piece)` (which reads
`type`) but drew *exiting* tiles with `getSpriteForMatchType(entry.matchType)`.
So a color bomb rendered correctly sitting on the board, then — the instant it
detonated and became an exiting tile — resolved to `undefined` →
`resolveSpriteAsset(undefined)` → `spriteLabel(undefined)` → **"?"**. The old
settled-board verification never caught it because the "?" only exists in the
transient clearing frame, which had settled to refilled pieces by the time the
board was captured.

## The fix

`ExitingEntry` now carries the cleared piece's full `pieceType`, and the exiting
tile resolves its sprite with `getSpriteForPiece({ type, matchType })` — the same
lookup the live tiles use (`components/Board.tsx`). One sprite path for both
tile states.

## How the image was produced

A throwaway harness (deleted after capture, per the WSL
screenshot-verification note) drove the **real `applyMove`** — a real color-bomb
swap and a real striped-piece sweep — then diffed the pre-move board against the
first cascade step with the **real `diffBoards`**, exactly as `Board.tsx`'s
`animateCascade` does. The cleared color-bomb and striped pieces it produced were
rendered through the **real `ExitingTile` component** with the **real bundled
`.webp` art**, at the transient mount frame (SSR runs no effects, so the tile
sits at full opacity/scale — the "just started clearing" beat). Each piece is
shown twice: BEFORE FIX (the old `getSpriteForMatchType` lookup) and AFTER FIX
(the new `getSpriteForPiece` lookup).

## Reading the image

- **Color bomb, mid-detonation** (`type='color_bomb'`, `matchType=undefined`) —
  BEFORE FIX shows the "?" placeholder (the bug, reproduced at the exact frame
  the old capture missed); AFTER FIX shows the real glowing potion-bottle art.
- **Striped tomato, mid-sweep** (`type='striped'`, `matchType='tomato'`) —
  BEFORE FIX shows the plain tomato (stripe overlay dropped); AFTER FIX shows the
  `striped_tomato` art with its stripes.

All 217 existing tests still pass with the change.
