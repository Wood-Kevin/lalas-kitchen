import { getPauseAction } from './pauseActions';

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
