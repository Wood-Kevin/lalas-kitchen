# Blocker depth (`specialOnly` blocker, skin id `sealed_jar`) — verification

Verifies `engine/DECISIONS.md`'s "Blocker depth: a blocker that ignores
ordinary matches" entry: a new blocker variant that only takes adjacent
damage from a special effect (a striped sweep, an area-bomb blast, a
color-bomb detonation, or a chain any of those trigger), never a plain
ordinary match.

## How this was captured

Same rig as every other verification doc this session: the Expo web dev
server on `localhost:8082`, driven from WSL2 over raw CDP against headless
Windows Chrome.

1. Crafted a save with `completedLevels: [1..19]`, `currentLevel: 20` —
   generated level number 12 (`levelIndex 20 - LEVEL_QUEUE.length 8`), the
   generated level number `sealed_jar` becomes eligible at
   (`BLOCKER_MIN_LEVEL_NUMBER.sealed_jar`). Loaded the level.
2. `01-sealed-jar-blockers-generated.png` — four real "SE" text-label
   placeholder tiles (no art registered yet, the same fallback every
   un-arted piece/blocker gets) genuinely generated on the real board, at
   (1,1), (1,2), (2,2), (2,3).
3. Found a real, legal ordinary swap directly adjacent to one of them: a
   3-in-a-column spoon match in column 1 (rows 2–4), where row 2's cell is
   directly adjacent to the sealed_jar blocker at (1,1). Queried the DOM
   (`[data-testid^="tile-blocker"]`) both before and after to get exact
   ground truth rather than eyeballing a screenshot (tile sprites are easy
   to misjudge by eye across a re-rendered board).
4. Performed the real swap via two tap gestures at the exact tile
   coordinates (read from `getBoundingClientRect()`, not guessed).
5. `02-ordinary-match-blockers-untouched.png` — the match genuinely fired:
   Moves ticked 19→18, the spoon-collection objective went 0/13→3/13. The
   DOM query afterward showed the same four blocker ids still present —
   `tile-blocker-1-1`, `tile-blocker-1-2`, `tile-blocker-2-2`,
   `tile-blocker-2-3` — none cleared. For a `hitsToClear: 1` blocker this
   fully proves zero damage occurred (there's no partial-damage state to
   miss for a 1-hit blocker: it's either untouched or cleared, nothing
   between), which is the actual thing this check needed to confirm.

   **Correction, added during the session's later cross-feature sanity
   pass**: this originally also claimed the blockers stayed at their exact
   original *positions*. That wasn't actually verified — a tile's
   `data-testid` is keyed by the piece's stable id (assigned once at
   placement), not recomputed from its current board position, and a
   blocker isn't anchored like a void: `calculateCascades` compacts it
   toward the bottom of its column segment exactly like any surviving
   ordinary piece whenever cells clear in that segment (it's excluded only
   from matching/swapping/being force-cleared, not from gravity). The
   blocker originally reported at (1,1) shared a column with the cleared
   match, so it most likely did physically shift down — a separate,
   ordinary, correct behavior unrelated to the specialOnly damage question
   this test actually answers. See `engine/DECISIONS.md`'s blocker-depth
   entry for the full correction.

## What was confirmed

- `sealed_jar` genuinely generates on a real board once the level-12 gate
  is reached, carrying the `specialOnly` flag correctly threaded from skin
  config through `buildGeneratedLevelConfig` → `LevelConfig` →
  `GeneratorConfig` → the placed `Piece`.
- A real ordinary match landing directly adjacent to a `specialOnly`
  blocker does **not** damage it — confirmed via direct DOM inspection
  before and after the move, not just a screenshot.
- The move that triggered the match still committed normally and credited
  its own objective — confirming this change didn't regress ordinary match
  handling in any way.
- The full engine test suite (609 tests) passes, including new dedicated
  coverage for both halves of the behavior (ignored by ordinary matches,
  damaged by special effects) at both the `matrix.ts` unit level and the
  `gameState.ts` end-to-end `applyMove` level.

## What wasn't independently re-confirmed live

The "damaged by a special effect" half of the behavior is thoroughly
covered by a dedicated engine test (`applyMove — blockers`'s "a specialOnly
blocker IS damaged by a striped sweep passing adjacent to it",
`engine/gameState.test.ts`), mirroring the exact real `resolveCascades` /
`applyAdjacentDamage` / `tierByKey` pipeline the live app uses — but wasn't
separately reproduced live in the browser (no striped piece happened to be
present on the real generated board reached above). Given the pipeline is
identical code to what the live ordinary-match check above exercised (same
`applyAdjacentDamage` call sites, same `specialClearedKeys` derivation),
and the engine test constructs the exact real board/swap/cascade path, this
is judged sufficient — but it's a real, disclosed distinction from a full
live capture, not silently assumed identical.

## Where the logic and tests live

- `engine/matrix.ts` — `Piece.specialOnly`, `applyAdjacentDamage`'s new
  `specialClearedKeys` param.
- `engine/gameState.ts` — `LevelConfig.blockerSpecialOnly`, both
  `applyAdjacentDamage` call sites' `specialClearedKeys` derivation from
  `tierByKey`.
- `engine/generator.ts` — `GeneratorConfig.blockerSpecialOnly`,
  `placeBlockers`'s stamping of the flag onto placed blocker pieces.
- `components/skinConfig.ts` / `skins/lalas-kitchen/config.json` —
  `SkinBlocker.specialOnly`, the `sealed_jar` entry.
- `appPersistence.ts` — `BLOCKER_MIN_LEVEL_NUMBER.sealed_jar` (12),
  `buildGeneratedLevelConfig`'s `blockerSpecialOnly` threading.
- Tests: `engine/matrix.test.ts`'s `specialOnly blockers` describe block;
  `engine/gameState.test.ts`'s two new tests under `applyMove — blockers`;
  `appPersistence.test.ts`'s two new generator-gating tests.

Full suite: 609 tests passing (up from 601 before this feature).
