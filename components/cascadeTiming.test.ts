import {
  cascadeFallDurationMs,
  planCascadeAnimation,
  terminalOverlayHoldMs,
  springSettleMs,
  columnDropDelayMs,
  COLUMN_DROP_STAGGER_MS,
  SWAP_DAMPING_RATIO,
  FALL_DAMPING_RATIO,
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

describe('springSettleMs (a swap must finish settling before its match clears)', () => {
  test('a moving tile waits longer than the spring\'s perceptual duration', () => {
    // Reanimated treats a spring's `duration` as PERCEPTUAL; the overshoot is
    // still travelling back after that. Holding the clear for only the
    // perceptual value pops the match mid-bounce.
    expect(springSettleMs(300)).toBe(450);
    expect(springSettleMs(300)).toBeGreaterThan(300);
  });

  test('a tile that never moved waits for nothing at all', () => {
    // Every clear except a swapped cell passes 0 here, which is what keeps
    // ordinary cascade/sweep/blast clears byte-identical to before travel existed.
    expect(springSettleMs(0)).toBe(0);
  });

  test('scales linearly, so tuning swapDurationMs keeps the two clocks in step', () => {
    expect(springSettleMs(200)).toBe(300);
    expect(springSettleMs(400)).toBe(600);
  });
});

describe('columnDropDelayMs (a refill should travel, not land as one slab)', () => {
  test('the leftmost column drops immediately', () => {
    expect(columnDropDelayMs(0)).toBe(0);
  });

  test('each column to the right waits one more stagger step', () => {
    expect(columnDropDelayMs(1)).toBe(COLUMN_DROP_STAGGER_MS);
    expect(columnDropDelayMs(4)).toBe(4 * COLUMN_DROP_STAGGER_MS);
  });

  test('the whole ripple stays short enough to read as one cascade, not a wave', () => {
    // Widest board this game builds is 5 columns; the end-to-end offset must
    // stay well inside a single cascade beat (cascadeFallDurationMs 480).
    expect(columnDropDelayMs(4)).toBeLessThan(cascadeFallDurationMs('medium') / 4);
  });

  test('a negative column can never produce a negative delay', () => {
    expect(columnDropDelayMs(-1)).toBe(0);
  });
});

describe('fall vs swap settle (overshoot scales with distance)', () => {
  test('a falling piece settles more firmly than a swapped one', () => {
    // A swap travels one tile; a fall can cross the board, where the swap's
    // generous overshoot would scale into a floaty bounce.
    expect(FALL_DAMPING_RATIO).toBeGreaterThan(SWAP_DAMPING_RATIO);
  });

  test('both stay under 1, so neither is critically damped into a dead stop', () => {
    expect(SWAP_DAMPING_RATIO).toBeLessThan(1);
    expect(FALL_DAMPING_RATIO).toBeLessThan(1);
  });
});
