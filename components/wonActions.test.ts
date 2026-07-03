import { getWonSummary } from './wonActions';

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
