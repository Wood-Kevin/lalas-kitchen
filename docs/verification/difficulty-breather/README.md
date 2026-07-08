# Difficulty breather — live verification

Verified over CDP against the real running app (headless Windows Chrome from
WSL2, this project's standing technique — see `docs/verification/`'s other
entries for the same approach), not just the unit tests in
`appPersistence.test.ts`.

## Method

A temporary, session-scoped hook (`?breathertest=1` query param, gated the
same way the ErrorBoundary session's now-removed `?crashtest=1` hook was)
exposed the real internal App.tsx refs and callbacks on `window.__breatherTest`
— `forceLifeLost` (the real `handleLifeLost`), `handlePlayLevel`,
`handleBoardStateChange`, and getters for `consecutiveLossesRef`,
`isBreatherAttemptRef`, and the live `levelConfig` state. This let a script
force genuine consecutive life-losses and inspect the real resulting
`LevelConfig` without hand-driving ~20-40 real drag-swaps per loss (Board's
internal "Play Again" reuses the same `LevelConfig` across retries, so a real
losing streak takes many real moves to reach the level range this feature
targets). The hook was removed from `App.tsx` immediately after this capture —
`git diff`/`grep -n "breathertest" App.tsx` confirms no trace remains.

`localStorage.clear()` was run against the real app origin before the capture
so the run started from a genuinely fresh save (lives at the skin's max, 5;
`consecutiveLosses` absent → resolves to 0).

## Console transcript (level 21 — generatedLevelNumber 14, unshaped/playableRatio 1, so the raw ±30% ratio is directly visible with no shape-scaling folded in)

```
Harness ready. lives: 5 screen: home
consecutiveLosses at fresh boot: 0
consecutiveLosses after 1 loss: 1
isBreatherAttempt after 1 loss (expect false): false
level 21 config after 1 loss (normal numbers): {"movesLimit":18,"objectives":[{"targetMatchType":"lemon","targetCount":13},{"targetMatchType":"herb","targetCount":13}]}
consecutiveLosses after that level-start (expect unchanged, 1): 1
consecutiveLosses after 2nd loss: 2
isBreatherAttempt after 2 losses (expect true): true
level 21 config after 2 losses (breather numbers): {"movesLimit":23,"objectives":[{"targetMatchType":"lemon","targetCount":9},{"targetMatchType":"herb","targetCount":9}]}
consecutiveLosses immediately after breather granted (expect 0, consumed): 0
isBreatherAttempt on the level right after (expect false): false
level 21 config right after breather (expect == the 1-loss config above): {"movesLimit":18,"objectives":[{"targetMatchType":"lemon","targetCount":13},{"targetMatchType":"herb","targetCount":13}]}
consecutiveLosses after two more losses (expect 2): 2
consecutiveLosses after a win (expect 0): 0
```

## What this confirms, against the brief's own test-coverage asks

- **A single loss never triggers a breather.** After exactly one real
  `handleLifeLost` call, `isBreatherAttempt` is `false` and level 21's config
  is the plain ramp numbers (18 moves, 13+13=26 target — already flatlined at
  `MIN_MOVES`/`MAX_TARGET` at this level number, as expected for
  `generatedLevelNumber` 14).
- **Two consecutive losses genuinely produce an easier level than the same
  level number normally gets.** movesLimit rises 18 → 23 (+27.8%, matching
  `Math.round(18 * 1.3) = 23`); total target burden drops 26 → 18 (-30.8%,
  matching `Math.round(26 * 0.7) = 18`, split 9+9 across the two objectives).
  Both numbers land exactly on the `BREATHER_MOVES_RATIO`/
  `BREATHER_TARGET_RATIO` formulas in `appPersistence.ts`.
- **It's a genuine one-off dip, not a ramp change.** The instant the breather
  is granted, `consecutiveLosses` resets to 0 (`0` in the transcript,
  "consumed"), and the very next level-start for the same level index
  (`level 21 config right after breather`) is byte-identical to the pre-loss
  streak's normal numbers (18 moves, 13+13 target) — the ramp resumed exactly
  where it would have been anyway, not a new discounted baseline.
- **A win resets the streak**, exercised through the real
  `handleBoardStateChange` (not a stand-in): two more forced losses bring the
  streak to 2, then a real `in_progress` → `won` transition through that
  function drops it straight back to 0 — matching this session's brief
  ("Reset the consecutive-loss count on any win").

## An additional, disclosed observation from the first pass (level 20, not the clean run above)

An earlier pass against level 20 (`generatedLevelNumber` 13 — a shape-gated,
80%-playable `plus`-shaped level) showed a much smaller moves bump under
breather (18 → 19, not the full +30%) even though the target reduction still
showed clearly (22 → 16 total). This is correct, expected behavior, not a
bug: `generatedMovesLimit`'s breather ratio composes with `playableRatio`
*before* the `MIN_MOVES` floor is re-applied, so on a level whose shape has
already pulled the scaled value below the floor, the breather's own boost is
partly (or, on a severer shape, entirely) absorbed by that floor rather than
showing as a full extra 30%. It's disclosed here rather than silently
dropped because it's a real, felt consequence of the breather composing with
the shape system — a losing streak that happens to land on a heavily-shaped
level gets a smaller moves boost than one that lands on a plain rectangle,
though the target reduction is unaffected either way (targetCount has no
floor-collision at this level range). Not a scope item this session was asked
to address; logged for awareness, not filed to `DEFERRED_COMPLEXITY.md` since
it's the floor mechanism working as designed, not an unbuilt feature.

## Test suite

Full suite: 537 tests passing (up from 521 before this session), including
`appPersistence.test.ts`'s new coverage for `generatedMovesLimit`/
`generatedTargetCount`'s `breather` param, `shouldApplyBreather`/
`consecutiveLossesAfterLoss`, `buildGeneratedLevelConfig` with
`breather: true`, and `buildSaveData`'s `consecutiveLosses` round-trip.
