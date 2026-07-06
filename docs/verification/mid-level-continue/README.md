# Mid-level continue offer — verification

Verifies the retimed life-spend mechanic (see `engine/DECISIONS.md`'s
"Mid-level continue offer" entry): a rescue offer of five extra moves shown
*before* a life is spent, replacing the old Phase-4 "+5 Moves" grant that
fired the offer *after* the life was already gone.

## How it was captured

Real Expo-web app (`expo start --web`), driven over CDP against headless
Windows Chrome from WSL (the same rig `docs/verification/denial-zone-spread/`
and `docs/verification/special-piece-tutorial/organic-spawns/` established) —
real tap-to-select-then-tap-adjacent gestures dispatched via
`Input.dispatchMouseEvent` against the real tile DOM nodes
(`[data-testid="tile-<row>-<col>"]`), not simulated or mocked. A temporary
`movesLimit: 1` tweak to Level 1 (`App.tsx`'s `LEVEL_QUEUE`, reverted
immediately after capture — the lightest version of this repo's established
"temporary, reverted after" verification convention) forced a genuine
moves-exhausted pause on the very first real move, so the whole sequence
below could be reached and re-reached quickly.

## What the images show

- **`01-continue-offer.png`** — the first moves-exhausted pause. `ContinueOffer`
  renders (not `PausedOverlay`): "One More Try?", "0 moves left", lives still
  at 5. Confirms the rescue is offered before anything is spent.
- **`02-after-accept.png`** — after tapping the grant CTA: moves back up to 5,
  lives still 5. Confirms accepting costs nothing.
- **`03-second-continue-offer.png`** — after burning through those 5 moves,
  `ContinueOffer` renders *again* (the per-attempt cap is 2 grants), lives
  still 5. This is also the moment that used to be broken: the old mechanic
  would have already spent a life back at the *first* pause, then a second at
  this one — see the DECISIONS.md entry's "up to three lives in one attempt"
  bug.
- **`04-exhausted-terminal.png`** — after accepting the second grant and
  burning through those moves too, the cap is reached (2 of 2 grants used).
  This time the plain `PausedOverlay` renders instead — "The Pot's Still
  Warming", no grant CTA, Play Again / Exit only. The life is auto-spent the
  instant this pause commits (see `Board.tsx`'s `runStep`).
- **`05-decline-continue-offer.png`** / **`06-after-decline-lives-4.png`** — a
  separate, isolated run: `ContinueOffer` appears on a fresh pause (lives 5),
  then **declining** via "Play Again" is captured a few polls later showing
  **lives dropped to 4** — proving a decline (not just grant exhaustion)
  correctly spends the life, and does so immediately (not delayed to some
  later transition).

## The bug this replaces

Tracing the old code (`App.tsx`'s now-deleted `shouldSpendLifeOnLoss`,
`components/pauseActions.ts`'s `canGrantBonusMoves`/`MOVE_GRANTS_PER_ATTEMPT`)
found the account life was spent the instant *any* moves-exhausted pause
committed — regardless of whether the Phase-4 "+5 Moves" button was about to
offer a way to keep playing. Because `grantBonusMoves` resumes `status` to
`'in_progress'`, the transition-based life-spend check re-armed on every
subsequent pause too: a single attempt that took both available grants and
still ran out a third time could lose **up to three lives**, not one. This
session's fix moved the decision — "is a rescue still on offer, and therefore
should this pause spend nothing yet" — into `Board.tsx`, the one place that
already tracks the per-attempt grant count, and split the old single
`PausedOverlay` into `ContinueOffer` (rescue still available) and a simplified
`PausedOverlay` (terminal, life already spent).

## A same-tick staleness bug found and fixed during this verification

The first live pass revealed a real bug, not assumed: declining
`ContinueOffer` calls `onLifeLost()` and then `Board.tsx`'s own
`handlePlayAgain()` in the same synchronous tick, before React re-renders
Board with the post-spend `lives` prop. Reading that stale prop baked the
**pre-loss** count into the new attempt's `GameState.lives` display snapshot
— confirmed live (lives read back unchanged immediately after a decline).
Fixed by having `App.tsx`'s `handleLifeLost` return the fresh count
synchronously, threaded through `handlePlayAgain`'s new optional
`livesOverride` param — every other caller (WonOverlay's Play Again, the
plain secondary link) omits it and falls back to the ordinary prop, unchanged.
Re-verified live after the fix (`06-after-decline-lives-4.png` above).

## Full-sequence correctness, confirmed against the real engine

Automating a full ~11-real-move playthrough (1 + two 5-move grants) over CDP
turned out to be slow and occasionally flaky (some board states need a
special-piece swap — always legal regardless of match — which a naive
run-based move-finder doesn't search for). Rather than force a fragile
full-length recording, the exact sequence `Board.tsx`'s `runStep` drives was
also traced directly against the **real, unmocked engine functions**
(`createGameState`, `applyMove`, `grantBonusMoves`, `engine/matrix.ts`'s
`findAnyLegalMove`) and the real `pauseActions.ts` predicates, in a throwaway
jest test (deleted after this session): `shouldOfferContinue` evaluates
`true, true, false` across the three real pauses in order, so the auto-spend
condition (`!shouldOfferContinue(...)`) is true — and the life is owed —
at, and only at, the third one. Combined with the live screenshots above
(which independently confirm the exact same three-pause sequence renders the
right overlay each time, with lives never dropping early), this covers the
full mechanic end-to-end using real product code throughout, without relying
on a single fragile long automated recording.

## Where the logic and tests live

- `components/pauseActions.ts` — `shouldOfferContinue` (new), reusing
  `canGrantBonusMoves`/`nextBonusGrantsUsed`/`MOVE_GRANTS_PER_ATTEMPT`
  unchanged. `components/pauseActions.test.ts` — 4 new cases.
- `components/ContinueOffer.tsx` (new) / `components/PausedOverlay.tsx`
  (simplified — dropped `canGrant`/`onGrant`/`adAvailable`, now always the
  terminal screen).
- `components/Board.tsx` — the auto-spend branch in `runStep`, and
  `handleContinueDeclinePlayAgain`/`handleContinueDeclineExit`.
- `App.tsx` — `handleLifeLost` (replaces the deleted `shouldSpendLifeOnLoss`).
- `skins/lalas-kitchen/config.json` — `lives.regenMinutes` corrected from 30
  to 20, matching the stated design (the 5-life pool already matched).

All 453 tests pass — the 4 new `shouldOfferContinue` cases exactly replace
the 4 deleted `shouldSpendLifeOnLoss` cases, a net wash in count but not in
coverage (the new predicate is what `runStep`'s auto-spend and the render
branch both actually depend on now).
