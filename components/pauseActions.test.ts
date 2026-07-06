import {
  canGrantBonusMoves,
  getPauseAction,
  MOVE_GRANTS_PER_ATTEMPT,
  nextBonusGrantsUsed,
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
    used = nextBonusGrantsUsed(used, 'grant');

    // Second grant offered and taken.
    expect(canGrantBonusMoves(used)).toBe(true);
    used = nextBonusGrantsUsed(used, 'grant');

    // Third out-of-moves in the same attempt: no grant on offer.
    expect(canGrantBonusMoves(used)).toBe(false);

    // Starting the attempt over (Play Again, or a re-entry that remounts Board)
    // clears the count, so the grant is fully available again.
    used = nextBonusGrantsUsed(used, 'restart');
    expect(used).toBe(0);
    expect(canGrantBonusMoves(used)).toBe(true);
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
