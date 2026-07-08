# Generator-driven score objectives — verification

Verifies `engine/DECISIONS.md`'s "Generator-driven score objectives" entry:
`appPersistence.ts`'s `buildGeneratedLevelConfig` now occasionally places a
`'score'` objective instead of `'collect'`, past `isScoreObjectiveLevel`'s
gate (levelNumber >= 3, every 3rd level), reusing the same gate+cadence
rotation shape every other generated-level lever (shape, blockers, denial
spread) already uses.

## How this was captured

The Expo web dev server on `localhost:8082`, driven from WSL2 over raw CDP
against headless Windows Chrome, using this repo's own `node_modules/ws`.

A crafted save was written directly to `localStorage` (not played through —
this is a real save-format write, exercised the same way a genuine save
would be, just fast-forwarded past 9 levels of play) with `completedLevels:
[1..9]` and `currentLevel: 10`, then the app was reloaded.

Real level 10 (7 hand-built `LEVEL_QUEUE` levels + generatedLevelNumber 3) is
the actual first level `isScoreObjectiveLevel` gates in — chosen because
it's also independently `ring`-shaped (`generatedShapeId(3)`) AND blocker-
eligible (`generatedBlockerCount(3) > 0`), letting one real level confirm
score objectives compose correctly with two other independently-built
generator features at once, not just in isolation.

1. `home-up-next.png` — Home's "Up next · Level 10" card already shows the
   ★ score-objective fallback icon (`SCORE_OBJECTIVE_SPRITE`), confirming
   `nextLevelSummary`'s own real objective-type derivation (not just Board's)
   correctly identifies this generated level as `'score'`.
2. Clicked "Start cooking". `level10-board.png` — the real HUD's Target
   panel reads **"★ 0/750"**, Moves reads **18**, and the board is visibly
   `ring`-shaped (a hollow void in the center) with a real cling-wrap blocker
   tile in the top row — all three features rendering correctly together on
   one real generated level, no crash, no "?" placeholder.

## Confirming the numbers, not just that something rendered

`generatedMovesLimit(3, ringPlayableRatio)` floors at `MIN_MOVES` (18) for
this shape/level combination — confirmed by the real HUD's "Moves: 18".
`generatedScoreTarget(3, ringPlayableRatio)` is calibrated directly off that
same (already-floored) moves limit: `round(18 * (1000/24))` = **750**,
exactly matching the real HUD's "★ 0/750". This is the same live number
`appPersistence.test.ts`'s own tests assert, now confirmed against the real
running app rather than only the unit test's own computation.

## Where the logic and tests live

- `appPersistence.ts` — `isScoreObjectiveLevel`, `generatedScoreTarget`, and
  `buildGeneratedLevelConfig`'s new `useScoreObjective` branch.
- `appPersistence.test.ts` — new `isScoreObjectiveLevel`/`generatedScoreTarget`
  describe blocks, plus four new `buildGeneratedLevelConfig` integration
  tests (places a real score objective on an on-cadence level; an
  off-cadence level stays plain collect; a score objective never coexists
  with a second objective even when both gates are on-cadence at once; a
  score-objective level still gets its blockers/shape). One pre-existing
  test ("never targets the same piece type twice...") was updated to skip
  the now-real single-score-objective case instead of asserting generated
  levels never produce one.

Full suite: 574 tests passing (up from 561 before this session).
