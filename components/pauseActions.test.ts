import { getPauseAction } from './pauseActions';

describe('getPauseAction', () => {
  test('reason "moves" produces a moves-resource action', () => {
    expect(getPauseAction('moves')).toEqual({
      resource: 'moves',
      message: 'Out of moves!',
      buttonLabel: '+5 Moves',
      bonusAmount: 5,
    });
  });

  test('reason "lives" produces a lives-resource action', () => {
    expect(getPauseAction('lives')).toEqual({
      resource: 'lives',
      message: 'Out of lives!',
      buttonLabel: '+1 Life',
      bonusAmount: 1,
    });
  });

  test('null reason produces no action', () => {
    expect(getPauseAction(null)).toBeNull();
  });
});
