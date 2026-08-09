import { computeStarRating, resolveCelebrationTier } from './wonActions';

describe('computeStarRating', () => {
  // movesLimit: 18 gives clean sixths (3 and 6) so the boundary tests land
  // on exact integers rather than fractional move counts, matching the new
  // 1/3 and 1/6 thresholds.
  test('a comfortable surplus (1/3 or more of the budget unused) earns 3 stars', () => {
    expect(computeStarRating(6, 18)).toBe(3); // exactly the 1/3 boundary
    expect(computeStarRating(9, 18)).toBe(3);
  });

  test('a middling surplus (1/6 up to 1/3 unused) earns 2 stars', () => {
    expect(computeStarRating(3, 18)).toBe(2); // exactly the 1/6 boundary
    expect(computeStarRating(5, 18)).toBe(2); // just under the 1/3 boundary
  });

  test('a thin surplus (under 1/6 unused) earns 1 star', () => {
    expect(computeStarRating(2, 18)).toBe(1);
    expect(computeStarRating(1, 18)).toBe(1);
  });

  test('winning with zero moves to spare still earns 1 star, never 0 — finishing the level is the achievement', () => {
    expect(computeStarRating(0, 18)).toBe(1);
    expect(computeStarRating(0, 20)).toBe(1);
  });

  test('winning with a large surplus (nearly the whole move budget unused) earns 3 stars', () => {
    expect(computeStarRating(19, 20)).toBe(3);
    expect(computeStarRating(20, 20)).toBe(3);
  });

  // The bars sit at 1/3 and 1/6 unused, not 1/2 and 1/3 — loosened again
  // after a real playtest report that an ordinary 1-star win felt like
  // nothing happened, since the original 1/2 bar was calibrated against a
  // bot's near-optimal play, not real casual play. See
  // computeStarRating's own doc comment.
  test('sensible results across a realistic range of moves-remaining ratios on a 20-move level', () => {
    expect(computeStarRating(20, 20)).toBe(3);
    expect(computeStarRating(7, 20)).toBe(3); // 0.35, just over 1/3
    expect(computeStarRating(20, 60)).toBe(3); // exactly 1/3 (scaled)
    expect(computeStarRating(4, 20)).toBe(2); // 0.20, between 1/6 and 1/3
    expect(computeStarRating(10, 60)).toBe(2); // exactly 1/6 (scaled)
    expect(computeStarRating(2, 20)).toBe(1); // 0.10, under 1/6
    expect(computeStarRating(0, 20)).toBe(1);
  });

  test('a degenerate zero-length move budget does not throw or divide into NaN', () => {
    expect(computeStarRating(0, 0)).toBe(3);
  });
});

describe('resolveCelebrationTier', () => {
  test('a perfect 3-star finish is a full celebration, with or without a recipe unlock', () => {
    expect(resolveCelebrationTier(3, false)).toBe('full');
    expect(resolveCelebrationTier(3, true)).toBe('full');
  });

  test('a fresh recipe-card unlock is a full celebration even at 1 or 2 stars', () => {
    expect(resolveCelebrationTier(1, true)).toBe('full');
    expect(resolveCelebrationTier(2, true)).toBe('full');
  });

  test('an ordinary 2-star win with no recipe unlock gets the light tier, not full or quiet', () => {
    expect(resolveCelebrationTier(2, false)).toBe('light');
  });

  test('an ordinary 1-star win with no recipe unlock stays quiet', () => {
    expect(resolveCelebrationTier(1, false)).toBe('quiet');
  });
});
