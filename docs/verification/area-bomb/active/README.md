# Area bomb — active (swap-triggered, colorless) — verification

> **Scenario 2 below (area+special snap-back) is superseded.** All three
> area+special pairings (area+color_bomb, area+striped, area+area) now fire a
> real combined effect instead of snapping back — see
> `docs/verification/area-bomb-combos/` and `engine/DECISIONS.md`'s
> "Area-bomb combos: the last three pairings" entry. Scenario 1 (the active
> area+ordinary 3×3 blast) is unaffected and still accurate.

`active-filmstrip.png` verifies the **passive→active reversal** of the area bomb
(see `engine/DECISIONS.md`'s area-bomb reversal sub-entry). The bomb no longer
fires by being matched into a run of its own color — it's now **colorless and
swap-activated**, the same camp as the color bomb, and fires its 3×3 blast the
instant it's swapped with an ordinary piece. This makes the old ambiguity moot:
the single universal `area_bomb.webp` sprite (a tied burlap sack) showed no color,
so a player could never tell what match a *passive* bomb needed.

Captured the same way the passive area-bomb and color-bomb verifications were — a
throwaway `*.test.ts` harness (deleted after capture, per the WSL screenshot note)
that drives the **real `applyMove`** and renders every board through the **real
`getSpriteForPiece` → bundled `.webp`** path the app uses, on the skin's real
palette. Every engine outcome is asserted with `expect()` **before** the image is
written, so the artifact can't claim success on a broken run.

The base grid is a **diagonal Latin square** of the six real ingredients
(`type = TYPES[(r+c) % 6]`), which has no 3-in-a-row and no full 2×2 — so every
cleared (dashed) cell is the area bomb's own footprint, never an incidental
cascade, and every base tile shows real art. The refill seed was chosen so the
settled board is cascade-free (asserted), keeping the After panel tidy.

## What the image shows

- **1 · Active trigger (swap → 3×3, no run).** The colorless area bomb (the ringed
  burlap sack) is swapped with its ordinary right neighbour (a ringed spoon). The
  board has **no run and no square** anywhere — asserted pre-move — so the trigger
  is the *swap itself*, not a match. The **Blast** panel shows the real clear set:
  the full **3×3** block centered on the bomb's own cell (nine dashed cells),
  independent of what it was swapped with. **After**: the bomb is consumed and the
  3×3 refills. A committed move — `movesRemaining` went 10 → 9 with no run formed.
- **2 · Area + special is a deferred combo (snap-back).** The area bomb (sack) sits
  next to a color bomb (the glowing potion bottle). Swapping them is a deferred
  combo (see `DEFERRED_COMPLEXITY.md`), so the move is **rejected**: the After
  panel is **identical** to Before, `movesRemaining` stays 10, and `steps` is
  empty. The guard sits before the color-bomb branch in `applyMove`, so this never
  misfires into a degenerate single-type detonation on the bomb's `undefined`
  matchType.

## Engine outcomes asserted before the render

- Pre-move: `checkMatches` and `checkSquares` both empty (no run/square to lean on).
- Active swap: the cleared id-set equals exactly the nine 3×3 cells (the bomb's own
  cell included, a border cell outside survives); zero `area_bomb` pieces remain;
  `movesRemaining === 9`.
- Deferred combo: `movesRemaining === 10`, `steps.length === 0`, and the returned
  board is the same unchanged reference.

## Where the logic and tests live

- `engine/matrix.ts` — `piecesMatch` now excludes `area_bomb` (colorless); the
  `hasLegalMoves` area clause (area+ordinary legal, area+special not).
- `engine/gameState.ts` — `resolveAreaBomb` (the swap detonation, sharing
  `resolveClearSet` with the color bomb and combos); the `applyMove` area branch
  (blast, or snap-back for area+special) placed before the solo-color-bomb branch;
  the colorless `area_bomb` anchor conversion in `resolveCascades`.
- Tests: `engine/gameState.test.ts` (`applyMove — area bombs` block — active
  trigger, blocker-in-blast, deferred-combo snap-back, `hasLegalMoves`),
  `engine/matrix.test.ts` (a live area bomb can't join a run; makes a stuck board
  legal). All tests pass.

The prior passive-version filmstrip and its README remain in the parent folder as
history of the design this reversed.
