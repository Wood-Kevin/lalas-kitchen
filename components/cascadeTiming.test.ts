import { cascadeFallDurationMs } from './cascadeTiming';

describe('cascadeFallDurationMs', () => {
  test('maps each known speed to a distinct duration, slowest to fastest', () => {
    const slow = cascadeFallDurationMs('slow');
    const medium = cascadeFallDurationMs('medium');
    const fast = cascadeFallDurationMs('fast');

    expect(slow).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(fast);
  });

  test('"medium" matches the value used by the lalas-kitchen config', () => {
    expect(cascadeFallDurationMs('medium')).toBe(480);
  });
});
