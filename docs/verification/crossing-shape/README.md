# L/T/plus crossing-run trigger — a second, additive area-bomb spawn

`before-after.png` — captured via the same headless-Chromium pass prior
verifications used, against a throwaway harness (not in the repo, deleted
after capture) that drives the **real `applyMove`** and the **real
`getSpriteForPiece`** sprite-resolution path with the real bundled sprite art.

The scenario: a 5x5 board with a 3-color diagonal background (lemon/herb/
garlic — guaranteed match-free and square-free by construction, since no two
orthogonally-adjacent cells ever share a color) and five tomatoes placed so
that swapping one donor tomato into the center cell completes **both** a
horizontal 3-run and a vertical 3-run at once — a genuine T-shaped crossing,
not two independent runs.

What the capture proves end-to-end:

- **Before the swap**: `checkMatches`, `checkSquares`, and `checkCrossShapes`
  are all empty — the board is a real legal starting position, not yet
  matched, and the cross doesn't exist yet (both arms still need the shared
  cell).
- **After a real `applyMove` swap**: exactly one colorless `area_bomb` exists
  on the board (no `matchType`, confirmed by both the jest assertions and this
  capture), rendered with the real `area_bomb.webp` sprite (highlighted with a
  red outline). It settles at the bottom of its column after gravity — it's a
  survivor like any other piece, not force-anchored to its original row, so it
  compacts downward along with the other two survivors in that column while
  the two cleared cells above are refilled from the top. The other four cross
  cells (the row arm's two remaining cells and the column arm's two remaining
  cells) are gone, replaced by freshly spawned pieces.
- Real ingredient art renders throughout both panels — no placeholder, no `?`.

## The confirmed precedence rule (not re-litigated here, see engine/DECISIONS.md)

A crossing candidate only spawns an area bomb when **both** arms are exactly
length 3. A 4- or 5-long arm through the same cell already spawns its own
striped piece or color bomb via the existing run logic, and stands the cross
down entirely — this was a genuine fork, confirmed with the architect before
building (the rejected alternative: the cross always wins, forcing a 4/5-run
to forfeit its own spawn). This capture exercises only the exact-3×3 case;
the 4/5-arm-stands-down case is covered by jest (`gameState.test.ts`), not
recaptured live, since it's pixel-identical to the pre-existing striped/
color-bomb captures.

## Root cause / where the logic and tests live

- `engine/matrix.ts`'s `checkCrossShapes` — a new scan, additive to
  `checkMatches` and `checkSquares`, built on the same `runsInLine` primitive
  `checkMatches` uses. The "exactly 3" filter is baked into the scan itself,
  not applied afterward by a caller.
- `engine/gameState.ts`'s `resolveMatchEffects` — gained a `crosses` parameter
  and a new loop between the existing run loop and square loop, reusing the
  same anchor-wins-over-clear mechanism the square trigger already
  established. `resolveCascades` threads `checkCrossShapes` through each pass.
- **No legality-gate wiring was needed** — a deliberate divergence from the
  square precedent. `checkSquares` needed `hasLegalMoves`/`shuffle`/
  `applyMove`'s snap-back gate because a pure 2×2 forms zero runs (invisible
  to `checkMatches`). A cross's entire premise is two runs `checkMatches`
  already sees, so those gates already treat a cross-forming swap as legal
  with no changes — verified directly against the code, not assumed.

## Automated coverage (jest, always-on)

- `engine/matrix.test.ts` › **checkCrossShapes — L/T/plus crossing-run
  detection**: plus/L/T positive detection with anchor + full-position
  assertions; a straight 5-run with no perpendicular run; the 4/5-arm
  precedence exclusion; blocker/void exclusion; live-striped inclusion;
  `hasLegalMoves`/`shuffle` regressions proving no new wiring was needed.
- `engine/gameState.test.ts` › **applyMove — area bombs (L/T/plus
  crossing-run trigger)**: genuine T and L swaps each spawning one area bomb
  with correct crediting (4 objectives + 1 anchor); the 4-arm and 5-arm cases
  each preserving the existing striped/color-bomb spawn unchanged; a live
  striped piece in the cross firing its own sweep instead; a square
  overlapping a cross's arm standing down so only one area bomb spawns.
