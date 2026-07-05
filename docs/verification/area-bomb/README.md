# Area bomb — verification

`area-bomb-filmstrip.png` verifies the third special piece, the **area bomb**: a
2×2 square of same-type pieces spawns one bomb, and matching that bomb later
clears the full 3×3 around it. Captured the same way the color-bomb and
special-piece-combo verifications were — a throwaway harness (deleted after
capture, per the WSL screenshot note) that drives the **real `applyMove`** and
renders every board through the **real `getSpriteForPiece` → bundled `.webp`**
path the app uses, on the skin's real palette. The bomb shows the real bundled
`area_bomb.webp` (a tied burlap sack). The harness asserts every engine outcome
with `expect()` **before** writing the image, so the artifact can't claim success
on a broken run.

The base grid is a **diagonal Latin square** of the six real ingredients
(`type = TYPES[(r+c) % 6]`), which has no 3-in-a-row and no full 2×2 — so every
cleared (dashed) cell is the area bomb's own footprint, never an incidental
cascade, and every base tile shows real art.

## What the image shows — three rows, each Before → effect → After

- **1 · Spawn (2×2 → bomb).** Four tomatoes; the ringed pair swaps to complete a
  pure 2×2 (no 3-in-a-row). The middle panel shows the swap's real clear set:
  **exactly three** cells cleared (dashed), and the top-left anchor (ringed)
  becomes the bomb. The After panel shows the settled board with the
  `area_bomb.webp` sack where the square was — **one** area bomb, not four
  ordinary clears. Objective credited 3 (anchor kept), exactly like a 4-run
  spawning a striped piece credits 3.
- **2 · Trigger (match → 3×3).** A live area bomb (ringed) is swapped into a
  tomato run. The Blast panel shows the real clear set: the **full 3×3** block
  centered on the bomb (nine dashed cells). After: the bomb is consumed and the
  3×3 refills. This is the passive trigger — the bomb fires by being included in
  an ordinary match of its own type, the same activation the striped piece uses.
- **3 · Blocker (one hit only).** A two-hit blocker (`CL`, cling) sits inside the
  3×3. The Blast panel shows **eight** cells cleared — the blocker cell (ringed)
  is spared. After: the blocker is still present, now on **one** hit remaining —
  it took a single adjacent-damage knock, never a force-clear, the same rule
  every clearing mechanism obeys.

## Activation: passive (like striped), confirmed with the architect

The area bomb is a **colored** special — it spawns from four same-type pieces and
keeps its `matchType` — so it activates **passively**, by being included in a
later ordinary match, exactly like the striped piece. (The color bomb is
swap-activated only because it's colorless and has no color to match on.) This
needs **no** new `applyMove` branch and **no** `hasLegalMoves` trigger-clause —
it rides the existing `resolveCascades` → `resolveMatchEffects` path. See
`engine/DECISIONS.md`'s area-bomb entry for the full fork reasoning.

## The one detection subtlety: a 2×2 is a new match shape

A pure 2×2 forms **no** 3-in-a-row, so `checkMatches` alone misses it. A new
`checkSquares` scan (`engine/matrix.ts`) runs alongside it, and every "is there a
match?" gate now consults both: `applyMove`'s snap-back, `resolveCascades`'s loop,
`hasLegalMoves`, and the generator/`shuffle` match-free guarantees (a latent
square would otherwise auto-spawn a free bomb on the player's first move). A
square whose cells overlap a straight run is an L/T/larger shape and **stands
down** — the run logic handles it, keeping L/T triggers deferred.

## Where the logic and tests live

- `engine/matrix.ts` — `checkSquares` (the 2×2 scan), `area_bomb` in `PieceType`,
  square-awareness in `shuffle` and `hasLegalMoves`.
- `engine/gameState.ts` — the `area_bomb` `AnchorSpec`, `areaBlastPositions`, and
  the square-spawn + passive-trigger branches in `resolveMatchEffects` (fired via
  the existing `resolveCascades`); square-aware snap-back in `applyMove`.
- `engine/generator.ts` — `repairAccidentalMatches` also breaks latent squares.
- `components/spriteMap.ts` + `skins/lalas-kitchen/spriteRegistry.ts` — the bomb
  resolves to the single fixed `area_bomb.webp` (one sprite for every area bomb,
  like the color bomb), now wired to real art.
- Tests: `engine/matrix.test.ts` (`checkSquares` block), `engine/gameState.test.ts`
  (`applyMove — area bombs` block), `components/spriteMap.test.ts` (area-bomb
  sprite). All 239 tests pass.
