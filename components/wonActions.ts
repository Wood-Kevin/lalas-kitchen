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
// measurements put at genuinely achievable-but-earned.
//
// Loosened again (SPEC.md's loop-variety/win-tier thread, real playtest
// report: a 1-star win on ordinary play, no burst, "felt like nothing
// happened"): the bot the 1/2 bar was calibrated against evaluates every
// legal move each turn, which is not how a real casual player plays — with
// no telemetry to calibrate against (a single-player project, no analytics
// pipeline), the honest move is a reasoned guess rather than a second
// simulation encoding the same optimal-bot bias one level down. Both bars
// halved (3-star: 1/2 -> 1/3; 2-star: 1/3 -> 1/6), preserving the same
// relative spacing between tiers while making the top tier reachable by a
// meaningfully efficient, not near-perfect, real player. Explicitly a
// hypothesis pending real play, not a fresh calibration — see
// DEFERRED_COMPLEXITY.md.
const THREE_STAR_UNUSED_RATIO = 1 / 3;
const TWO_STAR_UNUSED_RATIO = 1 / 6;

export function computeStarRating(movesRemaining: number, movesLimit: number): StarRating {
  if (movesLimit <= 0) return 3;
  const ratio = movesRemaining / movesLimit;
  if (ratio >= THREE_STAR_UNUSED_RATIO) return 3;
  if (ratio >= TWO_STAR_UNUSED_RATIO) return 2;
  return 1;
}

export type CelebrationTier = 'quiet' | 'light' | 'full';

// Gates the win-celebration particle burst's intensity (see
// WinCelebrationBurst.tsx) to how well the win actually went, rather than a
// binary burst-or-nothing — the same floor/ceiling reward-hierarchy shape
// cascadeTiming.ts's passRewardIntensity already established for board
// effects, applied here to the win overlay with a third rung added
// (SPEC.md's win-tier thread): a 1-star win keeps the original quiet
// star-pop + sparkle treatment; a 2-star win gets a lighter version of the
// burst, so an ordinary-but-real win still escalates a step instead of
// reading as identical to before this feature existed; a 3-star finish or a
// win that unlocked a recipe card keeps the original full treatment — both
// already read as the stand-out moment on this screen (the star row's own
// top tier, or RecipeCardReveal replacing the plated-dish illustration
// entirely), so the full burst amplifies a peak the screen is already
// marking, it doesn't invent a new one. Replaces the original boolean
// isStrongWin outright — it had exactly one call site (WonOverlay.tsx), so
// there's no reason to keep both around.
export function resolveCelebrationTier(stars: StarRating, unlockedRecipeCard: boolean): CelebrationTier {
  if (stars === 3 || unlockedRecipeCard) return 'full';
  if (stars === 2) return 'light';
  return 'quiet';
}
