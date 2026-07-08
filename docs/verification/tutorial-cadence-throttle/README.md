# Tutorial cadence throttle — verification

Verifies the throttle described in `engine/DECISIONS.md`'s tutorial-cadence-
throttle entry and `CLAUDE.md`: `appPersistence.ts`'s `shouldActivateTutorial`/
`canShowTutorialNow` enforce a real 60-second (`TUTORIAL_MIN_GAP_MS`) minimum
gap between any two of the seven one-time tutorial overlays actually
appearing, so two genuine firsts landing close together defer instead of
stacking — and a deferred one still shows later rather than vanishing.

## How this was captured

Same rig as every other live capture in this project: the Expo web dev server
on `localhost:8081`, driven from WSL2 over raw CDP against headless Windows
Chrome, using this repo's own `node_modules/ws`. New `/json/new` tabs in an
already-running headless Chrome don't inherit the launch `--window-size`
(defaulted to 764x485), so `Emulation.setDeviceMetricsOverride` was used to
force a real phone-sized 390x844 viewport before computing any click
coordinates from `getBoundingClientRect`.

The scenario: **level 14** (generated-level-number 7 past the 7 hand-built
levels) is a naturally-occurring real level where both `generatedShapeId(7)`
and `generatedBlockerCount(7)` are active simultaneously — its own starting
board genuinely has both a void-shaped cutout and a blocker, so `board_shape`
and `blocker` are both real, eligible-and-unseen tutorials from the moment it
mounts. `localStorage`'s save blob was seeded directly (`completedLevels:
[1..13]`, `seenTutorials: []`, `currentLevel: 14`) so Home resolved straight
to it via a real "Start cooking" tap — no hand-authored test board, no
skipped screens.

Steps actually performed, in order, with zero simulated shortcuts:

1. Seeded the save, reloaded, confirmed Home really shows "UP NEXT · LEVEL 14"
   from the real `resolveNextUnplayedLevel` computation, and tapped
   "Start cooking" with a real dispatched mouse click.
2. **First genuine trigger wins priority**: `board_shape` ("A Different
   Shape") appears immediately at mount, over `blocker` — matching
   `nextEligibleTutorialId`'s priority order. `01-board_shape-shown.png`.
3. Dismissed it with a real click on "Got it".
4. **The second genuine trigger does not stack**: immediately after dismissal
   (0.7s later), body text confirmed no "A Covered Dish" card and the board
   fully visible/interactive. `02-deferred-no-stack.png`.
5. **A real committed move within the cooldown window still defers it**: used
   the real in-game "💡 Hint" button to find a genuine legal move, then
   dispatched the two real taps that commit it (a real `applyMove` call, a
   real cascade, `Target` progressing from 0/11 to 3/11). 3.8s after
   `board_shape` was shown, `blocker` still had not appeared — proving the
   recheck is tied to a real move commit, not a background timer.
   `03-still-deferred-after-move.png`.
6. Waited real wall-clock time until >60s had elapsed since `board_shape`
   first appeared (real `setTimeout`-driven sleep in the driver script, not
   simulated).
7. **The deferred tutorial genuinely shows later, never lost**: made a second
   real hinted move (`Target` progressing to 6/11) — `blocker`'s "A Covered
   Dish" card activated 66.0 seconds after `board_shape`, comfortably past the
   60000ms `TUTORIAL_MIN_GAP_MS` floor. `04-blocker-shown-after-gap.png`.
8. Dismissed it with a real click on "Got it", then read `localStorage`
   directly: `seenTutorials` persisted `["board_shape", "blocker"]` — the
   once-ever guarantee held for both, deferral included.

## A real gap this capture found and fixed

The first attempt used level 10 (generated-level-number 3) for the same
scenario. Its board has only 3 distinct piece types (`generatedPieceTypeCount`
ramps type variety up over the first several generated levels), so a single
real hinted move's cascade finished the entire level in one move — before a
second move could ever exercise the "after the cooldown clears" case. That by
itself wasn't a throttle bug, but it did surface one while investigating:
`Board.tsx`'s tutorial-activation effect didn't check `gameState.status`, so
if a level's cooldown happened to clear on the very move that won or lost it,
a deferred tutorial could activate and render on top of the Won/Paused
overlay — impossible before this session, since a mount-time tutorial used to
always render on the first frame, well before any move could end the level.
Fixed by gating the activation effect on `gameState.status === 'in_progress'`,
the same guard the pre-existing special-piece scan effect already used, before
re-running this capture against level 14 (5 piece types, a bigger target),
which gave enough headroom for both real moves without ending the level.
