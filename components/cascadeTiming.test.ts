import {
  cascadeFallDurationMs,
  planCascadeAnimation,
  terminalOverlayHoldMs,
} from './cascadeTiming';

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

describe('planCascadeAnimation', () => {
  const INTERVAL = 480; // the medium cascade beat used in play

  test('the terminal overlay is revealed only after the single pass of a one-pass move has played', () => {
    // A single-match winning move still animates one pass; the overlay must not
    // pop the instant that pass begins (the moment win data resolves), so its
    // reveal is a full beat after the one and only step start.
    const { stepStartsMs, overlayRevealMs } = planCascadeAnimation(1, INTERVAL);

    expect(stepStartsMs).toEqual([0]);
    expect(overlayRevealMs).toBe(INTERVAL);
    expect(overlayRevealMs).toBeGreaterThan(stepStartsMs[stepStartsMs.length - 1]);
  });

  test('every cascade pass begins before the terminal overlay, for a multi-pass chain', () => {
    // The core guarantee: for a winning move whose threshold is crossed early
    // but that keeps cascading, the overlay reveal comes strictly AFTER the
    // final pass has begun and had its beat — so no pass is cut off. Checked
    // across chain lengths, since a real winning move can be any depth.
    for (const stepCount of [2, 3, 5]) {
      const { stepStartsMs, overlayRevealMs } = planCascadeAnimation(stepCount, INTERVAL);

      expect(stepStartsMs).toHaveLength(stepCount);
      // Passes are evenly spaced, in order, starting at 0.
      expect(stepStartsMs).toEqual(
        Array.from({ length: stepCount }, (_, i) => i * INTERVAL)
      );
      // The overlay reveal is later than the LAST pass's start (and therefore
      // later than every pass's start) — animation completion, not data.
      for (const start of stepStartsMs) {
        expect(overlayRevealMs).toBeGreaterThan(start);
      }
      // Specifically one full beat past the final pass's start.
      expect(overlayRevealMs).toBe((stepCount - 1) * INTERVAL + terminalOverlayHoldMs(INTERVAL));
    }
  });

  test('the hold after the final pass is one full between-pass beat', () => {
    // The last pass gets the exact play time every earlier pass already gets
    // before the next one starts — no bespoke shorter/longer terminal delay.
    expect(terminalOverlayHoldMs(INTERVAL)).toBe(INTERVAL);
  });
});
