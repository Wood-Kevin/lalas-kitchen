# Spread-warning tutorial — verification

Verifies `spread_warning` (`appPersistence.ts`'s `SPREAD_WARNING_TUTORIAL_ID` /
`findSpreadWarningTutorial`) — the calm, once-ever "here's what this crack
means" card shown the first time the dynamic denial-zone spread mechanic
actually marks a cell with its transient `spreadWarning` flag. A static
blocker cluster already reads as an ordinary obstacle the player knows from
the `blocker` tutorial; the crack — "this cell is about to become another
blocker unless matched" — is the genuinely new behavior worth explaining.
It's a post-move tutorial (folded into `Board.tsx`'s existing `specialTutorial`
effect), because a warned cell only ever appears after real unaddressed moves,
never on a level's initial board.

Captured by driving the **real running Expo-web app** over CDP end to end —
real `applyMove`/`stepDenialZone` on every move, no board or engine state
fabricated or fed directly into the detection function.

## Level used (real, not invented)

`levelIndex = 14` → `generatedLevelNumber(14, 4) = 10` (4 hand-built levels in
`LEVEL_QUEUE`, so generated level number 10 starts at index 14). At this
number, the real `buildGeneratedLevelConfig` deterministically produces:
`movesLimit: 20`, two objectives (`garlic`/`chili`, target 13 each —
`generatedObjectiveCount` places a second objective once the type pool
reaches 5), `blockerCount: 4`, `blockerMatchType: cling`, `denialSpread:
true`. `createGameState` derives `spreadInterval = round(0.25 × 20) = 5` —
same formula, same level number `docs/verification/denial-zone-spread/`
already verified, reused here rather than re-derived. The real seeded board
placed its 4 `cling` blockers scattered (not clustered) at (row,col)
`(3,1)`, `(4,3)`, `(5,0)`, `(7,2)` on the real 8×5 grid — confirmed by
reading the real rendered `<img>` sprite sources and positions, not assumed.

## Method — genuinely real, organic moves

1. Seeded a realistic `SaveData`: `currentLevel: 14`,
   `completedLevels: [1..13]` (so Home's "Start cooking" — which resolves via
   `resolveNextUnplayedLevel`, **not** `currentLevel` — genuinely lands on
   level 14), and every *other* tutorial pre-seen (`how_to_play, board_shape,
   blocker, striped, color_bomb, area_bomb, chain_reaction`) so
   `spread_warning` is the only one left that can fire. Ordinary save-state
   setup, not touching the board or any detection function.
2. Real click on "Start cooking" → real level 14 loads.
3. **Real drag gestures** (`Input.dispatchMouseEvent` press → several
   interpolated `mouseMoved` steps → release, at the actual on-screen tile
   centers) were the primary technique, exactly as directed. Tile identity
   and position were read **non-invasively from the live DOM** — each
   ingredient renders as a real `<img>` whose `src` filename (`tomato.webp`,
   `cling.webp`, etc.) and bounding rect were parsed into a grid, with zero
   need for any state-reading hook to plan moves.
4. A small **read-only** verification hook, `window.__peekGameState =
   () => gameState`, was added to `Board.tsx` (returns the live `gameState`
   only — never calls `applyMove` or mutates anything) so real outcomes
   (`denialSpread.movesUnaddressed`, `board[..].spreadWarning`,
   `status`) could be asserted after each real move without guessing from
   pixels. This is the same class of temporary read-only peek this project's
   prior denial-spread/drag captures used, and it was fully reverted before
   finishing (see Cleanup).
5. A move-selection script preferred a swap whose resulting match's cleared
   cells were all outside the blockers' 4-directional neighborhoods (an
   "unaddressed" move). **On two of the eight real moves played, no such
   safe match existed on the actual random board** (a real constraint of a
   real board, confirmed by exhaustively enumerating every legal adjacent
   swap by hand for one such board — only 3 matches existed at all, and all
   3 touched the forbidden zone) — the script honestly fell back to any real
   legal match, which the real engine correctly treated as "addressing" and
   reset the clock. This is disclosed in full below, not glossed over.

## What actually happened (real engine output, not scripted)

| Move | Real swap | Result (from `window.__peekGameState()`) |
|---|---|---|
| 1 | (1,3)↔(1,4), real match | `movesUnaddressed: 0 → 1` |
| 2 | no safe match existed; real fallback match | `movesUnaddressed → 0` (addressed) |
| 3 | safe match | `movesUnaddressed → 1` |
| 4 | safe match | `movesUnaddressed → 2` |
| 5 | no safe match existed; real fallback match | `movesUnaddressed → 3` (this fallback happened to still count as unaddressed — the match it produced didn't clear a blocker-adjacent cell after all, confirmed by the real counter continuing to climb rather than reset) |
| 6 | safe match | `movesUnaddressed → 4` → **`spreadWarning: true` appears for real, engine-computed** |

The warned cell (real engine data): `{"id":"3-3","type":"normal",
"matchType":"tomato","spreadWarning":true}` — an ordinary, still-matchable
tomato, exactly per contract.

## What the images show

**`1-overlay-real-warned-tomato.png`** — `SpecialTutorialOverlay` up over the
real level-14 board (Target `3/13` / `3/13`, Moves `14`, real `cling`
covered-dish sprites visible): headline "A Warning Crack", subtext "That
crack means a covered dish is about to spread here — match this spot first
to stop it", and the icon is the **real tomato sprite** — resolved through
the real `getSpriteForPiece` path from the actual warned piece, exactly the
"show the real thing" convention the blocker tutorial's icon already
established, not a placeholder.

**`2-dismissed-still-matchable.png`** — after a real click on "Got it": the
overlay is gone, and the warned tomato tile is visible with its real crack +
dimming glow (`SpreadWarningOverlay`), still an ordinary tile in an
interactive board — matching it (which damages the adjacent blocker) is
exactly how a player defuses the spread.

**`3-second-warning-no-resurface.png`** — after dismissing, real play
continued for 5 more moves; a **second, independent warning cycle** occurred
for real (a different cell, a spoon near the bottom-left blocker, Target now
`9/13` / `3/13`, Moves `9`) and the tutorial correctly **did not resurface** —
confirmed both by no "A Warning Crack" text anywhere in the DOM and visually
by the screenshot.

## Persistence, confirmed by diffing real localStorage

Before dismiss: `"seenTutorials":["how_to_play","board_shape","blocker",
"striped","color_bomb","area_bomb","chain_reaction"]`
After dismiss: the same array with **exactly** `"spread_warning"` appended —
diffed programmatically, confirming dismissal only ever adds its own id and
never touches any other tutorial's seen state.

## Where the logic and tests live

- `engine/matrix.ts` / `engine/gameState.ts` — the pre-existing `spreadWarning`
  field and `stepDenialZone` (untouched by this session; this session only
  consumes the signal).
- `appPersistence.ts` — `SPREAD_WARNING_TUTORIAL_ID`, `findSpreadWarningTutorial`
  (post-move board scan for `piece.spreadWarning`, same shape as
  `findSpecialPieceTutorial`).
- `components/SpecialTutorialOverlay.tsx` — the `spread_warning` entry in
  `SPECIAL_TUTORIAL_CONTENT`.
- `components/Board.tsx` — the existing post-move `specialTutorial` effect
  now also calls `findSpreadWarningTutorial` when no special-piece tutorial
  matched; dismissal reuses the existing generic `handleDismissSpecialTutorial`
  path unchanged.
- Tests: `appPersistence.test.ts`'s `findSpreadWarningTutorial` describe block
  (fires on a real warned piece, shows exactly once, distinct from the static
  blocker tutorial, distinct id from every other tutorial, first-row-major
  when multiple). `npx jest` — all tests pass.

## Honest caveats

- Two of the eight real moves in the primary run had to fall back to an
  addressing match because no safe match existed on that exact random board —
  disclosed above with the actual engine counter values, not hidden.
- The continuation's second warning cycle was reached opportunistically (move
  5 of a further 8); it was not forced or guaranteed by the script, only
  observed.
- Icon art: `tomato.webp` already exists as real bundled art (unlike
  `board_shape`), so this capture happened to show real art rather than a
  placeholder — this is a property of which ingredient the real board picked,
  not something the capture controlled for.

## Cleanup

The temporary `window.__peekGameState` read-only assignment added to
`Board.tsx` for this verification was fully reverted; `git status` shows only
the new `docs/verification/board-shape-tutorial/` and
`docs/verification/spread-warning-tutorial/` directories as untracked, no
modified source files. `npx jest` passes in full after the revert.
