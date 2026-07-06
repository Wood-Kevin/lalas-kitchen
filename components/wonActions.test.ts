import { getWonSummary, computeStarRating } from './wonActions';

describe('getWonSummary', () => {
  test('summarizes the final objective count when it lands exactly on target', () => {
    expect(
      getWonSummary({ type: 'collect', targetMatchType: 'tomato', targetCount: 15, currentCount: 15 })
    ).toEqual({
      message: 'Level complete!',
      detail: '15/15 collected',
    });
  });

  test('summarizes the real final count even when a cascade overshoots the target', () => {
    // See engine/gameState.ts's win check — a single move can clear more of
    // the objective's matchType than exactly what's left, so currentCount
    // can end up above targetCount. The summary should show what actually
    // happened, not clamp it back down to the target.
    expect(
      getWonSummary({ type: 'collect', targetMatchType: 'tomato', targetCount: 15, currentCount: 18 })
    ).toEqual({
      message: 'Level complete!',
      detail: '18/15 collected',
    });
  });
});

describe('computeStarRating', () => {
  // movesLimit: 15 gives clean thirds (5 and 10) so the boundary tests land
  // on exact integers rather than fractional move counts.
  test('a comfortable surplus (2/3 or more of the budget unused) earns 3 stars', () => {
    expect(computeStarRating(10, 15)).toBe(3); // exactly the 2/3 boundary
    expect(computeStarRating(12, 15)).toBe(3);
  });

  test('a middling surplus (1/3 up to 2/3 unused) earns 2 stars', () => {
    expect(computeStarRating(5, 15)).toBe(2); // exactly the 1/3 boundary
    expect(computeStarRating(9, 15)).toBe(2);
  });

  test('a thin surplus (under 1/3 unused) earns 1 star', () => {
    expect(computeStarRating(4, 15)).toBe(1);
    expect(computeStarRating(1, 15)).toBe(1);
  });

  test('winning with zero moves to spare still earns 1 star, never 0 — finishing the level is the achievement', () => {
    expect(computeStarRating(0, 15)).toBe(1);
    expect(computeStarRating(0, 20)).toBe(1);
  });

  test('winning with a large surplus (nearly the whole move budget unused) earns 3 stars', () => {
    expect(computeStarRating(19, 20)).toBe(3);
    expect(computeStarRating(20, 20)).toBe(3);
  });

  test('sensible results across a realistic range of moves-remaining ratios on a 20-move level', () => {
    expect(computeStarRating(20, 20)).toBe(3);
    expect(computeStarRating(15, 20)).toBe(3);
    expect(computeStarRating(14, 20)).toBe(3); // 0.70
    expect(computeStarRating(13, 20)).toBe(2); // 0.65, just under 2/3
    expect(computeStarRating(10, 20)).toBe(2); // 0.50
    expect(computeStarRating(7, 20)).toBe(2); // 0.35
    expect(computeStarRating(6, 20)).toBe(1); // 0.30, just under 1/3
    expect(computeStarRating(0, 20)).toBe(1);
  });

  test('a degenerate zero-length move budget does not throw or divide into NaN', () => {
    expect(computeStarRating(0, 0)).toBe(3);
  });
});
