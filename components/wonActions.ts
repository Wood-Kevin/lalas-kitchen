export type StarRating = 1 | 2 | 3;

// A replay-value hook, not a competitive score — derived purely from how much
// of the level's own move budget went unused, split into even thirds. No
// engine change needed: movesRemaining/movesLimit both already exist on
// GameState/LevelConfig by the time WonOverlay mounts, so this is a plain
// presentational computation on data the win already produced. Consistent
// with this project's honest-numbers principle elsewhere (the objective
// chips show real counts uncapped, the recipe book is a plain count, not a
// tiered badge) — no hidden curve or per-level tuning, just the real ratio.
// A win always earns at least 1 star, even with zero moves to spare, since
// finishing the level is itself the achievement being rewarded.
export function computeStarRating(movesRemaining: number, movesLimit: number): StarRating {
  if (movesLimit <= 0) return 3;
  const ratio = movesRemaining / movesLimit;
  if (ratio >= 2 / 3) return 3;
  if (ratio >= 1 / 3) return 2;
  return 1;
}
