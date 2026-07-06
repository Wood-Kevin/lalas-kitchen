# Star ratings on the win screen

Two real wins, captured live against the real running app (Expo web, driven
via the Chrome DevTools Protocol from headless Windows Chrome — see the
memory note on WSL screenshot verification; puppeteer/playwright browsers
don't work directly in this WSL2 environment). Both are genuine plays: a real
two-tap swap dispatched as real DOM pointer events onto the real `Pressable`
tiles, going through the real `handleTilePress` → `attemptSwap` → `applyMove`
path, landing on the real `WonOverlay` with real sprite art.

For each capture, `LEVEL_QUEUE[0]` was temporarily rigged (reverted
immediately after, `git status` confirmed clean) to only 2 piece types and a
`targetCount` of 3, so a single real legal swap — precomputed against the
real deterministic seed-1 board via a throwaway harness (since deleted), not
guessed — wins the level immediately. The only value that changed between the
two captures was `movesLimit`, to land on opposite ends of the star range:

- **`three-stars.png`** — `movesLimit: 20`. The win lands with 19 of 20 moves
  unused (ratio 0.95) → all three stars filled gold.
- **`one-star-zero-moves-to-spare.png`** — `movesLimit: 1`. The single move
  that wins the level is also the level's entire move budget, so it lands
  with **zero** moves to spare (ratio 0) — the edge case
  `wonActions.test.ts` covers directly. Only the first star is filled; the
  other two render in the card's muted border color, confirming the empty
  state is visually distinct, not just a missing icon.

Both captures happen to land on a milestone level (Level 1 unlocks the
"Sunday Tomato Stew" recipe card), which swaps in `RecipeCardReveal` instead
of the plain plated-dish illustration — proving the star row renders
correctly in **both** branches of `WonOverlay`'s conditional (it sits outside
the `unlockedRecipeCard ? ... : ...` split, right after the headline).

## Design (see `components/wonActions.ts`)

`computeStarRating(movesRemaining, movesLimit)` is a pure presentational
computation — no engine change was needed, since both values already exist on
`GameState`/`LevelConfig` by the time `WonOverlay` mounts. It's a replay-value
hook, not a competitive score: the move budget's own unused fraction is split
into even thirds (≥2/3 → 3 stars, ≥1/3 → 2 stars, else 1 star), with a floor
of 1 star even at zero moves to spare, since finishing the level is itself
the achievement being rewarded. This is consistent with the project's
honest-numbers principle elsewhere (the objective chips show real counts
uncapped, the recipe book is a plain count, not a tiered badge) — no hidden
curve, no per-level tuning.

## Automated coverage (jest, always-on)

`components/wonActions.test.ts` › **computeStarRating**: sensible results
across a realistic range of moves-remaining ratios on a 20-move level, the
exact 1/3 and 2/3 boundaries, winning with zero moves to spare (1 star, never
0), winning with a large surplus (3 stars), and a degenerate zero-length move
budget.
