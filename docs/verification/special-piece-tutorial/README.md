# Special-piece tutorial overlay — verification

**Update:** the color-bomb and area-bomb panels below were originally verified
by feeding the harness a real resting `Piece` directly, not a genuine in-game
spawn (see the "What's real in each panel" note below). All three specials —
striped, color bomb, area bomb — are now additionally verified triggering
their tutorial from a **genuine organic spawn** (a real 4-run / 5-run / 2×2
square, forged by real tap gestures on the real running app) — see
`organic-spawns/README.md`.

`special-tutorial-filmstrip.png` verifies the **first-time tutorial overlay**
for the three special pieces (striped, color bomb, area bomb) — the calm,
once-ever "here's what this does" card shown the first time each special comes to
rest on the board. It's the sibling of the existing `BlockerTutorialOverlay`
(one data-driven component, `components/SpecialTutorialOverlay.tsx`, rather than
three near-identical files), gated behind input the same way and dismissed with a
single "Got it".

Captured the same way the area-bomb / color-bomb / chaining verifications were —
a throwaway `*.test.ts` harness (deleted after capture, per the WSL screenshot
note) that drives the **real detection and rendering paths** and asserts every
outcome with `expect()` **before** writing the HTML, so the artifact can't claim
success on a broken run.

## What's real in each panel

- **Which tutorial shows** is chosen by the **real `findSpecialPieceTutorial`**
  (`appPersistence.ts`) — the row-major scan that returns the first unseen
  special on the board. The striped panel drives this over a board produced by a
  **real `applyMove`**: a 4-run swap forges a `type: 'striped'` tomato, and the
  detection then fires on the settled board (player's move → engine spawns the
  special → detection picks it up → overlay content), including the once-ever
  guarantee (a seen striped returns `undefined`). The color-bomb and area-bomb
  panels feed a real resting bomb `Piece` (their *spawning* is verified in
  `docs/verification/color-bomb/` and `area-bomb/active/`).
- **The icon art** is resolved through the **real `getSpriteForPiece` path** to
  the real bundled `.webp`: the striped tomato shows `striped_tomato.webp`
  (derived from the base ingredient it was forged from), the color bomb the fixed
  `color_bomb.webp` glowing bottle, the area bomb the fixed `area_bomb.webp`
  burlap sack — never a hardcoded reference.
- **The copy** (`SPECIAL_TUTORIAL_CONTENT` headline/subtext, keyed by tutorial
  id) is asserted verbatim against the component source in the harness, so the
  rendered wording can't drift from what the app shows.

The card/backdrop styles in the HTML mirror `SpecialTutorialOverlay.tsx`'s exact
style values (the same hand-mirroring the board filmstrips use for RN styles).

## What the image shows

Three cards, one per special, each the real overlay card on its warm-brown scrim:

- **Striped — "A Striped Treat"** (`id: striped`), striped-tomato art. Forged
  live by a 4-run swap, then detected on the settled board.
- **Color bomb — "A Color Bomb"** (`id: color_bomb`), fixed `color_bomb.webp`.
- **Area bomb — "An Area Blast"** (`id: area_bomb`), fixed `area_bomb.webp`.

The tone matches the blocker tutorial's "A Covered Dish": warm, plain, one
action, no urgency — per CLAUDE.md's calm-not-frantic brief.

## Engine / detection outcomes asserted before the render

- The 4-run swap yields exactly one `type: 'striped'` piece with
  `matchType === 'tomato'` and `direction === 'row'`.
- `findSpecialPieceTutorial` returns `{ id, piece }` matching the resting special
  for each of the three types, and `undefined` once that id is in `seenTutorials`.
- Each panel's copy strings appear verbatim in `SpecialTutorialOverlay.tsx`.

## Where the logic and tests live

- `appPersistence.ts` — `findSpecialPieceTutorial` (row-major first-unseen scan),
  the three id constants (`STRIPED/COLOR_BOMB/AREA_BOMB_TUTORIAL_ID`, each equal
  to the engine `PieceType` string so no type→id mapping table), and the
  `SpecialPieceTutorial` interface.
- `components/SpecialTutorialOverlay.tsx` — the one data-driven overlay; copy
  (`SPECIAL_TUTORIAL_CONTENT`) lives here beside the only thing that renders it.
- `components/Board.tsx` — `specialTutorial` state re-derived after every
  committed move (a special never exists on a level's initial board — the player
  forges it mid-level), a session-level `dismissedSpecialTutorialsRef` so a
  just-dismissed special can't flash back before the persist round-trips, and
  input gating (`canAcceptMove` / `dragEnabled`).
- Tests: `appPersistence.test.ts` (`findSpecialPieceTutorial` block +
  `markTutorialSeen` special-id coverage). All tests pass.

## Still deferred (see `DEFERRED_COMPLEXITY.md`)

If a single move mints two different specials, only the first (row-major) shows
its tutorial that move; the second shows after the next move that leaves it on
the board — no two overlays ever stack.
