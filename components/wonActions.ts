export type StarRating = 1 | 2 | 3;

// A replay-value hook, not a competitive score — derived purely from how much
// of the level's own move budget went unused. No engine change needed:
// movesRemaining/movesLimit both already exist on GameState/LevelConfig by the
// time WonOverlay mounts, so this is a plain presentational computation on data
// the win already produced. Consistent with this project's honest-numbers
// principle elsewhere (the objective chips show real counts uncapped, the
// recipe book is a plain count, not a tiered badge) — no hidden curve or
// per-level tuning, just the real ratio. A win always earns at least 1 star,
// even with zero moves to spare, since finishing the level is itself the
// achievement being rewarded.
//
// The thresholds were originally even thirds (3 stars at 2/3 of the budget
// unused). A simulation pass measured that as unreachable in practice, not
// merely hard: a greedy bot evaluating EVERY legal swap on every turn earned
// three stars zero times across ~25 playthroughs of both hand-built and
// generated levels, finishing wins with roughly 10-40% of the budget left.
// Even hand-built level 1 capped out at one star for that bot. A tier nobody
// can reach isn't a stretch goal, it's a permanently empty slot on the level
// map — so 3 stars moved to HALF the budget unused, which the same
// measurements put at genuinely achievable-but-earned. The 2-star threshold
// measured well calibrated already and is deliberately untouched.
const THREE_STAR_UNUSED_RATIO = 1 / 2;
const TWO_STAR_UNUSED_RATIO = 1 / 3;

export function computeStarRating(movesRemaining: number, movesLimit: number): StarRating {
  if (movesLimit <= 0) return 3;
  const ratio = movesRemaining / movesLimit;
  if (ratio >= THREE_STAR_UNUSED_RATIO) return 3;
  if (ratio >= TWO_STAR_UNUSED_RATIO) return 2;
  return 1;
}
