# Special-piece chaining — verification

`chain-filmstrip.png` verifies **chaining**: a special piece caught in another
special's clear effect now fires its OWN effect too, instead of vanishing
silently as ordinary content. This was deferred since the striped piece first
shipped and carried through the color bomb, the combos, and the area bomb; it's
now built as a single shared step (`engine/gameState.ts`'s `expandChainClears`).

Captured the same way the area-bomb and color-bomb verifications were — a
throwaway `*.test.ts` harness (deleted after capture, per the WSL screenshot
note) that drives the **real `applyMove`** and renders every board through the
**real `getSpriteForPiece` → bundled `.webp`** path the app uses, on the skin's
real ingredients. Every engine outcome is asserted with `expect()` **before** the
image is written, so the artifact can't claim success on a broken run.

The base grid is a **diagonal Latin square** of the six real ingredients
(`type = TYPES[(r+c) % 6]`), which has no 3-in-a-row and no full 2×2 — so every
cleared cell belongs to the chain we set up, never an incidental cascade, and
every base tile shows real art.

## What the image shows

One move fires a **four-effect chain** (the origin plus three triggered links),
decomposed in the middle panel by which effect cleared each cell:

- **① area bomb — 3×3 blast (blue).** The colorless area bomb (burlap sack) is
  swapped with its ordinary left neighbour. No run or square exists, so the
  trigger is the swap itself; its 3×3 blast is the origin of the chain.
- **② striped tomato — row sweep (green).** The origin blast catches a live
  row-striped tomato at (2,2). Chaining fires it: it sweeps its whole row.
- **③ second area bomb — 3×3 blast (orange).** The row sweep catches a second
  area bomb sitting on that row; it fires its own 3×3.
- **④ color bomb — single-color detonation (red).** That second blast catches a
  color bomb. A caught color bomb has no swap partner to name a target colour, so
  it detonates the board's **most common ingredient** (here, tomato) — see
  `mostCommonMatchType`. Every tomato on the board clears, wherever it sits.

**After**: gaps refilled, all four specials consumed, and it was **one committed
move** (`movesRemaining` 10 → 9) — a chain is a free bonus, never an extra move.
The **tomato objective credited 7** through the chain, proving each triggered
effect still credits its own cleared cells.

The engine folds the whole chain into a single committed clear set (the four
links resolve together, not as separately-animated beats — the per-link animation
staging is a presentation nicety, deferred like the supercombo's convert-to-striped
flash, see `DEFERRED_COMPLEXITY.md`). The footprint panel decomposes that one
clear set back into its four contributing effects.

## Engine outcomes asserted before the render

- The engine's real cleared-id set equals **exactly** the union of the four
  effects' cells (origin 3×3 ∪ striped row ∪ second 3×3 ∪ all tomato cells).
- Each link is proven by a cell only it could clear: `2-3` (row sweep, in no
  blast), `1-4` (second blast, off the row), and ≥1 tomato outside every other
  region (the color-bomb link).
- Zero `area_bomb` / `striped` / `color_bomb` pieces remain; `movesRemaining === 9`;
  the tomato objective's `currentCount` equals the tomato-cell count.

## Where the logic and tests live

- `engine/gameState.ts` — `expandChainClears` (the one shared chain-expansion
  helper) and `mostCommonMatchType` (the caught-color-bomb target rule); wired
  into `resolveClearSet` (so every swap-triggered effect chains: solo color bomb,
  area bomb, striped+striped, striped+bomb) **and** into `resolveMatchEffects`
  (so an in-match striped sweep chains too). Each caller passes its own
  `originKeys` — the specials it already fired itself, which clear but never
  re-fire.
- Tests: `engine/gameState.test.ts` (`applyMove — special piece chaining` block):
  color bomb catches a striped piece; a three-link chain; objective credit through
  a chain; and the in-match striped-sweep path chaining. All engine tests pass.

## Termination (why a chain can't loop forever)

A board has finitely many cells; each cell enters the clear set at most once, and
only a freshly-cleared non-origin special is ever enqueued. So a chain must run
dry the moment it stops reaching new specials, or once the whole board is cleared.
