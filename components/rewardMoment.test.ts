import { resolveScorePopupTone, resolveLalaMomentCopy } from './rewardMoment';
import { SpecialEffectDescriptor } from './specialEffectAnimation';

const COLOR_BOMB_EFFECT: SpecialEffectDescriptor = { kind: 'color_bomb', origin: { row: 0, col: 0 } };

describe('resolveScorePopupTone', () => {
  test('a plain single-pass match with no special is ordinary', () => {
    expect(resolveScorePopupTone(false, undefined, 1)).toBe('ordinary');
  });

  test('a settled multi-pass move with no special reads as cascade', () => {
    expect(resolveScorePopupTone(false, undefined, 2)).toBe('cascade');
    expect(resolveScorePopupTone(false, undefined, 4)).toBe('cascade');
  });

  test('a fired special effect always reads as special, even single-pass', () => {
    expect(resolveScorePopupTone(false, COLOR_BOMB_EFFECT, 1)).toBe('special');
  });

  test('a chain of multiple specials reads as special regardless of effectDescriptor', () => {
    expect(resolveScorePopupTone(true, undefined, 1)).toBe('special');
  });

  test('special outranks cascade when both signals are present', () => {
    expect(resolveScorePopupTone(true, COLOR_BOMB_EFFECT, 3)).toBe('special');
  });
});

describe('resolveLalaMomentCopy', () => {
  // Args: hasCombo, stuckBoardRescued, multiSpecialFired, effectDescriptor,
  // passCount, isFirstMoveOfAttempt, movesRemaining, moveScore.
  test('a quiet ordinary match under the score floor, mid-attempt, gets no line', () => {
    expect(resolveLalaMomentCopy(false, false, false, undefined, 1, false, 5, 40)).toBeNull();
  });

  test('a high-scoring ordinary single-pass match gets the score-floor line', () => {
    expect(resolveLalaMomentCopy(false, false, false, undefined, 1, false, 5, 100)).toBe("That'll do nicely.");
    expect(resolveLalaMomentCopy(false, false, false, undefined, 1, false, 5, 99)).toBeNull();
  });

  test('a settled multi-pass cascade gets the chain line, even under the score floor', () => {
    expect(resolveLalaMomentCopy(false, false, false, undefined, 2, false, 5, 10)).toBe('Look at that little chain.');
  });

  test('a fired special effect gets the "useful one" line, outranking a plain cascade', () => {
    expect(resolveLalaMomentCopy(false, false, false, COLOR_BOMB_EFFECT, 3, false, 5, 10)).toBe(
      "Now that's a useful one."
    );
  });

  test('a multi-special chain gets the magic line, outranking a solo special effect', () => {
    expect(resolveLalaMomentCopy(false, false, true, COLOR_BOMB_EFFECT, 3, false, 5, 10)).toBe(
      'A little kitchen magic.'
    );
  });

  test('a combo streak gets the top-priority line, outranking every other signal', () => {
    expect(resolveLalaMomentCopy(true, true, true, COLOR_BOMB_EFFECT, 3, true, 1, 500)).toBe('Beautifully done.');
  });

  test('the first move of an attempt gets the greeting line under the score floor', () => {
    expect(resolveLalaMomentCopy(false, false, false, undefined, 1, true, 20, 40)).toBe('There we are.');
  });

  test('a big first move still gets credit for the bigger moment, not just the greeting', () => {
    expect(resolveLalaMomentCopy(false, false, false, undefined, 2, true, 20, 40)).toBe('Look at that little chain.');
  });

  test('one move remaining gets the gentle low-moves line under the score floor', () => {
    expect(resolveLalaMomentCopy(false, false, false, undefined, 1, false, 1, 40)).toBe('One more careful stir.');
  });

  test('a big final move still gets credit for the bigger moment, not just the low-moves line', () => {
    expect(resolveLalaMomentCopy(true, false, false, undefined, 1, false, 1, 40)).toBe('Beautifully done.');
  });

  test('two moves remaining does not trigger the one-move-remaining line', () => {
    expect(resolveLalaMomentCopy(false, false, false, undefined, 1, false, 2, 40)).toBeNull();
  });

  test('a stuck-board rescue gets its own explanatory line, even under the score floor', () => {
    expect(resolveLalaMomentCopy(false, true, false, undefined, 1, false, 5, 40)).toBe(
      'The board needed a little reset.'
    );
  });

  test('a rescue outranks every reward signal except a genuine combo streak', () => {
    expect(resolveLalaMomentCopy(false, true, true, COLOR_BOMB_EFFECT, 3, true, 1, 500)).toBe(
      'The board needed a little reset.'
    );
  });

  test('a combo streak still wins over a rescue on the rare move that is both', () => {
    expect(resolveLalaMomentCopy(true, true, false, undefined, 1, false, 5, 40)).toBe('Beautifully done.');
  });
});
