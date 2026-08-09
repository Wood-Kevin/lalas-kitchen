import {
  canGrantBonusMoves,
  canUseHint,
  canUseShuffle,
  getPauseAction,
  HINT_USES_PER_ATTEMPT,
  MOVE_GRANTS_PER_ATTEMPT,
  nextAttemptUseCount,
  remainingUses,
  SHUFFLE_USES_PER_ATTEMPT,
  shouldOfferContinue,
} from './pauseActions';

describe('getPauseAction', () => {
  test('reason "moves" produces a moves action', () => {
    expect(getPauseAction('moves')).toEqual({
      message: 'Out of moves!',
      buttonLabel: '+5 Moves',
      bonusAmount: 5,
    });
  });

  test('null reason produces no action', () => {
    expect(getPauseAction(null)).toBeNull();
  });
});

describe('canGrantBonusMoves', () => {
  test('the cap is 2 grants per attempt', () => {
    // Guards the design contract itself — the per-attempt cap this session
    // added is 2, not unlimited (the previous behaviour).
    expect(MOVE_GRANTS_PER_ATTEMPT).toBe(2);
  });

  test('the first two grants of an attempt are offered', () => {
    // A fresh attempt starts at 0 used, so the first grant is allowed; after
    // one is taken (1 used) the second is still allowed.
    expect(canGrantBonusMoves(0)).toBe(true);
    expect(canGrantBonusMoves(1)).toBe(true);
  });

  test('a third grant in the same attempt is blocked', () => {
    // Once both grants are spent (2 used), the video CTA is no longer offered.
    expect(canGrantBonusMoves(2)).toBe(false);
    expect(canGrantBonusMoves(3)).toBe(false);
  });

  test('a full attempt: two grants land, the third is blocked, a restart resets', () => {
    // Walk the exact transitions Board drives (see Board.tsx's handleGrant /
    // handlePlayAgain), so the cap + reset behaviour is covered end to end
    // without mounting the overlay.
    let used = 0; // fresh attempt

    // First grant offered and taken.
    expect(canGrantBonusMoves(used)).toBe(true);
    used = nextAttemptUseCount(used, 'use');

    // Second grant offered and taken.
    expect(canGrantBonusMoves(used)).toBe(true);
    used = nextAttemptUseCount(used, 'use');

    // Third out-of-moves in the same attempt: no grant on offer.
    expect(canGrantBonusMoves(used)).toBe(false);

    // Starting the attempt over (Play Again, or a re-entry that remounts Board)
    // clears the count, so the grant is fully available again.
    used = nextAttemptUseCount(used, 'restart');
    expect(used).toBe(0);
    expect(canGrantBonusMoves(used)).toBe(true);
  });
});

describe('canUseHint', () => {
  test('the cap is 2 hint uses per attempt', () => {
    // Guards the design contract itself — the stuck-hint button's per-attempt
    // cap is 2, the same number as the bonus-moves grant today but tracked
    // independently.
    expect(HINT_USES_PER_ATTEMPT).toBe(2);
  });

  test('the first two hint taps of an attempt are allowed', () => {
    expect(canUseHint(0)).toBe(true);
    expect(canUseHint(1)).toBe(true);
  });

  test('a third hint tap in the same attempt is blocked', () => {
    expect(canUseHint(2)).toBe(false);
    expect(canUseHint(3)).toBe(false);
  });

  test('a full attempt: two hint uses land, the third is blocked, a restart resets', () => {
    // Same walk as canGrantBonusMoves's own full-attempt test above, against
    // the shared nextAttemptUseCount — confirms the hint button's cap and the
    // bonus-moves grant's cap behave identically without being the same
    // counter.
    let used = 0; // fresh attempt

    expect(canUseHint(used)).toBe(true);
    used = nextAttemptUseCount(used, 'use');

    expect(canUseHint(used)).toBe(true);
    used = nextAttemptUseCount(used, 'use');

    // Third tap in the same attempt: button should already be gone, but the
    // underlying predicate is blocked regardless.
    expect(canUseHint(used)).toBe(false);

    // A fresh attempt (Play Again, or a re-entry that remounts Board) resets
    // the hint counter fully, independent of the bonus-moves grant counter.
    used = nextAttemptUseCount(used, 'restart');
    expect(used).toBe(0);
    expect(canUseHint(used)).toBe(true);
  });
});

describe('canUseShuffle', () => {
  test('the cap is 2 shuffle uses per attempt', () => {
    // Guards the design contract itself — reverses the shuffle button's
    // original "deliberately uncapped" behaviour (real playtest feedback,
    // see engine/DECISIONS.md) to the same number as the other two
    // per-attempt caps, tracked independently.
    expect(SHUFFLE_USES_PER_ATTEMPT).toBe(2);
  });

  test('the first two shuffle taps of an attempt are allowed', () => {
    expect(canUseShuffle(0)).toBe(true);
    expect(canUseShuffle(1)).toBe(true);
  });

  test('a third shuffle tap in the same attempt is blocked', () => {
    expect(canUseShuffle(2)).toBe(false);
    expect(canUseShuffle(3)).toBe(false);
  });

  test('a full attempt: two shuffle uses land, the third is blocked, a restart resets', () => {
    let used = 0; // fresh attempt

    expect(canUseShuffle(used)).toBe(true);
    used = nextAttemptUseCount(used, 'use');

    expect(canUseShuffle(used)).toBe(true);
    used = nextAttemptUseCount(used, 'use');

    // Third tap in the same attempt: button should already be gone, but the
    // underlying predicate is blocked regardless.
    expect(canUseShuffle(used)).toBe(false);

    // A fresh attempt resets the shuffle counter fully, independent of the
    // hint and bonus-moves grant counters.
    used = nextAttemptUseCount(used, 'restart');
    expect(used).toBe(0);
    expect(canUseShuffle(used)).toBe(true);
  });
});

describe('remainingUses', () => {
  test('reports the plain cap-minus-used count while under the cap', () => {
    expect(remainingUses(2, 0, false)).toBe(2);
    expect(remainingUses(2, 1, false)).toBe(1);
  });

  test('never goes negative once used exceeds the cap', () => {
    expect(remainingUses(2, 2, false)).toBe(0);
    expect(remainingUses(2, 5, false)).toBe(0);
  });

  test('shows exactly 1 once the cap is spent but a bonus token remains', () => {
    expect(remainingUses(2, 2, true)).toBe(1);
    expect(remainingUses(2, 5, true)).toBe(1);
  });

  test('a bonus token never adds to a count that is already positive', () => {
    // The token is a single extra use available once the cap runs out, not a
    // bonus stacked on top of a still-available cap count.
    expect(remainingUses(2, 1, true)).toBe(1);
    expect(remainingUses(2, 0, true)).toBe(2);
  });
});

describe('shouldOfferContinue', () => {
  test('offers the rescue on a fresh moves-exhausted pause', () => {
    expect(shouldOfferContinue('moves', 0)).toBe(true);
  });

  test('still offers it after one grant, before the cap', () => {
    expect(shouldOfferContinue('moves', 1)).toBe(true);
  });

  test('stops offering it once the per-attempt cap is reached — this is the exact moment', () => {
    // Board.tsx's runStep spends the life the instant this returns false —
    // guarding the cap boundary here is guarding the life-spend boundary too.
    expect(shouldOfferContinue('moves', MOVE_GRANTS_PER_ATTEMPT)).toBe(false);
    expect(shouldOfferContinue('moves', MOVE_GRANTS_PER_ATTEMPT + 1)).toBe(false);
  });

  test('never offers it for a non-moves (null) pause reason, regardless of grants used', () => {
    expect(shouldOfferContinue(null, 0)).toBe(false);
  });
});
