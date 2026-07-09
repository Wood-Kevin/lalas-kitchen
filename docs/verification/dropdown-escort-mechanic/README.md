# Dropdown ingredients (escort mechanic) — verification, including a real crash found and fixed live

Verifies `engine/DECISIONS.md`'s "Dropdown ingredients: the escort mechanic"
entry: a colorless `type: 'dropdown'` piece rides ordinary gravity to the
bottom of its column to be collected, crediting a new `'escort'`-type
objective. This capture also found and fixed a real bug in
`components/Board.tsx`'s animation pipeline — documented here as it
happened, not cleaned up after the fact.

## How this was captured

The Expo web dev server on `localhost:8082`, driven from WSL2 over raw CDP
against headless Windows Chrome, using this repo's own `node_modules/ws` —
the same rig as every other verification doc this session.

1. A crafted save (`completedLevels: [1..7]`, `currentLevel: 8`) routed to
   the real hand-built "Delivery Day" level. `00-home-up-next.png` — Home's
   "Up next" card shows the ⬇ escort fallback icon. `01-level-loaded.png` —
   the real HUD reads "⬇ 0/2", and two "DR" text-label placeholder tiles
   (no art registered yet, the same graceful fallback every un-arted piece
   gets) sit at the exact two configured `dropdownPositions`.
2. Tapped the real "💡 Hint" button. `02-hint-suggests-dropdown-swap.png` —
   it correctly glows a real dropdown-involving swap (the garlic at (0,0)
   and the dropdown at (0,1)), confirming `findAnyLegalMove`'s new
   always-legal clause fires against the real engine, not just in unit
   tests.

## A real crash, found live, not hypothetical

3. Performed that exact swap (two real tap gestures, garlic then dropdown).
   `03-crash-before-fix.png` — **nothing visibly changed, Moves stayed at
   24, and the Shuffle/Hint buttons went permanently unresponsive** (later
   taps produced zero effect). Installed real `window.onerror`/
   `console.error` capture hooks in the live page and reproduced the
   identical swap: it threw `Uncaught TypeError: Cannot read properties of
   undefined (reading 'forEach')`.
4. Traced the cause: a dropdown swap that neither forms a match nor lands
   the piece at its column's bottom is the ONE case that can commit a real,
   legal move with `steps.length === 0` (engine/gameState.ts's
   `resolveCascades` genuinely returns zero passes) — something no other
   move type in this game could ever do, since an ordinary swap that clears
   nothing is rejected as illegal before ever reaching `resolveCascades`.
   `components/Board.tsx`'s `animateCascade` called `runStep(0)`
   unconditionally, which read `steps[0]` (`undefined`) and passed it to
   `diffBoards(previous, undefined)` — the exact crash.
5. **Fixed** by extracting the final-pass commit logic (game-state commit,
   life-spend timing, chain-reaction tutorial check, terminal-overlay
   timing) into a shared `commitFinalState()` helper, called both from the
   normal last-iteration path and a new `steps.length === 0` early return
   that skips the diff/animate step entirely.
6. Rebuilt, reloaded the identical crafted save, and repeated the identical
   swap. `04-swap-works-after-fix.png` — **zero errors**, the swap committed
   cleanly (garlic and dropdown genuinely traded positions), Moves ticked
   down from 24 to 23, and Shuffle/Hint stayed fully responsive.

## Full end-to-end confirmation: fall and collection

7. Walked the same dropdown piece down its entire column across seven more
   real swaps (Moves ticking 23→22→...→17→16 across the whole sequence),
   confirming zero errors at every step.
8. `05-dropdown-collected.png` — once the piece reached the bottom row, it
   was genuinely collected: the HUD's Target now reads "⬇ 1/2" (incremented
   from 0/2), the dropdown piece is gone from the board entirely, and a
   fresh ordinary piece refilled its column.

## What was confirmed

- The escort objective's target/current counts render correctly and derive
  from the real configured `dropdownPositions`.
- A dropdown-involving swap is genuinely always legal (commits even with no
  match), confirmed both via the Hint button's suggestion and via direct
  swaps.
- A dropdown piece falling to the bottom via real cascades is genuinely
  collected, crediting the objective and disappearing from the board.
- The real crash this feature introduced in `Board.tsx`'s animation
  pipeline was found, root-caused, and fixed — not just described as
  theoretically possible.
- The fix doesn't regress any other move type: the full engine test suite
  (601 tests) passes, including every pre-existing cascade/combo/chain
  scenario.

## Where the logic and tests live

- `engine/matrix.ts` — `PieceType`'s `'dropdown'` variant, `piecesMatch`'s
  exclusion, `dropdownArrivals`, `findAnyLegalMove`'s always-legal clause.
- `engine/gameState.ts` — `ObjectiveType`'s `'escort'` variant,
  `LevelConfig.dropdownPositions`, `isClearable`'s exclusion,
  `resolveCascades`'s third continuation reason and `dropdownCollected`
  tracking, `applyMove`'s new dropdown swap branch, `createGameState`'s
  dropdown-piece placement and targetCount derivation.
- `components/Board.tsx` — `animateCascade`'s `commitFinalState()`
  extraction and `steps.length === 0` early return (the actual bug fix). No
  React component-test harness exists in this project, so this fix is
  verified live only, per CLAUDE.md's Testing Philosophy.
- `components/spriteMap.ts`/`spriteAsset.ts` — the `dropdown.webp`
  sprite-key fallback and `ESCORT_OBJECTIVE_SPRITE`.
- `App.tsx` — `LEVEL_QUEUE`'s "Delivery Day" (8th, last hand-built level).
- Tests: `engine/matrix.test.ts`'s `dropdown (escort) pieces` describe
  blocks; `engine/gameState.test.ts`'s `applyMove — escort (dropdown)
  mechanic` describe block, including a dedicated regression guard locking
  in `steps.length === 0` for the exact scenario that crashed;
  `components/spriteMap.test.ts`'s dropdown sprite tests.

Full suite: 601 tests passing (up from 585 before this feature).
