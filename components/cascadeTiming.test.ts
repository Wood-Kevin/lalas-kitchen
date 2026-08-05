import {
  cascadeFallDurationMs,
  planCascadeAnimation,
  terminalOverlayHoldMs,
  springSettleMs,
  columnDropDelayMs,
  COLUMN_DROP_STAGGER_MS,
  TILE_MOVE_DAMPING_RATIO,
  SQUASH_SCALE_X,
  SQUASH_SCALE_Y,
  SQUASH_DOWN_MS,
  SQUASH_RECOVER_MS,
  SQUASH_TOTAL_MS,
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

describe('springSettleMs (a swap must finish its landing beat before its match clears)', () => {
  test('a moving tile waits the move duration plus the full squash beat', () => {
    // Position no longer overshoots (TILE_MOVE_DAMPING_RATIO is critically
    // damped), but the squash-and-stretch landing beat still plays AFTER
    // arrival, so the clear must wait for that too — holding for only the
    // move duration would pop the match mid-squash.
    expect(springSettleMs(300)).toBe(300 + SQUASH_TOTAL_MS);
    expect(springSettleMs(300)).toBeGreaterThan(300);
  });

  test('a tile that never moved waits for nothing at all', () => {
    // Every clear except a swapped cell passes 0 here, which is what keeps
    // ordinary cascade/sweep/blast clears byte-identical to before travel existed.
    expect(springSettleMs(0)).toBe(0);
  });

  test('adds the same fixed squash beat regardless of move duration', () => {
    // Additive, not multiplicative: the squash is a fixed-length beat, not a
    // fraction of the move — a slow fall and a fast swap both get exactly
    // SQUASH_TOTAL_MS tacked on, not a proportional settle tail.
    expect(springSettleMs(200)).toBe(200 + SQUASH_TOTAL_MS);
    expect(springSettleMs(400)).toBe(400 + SQUASH_TOTAL_MS);
    expect(springSettleMs(400) - springSettleMs(200)).toBe(200);
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

describe('tile motion has no position overshoot; squash carries the "juice" instead', () => {
  // See engine/DECISIONS.md's swap-smoothness Follow-up 5: three rounds of
  // tuning a spring's damping ratio (including a distance-aware swap/fall
  // split, once real here) never converged, because a tile sliding past its
  // own grid cell and back is a structurally worse-looking thing than a
  // spring overshooting in open space, independent of how small the overshoot
  // is. Position is now critically damped for every motion; the previous
  // swap-vs-fall damping distinction no longer exists to test.
  test('position motion is critically damped — no overshoot, for any distance', () => {
    expect(TILE_MOVE_DAMPING_RATIO).toBe(1);
  });

  test('the squash compresses on one axis and widens on the other, not both the same way', () => {
    // A real squash-and-stretch: compressing on Y without any correlated X
    // stretch reads as the tile merely shrinking, not squishing.
    expect(SQUASH_SCALE_Y).toBeLessThan(1);
    expect(SQUASH_SCALE_X).toBeGreaterThan(1);
  });

  test('the squash total is the sum of its two phases, so tuning either stays honest', () => {
    // Guards against the two constants and their sum drifting apart if only
    // one is edited later — springSettleMs relies on the total being exact.
    expect(SQUASH_TOTAL_MS).toBe(SQUASH_DOWN_MS + SQUASH_RECOVER_MS);
  });
});
