import { computeStarRating, isStrongWin } from './wonActions';

describe('computeStarRating', () => {
  // movesLimit: 15 gives clean thirds (5 and 10) so the boundary tests land
  // on exact integers rather than fractional move counts.
  test('a comfortable surplus (2/3 or more of the budget unused) earns 3 stars', () => {
    expect(computeStarRating(10, 15)).toBe(3); // exactly the 2/3 boundary
    expect(computeStarRating(12, 15)).toBe(3);
  });

  test('a middling surplus (1/3 up to 1/2 unused) earns 2 stars', () => {
    expect(computeStarRating(5, 15)).toBe(2); // exactly the 1/3 boundary
    expect(computeStarRating(7, 15)).toBe(2); // 0.47, just under the 1/2 boundary
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

  // The 3-star bar sits at HALF the budget unused, not two thirds — measured,
  // not chosen: a greedy bot evaluating every legal swap earned three stars
  // zero times across ~25 playthroughs under the old 2/3 rule. See
  // computeStarRating's own doc comment.
  test('sensible results across a realistic range of moves-remaining ratios on a 20-move level', () => {
    expect(computeStarRating(20, 20)).toBe(3);
    expect(computeStarRating(14, 20)).toBe(3); // 0.70
    expect(computeStarRating(10, 20)).toBe(3); // 0.50, exactly the 3-star boundary
    expect(computeStarRating(9, 20)).toBe(2); // 0.45, just under it
    expect(computeStarRating(7, 20)).toBe(2); // 0.35
    expect(computeStarRating(6, 20)).toBe(1); // 0.30, just under 1/3
    expect(computeStarRating(0, 20)).toBe(1);
  });

  test('a degenerate zero-length move budget does not throw or divide into NaN', () => {
    expect(computeStarRating(0, 0)).toBe(3);
  });
});

describe('isStrongWin', () => {
  test('a perfect 3-star finish is a strong win, with or without a recipe unlock', () => {
    expect(isStrongWin(3, false)).toBe(true);
    expect(isStrongWin(3, true)).toBe(true);
  });

  test('a fresh recipe-card unlock is a strong win even at 1 or 2 stars', () => {
    expect(isStrongWin(1, true)).toBe(true);
    expect(isStrongWin(2, true)).toBe(true);
  });

  test('an ordinary 1- or 2-star win with no recipe unlock is not a strong win', () => {
    expect(isStrongWin(1, false)).toBe(false);
    expect(isStrongWin(2, false)).toBe(false);
  });
});
