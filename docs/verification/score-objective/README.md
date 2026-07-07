# Score objective — verification

Verifies the new `'score'`-type objective (see `engine/gameState.ts`'s
`ObjectiveType`, `SCORE_TIER_POINTS`/`passScoreMultiplier`, and
`engine/DECISIONS.md`'s scoring-system entry): a level whose win condition is
reaching a cumulative move-score, instead of collecting a target count of one
piece type.

## How it was captured

Real Expo-web app (`expo start --web`), driven over CDP against headless
Windows Chrome from WSL — the same rig `docs/verification/denial-zone-spread/`
and `docs/verification/mid-level-continue/` established. A save was seeded
directly into `localStorage` (`save:cooking-lalas-kitchen`) with
`completedLevels: [1, 2, 3, 4]`, so the real "next unplayed level" logic
(`resolveNextUnplayedLevel`) resolved to Level 5 — App.tsx's new hand-built
"Score Rush" level (`objectives: [{ type: 'score', targetCount: 1000 }]`) —
reachable through Home's ordinary "Start cooking" flow, not a temporary code
change. The legal first move was found by running the real, unmocked engine
(`engine/generator.ts`'s `generateLevel(401, ...)` — Level 5's actual seed —
piped into `engine/matrix.ts`'s `findAnyLegalMove`) in a throwaway jest test
(deleted after use), then dispatched as two real tap gestures
(`Input.dispatchMouseEvent`) on the actual tile DOM nodes
(`[data-testid="tile-<row>-<col>"]`), matching this repo's established
tap-to-select-then-tap-adjacent convention.

## What the images show

- **`01-home-up-next.png`** — Home's "Up Next" card for Level 5, showing a ★
  glyph instead of a piece-type icon (`components/Home.tsx`'s
  `nextLevel.objectiveType === 'score'` branch) — confirms the Home preview
  never resolves a `'score'` objective's absent `targetMatchType` through
  `getSpriteForMatchType` (which would have produced the "?" placeholder this
  codebase treats as a genuine-bug signal elsewhere, not a legitimate one).
- **`02-level-loaded.png`** — Level 5 freshly loaded: the HUD's "Target"
  panel reads "★ 0/1000" (`components/Hud.tsx`), Moves 24, Lives 5 — the
  score objective renders correctly with no crash and no piece-type icon.
- **`03-after-match.png`** — after the one real move (swapping (2,3)/(3,3),
  completing a horizontal 3-run of garlic in row 3): the Target panel now
  reads "★ 30/1000" — exactly 3 cleared cells × 10 points (the 'ordinary'
  tier) × 1x (the first pass's multiplier), matching the hand-derived
  expectation before the move was ever dispatched. Moves ticked down to 23,
  proving a real move was spent, not a no-op.

## Test coverage

`engine/gameState.test.ts`'s new "applyMove — scoring system and score
objectives" describe block covers, against the real engine (no mocks):
point-value accumulation for an ordinary 3-match, a 4-run (special tier), a
5-run (bomb tier), a solo color-bomb detonation (bomb tier, including its own
consumed cell); a two-pass cascade scoring strictly more than twice a single
pass (proving the chain-bonus multiplier, not just "more cells cleared"); a
score objective winning the level at its target; and a score objective
coexisting with a collect objective on the same level, each updating from one
move without interfering with the other. `createGameState`'s existing describe
block gained a case confirming a `'score'`-type `LevelConfig` objective wires
into a fresh `GameState` with no `targetMatchType` and `currentCount: 0`.

## Where the logic lives

- `engine/gameState.ts` — `ObjectiveType`/`Objective` (the `'score'` variant),
  `LevelConfig.objectives`' `{ type: 'score'; targetCount }` config shape,
  `ScoreTier`/`SCORE_TIER_POINTS`/`CASCADE_CHAIN_BONUS_PER_PASS`/
  `passScoreMultiplier`/`upgradeTier`/`sumTierPoints`, the tier-tracking
  additions to `resolveMatchEffects`/`expandChainClears`/`resolveCascades`/
  `resolveClearSet`, and `applyMove`'s `scoreGained`-driven objective update.
- `components/Hud.tsx`, `components/WonOverlay.tsx`, `components/Home.tsx`,
  `components/levelProgress.ts` — the presentation-layer fallback for a
  `'score'` objective's missing `targetMatchType` (`SCORE_OBJECTIVE_SPRITE` in
  `components/spriteAsset.ts`), rather than falling through to the generic
  "no art yet" placeholder.
- `App.tsx` — `LEVEL_QUEUE`'s new fifth entry, "Score Rush".
