# Special-piece tutorials — genuine organic-spawn verification

This closes the gap the original `special-piece-tutorial/README.md` capture
left open: that capture fed the color-bomb and area-bomb panels **a real
resting `Piece` handed to the harness directly** — proving the overlay and
detection *logic* work, but never proving the tutorial fires from an actual
in-game spawn. Only the striped panel was driven by a real 4-run swap.

This capture forges **all three** specials — striped, color bomb, area
bomb — through their **genuine real spawn condition** (a real 4-run, a real
5-run, a real 2×2 square), each triggered by **real tap gestures dispatched
onto the real running app**, never a pre-placed resting piece and never a
direct call into engine internals.

## How it was captured — the real app, not a mock

1. **`expo start --web`** was actually running (Metro serving the real bundle
   on `:8081`), and Windows Chrome was driven headless over CDP from WSL (the
   established mirrored-networking rig this repo's other live-motion captures
   use — see `docs/verification/denial-zone-spread/` and `dev-reset/`).
2. A **temporary** `?forge=striped|colorbomb|areabomb` query param (a few
   lines in `App.tsx`'s mount effect, reverted immediately after this capture)
   skips the normal save load and drops straight into a hand-crafted 6×6
   board — via a **temporary** `LevelConfig.debugBoard` escape hatch in
   `createGameState` (`engine/gameState.ts`, also reverted). This is the same
   "temporary harness gate, reverted after" pattern the powder and dev-reset
   captures used (see the WSL screenshot-verification note) — it controls
   only the *board's starting layout*, nothing about matching, spawning, or
   the tutorial pipeline, all of which run completely unmodified.
3. Each board was designed so exactly **one adjacent swap** produces the
   target special and **nothing else** — verified against the real
   `checkMatches`/`checkSquares`/`applyMove` (not hand-reasoned) in a
   throwaway `engine/__forge_scratch__.test.ts` before being copied into the
   harness: every board has **zero** pre-existing matches or squares, and the
   designed swap yields **exactly one** spawned special of the expected type.
4. A **real two-click tap-to-select-then-tap-adjacent gesture** was dispatched
   over CDP (`Input.dispatchMouseEvent` on the actual tile DOM nodes,
   `[data-testid="tile-<pieceId>"]`) — the exact same input path
   `Board.tsx`'s `handleTilePress` implements for a real player's two taps,
   calling the real `applyMove`. No `window.__hook()` shortcut, no direct
   state injection for the swap itself.
5. After the real cascade settles, `Board.tsx`'s own post-move
   `findSpecialPieceTutorial` effect (unmodified) picks up the freshly
   spawned special and shows the real `SpecialTutorialOverlay`.

## What the filmstrip shows

`special-tutorial-organic-spawn-filmstrip.png` — three rows, each a genuine
before/after pair (individual frames also saved alongside: `striped-*.png`,
`colorbomb-*.png`, `areabomb-*.png`):

- **Striped — real 4-run.** Before: an ordinary board, no striped piece
  anywhere, target `0/999`. A real tap-select on (2,2) then real tap-swap onto
  (3,2) completes a 4-run at row 2. After: target `3/999` (the 4-run credits 3,
  the anchor becomes the striped piece — matching the documented accounting),
  and **"A Striped Treat"** pops up with the real `striped_tomato.webp` art.
- **Color bomb — real 5-run.** Same swap positions, one column over in
  design (2,2)↔(3,2) on a board pre-arranged for a 5-run. After: target
  `4/999` (5-run credits 4), and **"A Color Bomb"** pops up with the real
  glowing-bottle art — the first time this tutorial has ever been verified
  against a genuine spawn rather than a fed-in resting piece.
- **Area bomb — real 2×2 square.** A real tap-select on (2,3) then tap-swap
  onto (2,4) completes a 2×2 square at (2,2)-(3,3). After: target `3/999`
  (a square credits 3), and **"An Area Blast"** pops up with the real
  burlap-sack art — likewise the first genuine-spawn verification for this
  tutorial.

Each "after" panel's dimmed background board is the real settled board behind
the real overlay — visibly the same 6×6 layout as the "before" panel, just
darkened by the overlay's scrim, confirming the tutorial is drawn over the
real game, not a separate mock screen.

## Assertions made by the driver (not just eyeballed)

For each scenario, the CDP driver script asserted `document.body.innerText`
contains the exact expected headline (`"A Striped Treat"` / `"A Color Bomb"` /
`"An Area Blast"`) after the real swap — all three passed:

```
striped tutorial shown: true
colorbomb tutorial shown: true
areabomb tutorial shown: true
PASS — all three organic spawns triggered their real tutorial
```

## Cleanup

The temporary `?forge=` gate in `App.tsx`, the temporary `debugBoard` field on
`LevelConfig` / branch in `createGameState` (`engine/gameState.ts`), and
`engine/__forgeHarness.ts` were all reverted immediately after this capture.
`npx jest` was re-run after reverting to confirm all 314 tests still pass with
zero trace of the harness left in the shipping code.

## Where the logic lives (unchanged by this capture)

- `appPersistence.ts` — `findSpecialPieceTutorial`.
- `components/SpecialTutorialOverlay.tsx` — the one data-driven overlay.
- `components/Board.tsx` — the post-move detection effect, `handleTilePress`
  (the real tap-swap path this capture drove).
- `engine/matrix.ts` / `engine/gameState.ts` — `checkMatches`, `checkSquares`,
  `applyMove`, `resolveMatchEffects` (real spawn logic, completely untouched).

This supersedes the "still only verified as pre-placed resting pieces" caveat
in the parent `special-piece-tutorial/README.md` for the color-bomb and
area-bomb panels — all three specials are now confirmed to trigger their
tutorial from a genuine in-app spawn.
