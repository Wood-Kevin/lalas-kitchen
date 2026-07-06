import { resetIdleHintTimer } from './stuckHintTiming';

describe('resetIdleHintTimer', () => {
  test('the moment a player actually makes a move: cancels the OLD idle countdown and arms a fresh one, never letting the old one fire against a now-stale board', () => {
    const cancel = jest.fn();
    const schedule = jest.fn(() => 'fresh-handle');

    const result = resetIdleHintTimer('stale-handle', true, schedule, cancel);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('stale-handle');
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(result).toBe('fresh-handle');
  });

  test('arms a fresh timer when nothing was pending and a move can still be made', () => {
    const cancel = jest.fn();
    const schedule = jest.fn(() => 'new-handle');

    const result = resetIdleHintTimer(null, true, schedule, cancel);

    expect(cancel).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(result).toBe('new-handle');
  });

  test('cancels a pending timer and does not arm a new one once a move can no longer be made (an overlay opened, the level ended, mid-cascade)', () => {
    const cancel = jest.fn();
    const schedule = jest.fn();

    const result = resetIdleHintTimer('old-handle', false, schedule, cancel);

    expect(cancel).toHaveBeenCalledWith('old-handle');
    expect(schedule).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  test('does nothing when there is no pending timer and arming is not allowed', () => {
    const cancel = jest.fn();
    const schedule = jest.fn();

    const result = resetIdleHintTimer(null, false, schedule, cancel);

    expect(cancel).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
