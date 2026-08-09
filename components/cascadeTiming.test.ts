import {
  fallSpeedProfile,
  fallDurationForCells,
  passDurationMs,
  passFallDelayMs,
  passClearsEndMs,
  passRewardIntensity,
  scaledByReward,
  planCascadeAnimation,
  springSettleMs,
  PASS_BEAT_MS,
  SPAWN_FADE_MS,
  MATCH_POP_MS,
  MATCH_POP_SCALE,
  MATCH_POP_OPACITY,
  BLOCKER_CLEAR_HIGHLIGHT_MS,
  TILE_MOVE_DAMPING_RATIO,
  SQUASH_SCALE_X,
  SQUASH_SCALE_Y,
  SQUASH_DOWN_MS,
  SQUASH_RECOVER_MS,
  SQUASH_TOTAL_MS,
  EXPERIMENTAL_HIT_STOP_MS,
  MATCH_POP_ROTATE_DEG,
  BLOCKER_SHATTER_TRAVEL_FRACTION,
  BLOCKER_SHATTER_ROTATE_DEG,
  RADIAL_RING_MAX_SCALE,
  RADIAL_RING_PEAK_OPACITY,
} from './cascadeTiming';

const MEDIUM = fallSpeedProfile('medium');

describe('fallSpeedProfile (a speed is a velocity, not a duration)', () => {
  test('each known speed maps to a distinct per-cell rate, slowest to fastest', () => {
    expect(fallSpeedProfile('slow').perCellMs).toBeGreaterThan(fallSpeedProfile('medium').perCellMs);
    expect(fallSpeedProfile('medium').perCellMs).toBeGreaterThan(fallSpeedProfile('fast').perCellMs);
  });

  test('an unknown speed string falls back to medium', () => {
    expect(fallSpeedProfile('nonsense' as never)).toEqual(MEDIUM);
  });
});

describe('fallDurationForCells (the core game-feel fix: consistent speed, varying arrival)', () => {
  test('no travel means no animation at all', () => {
    expect(fallDurationForCells(MEDIUM, 0)).toBe(0);
    expect(fallDurationForCells(MEDIUM, -2)).toBe(0);
  });

  test('duration grows with distance — a deeper fall takes longer, never the same flat time', () => {
    const one = fallDurationForCells(MEDIUM, 1);
    const two = fallDurationForCells(MEDIUM, 2);
    const three = fallDurationForCells(MEDIUM, 3);
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
  });

  test('per-cell travel speed is near-uniform across distances (the base only skews short falls slightly)', () => {
    // The property the whole overhaul exists for: a 1-cell fall and a 4-cell
    // fall move at roughly the SAME visual speed. With a flat duration the
    // 4-cell fall would be 4x faster; here the ratio of per-cell times stays
    // within the small skew the fixed base introduces (SPEC.md allows 25%).
    const perCellAt1 = fallDurationForCells(MEDIUM, 1) / 1;
    const perCellAt3 = fallDurationForCells(MEDIUM, 3) / 3;
    expect(perCellAt1 / perCellAt3).toBeLessThan(1.25);
    expect(perCellAt1 / perCellAt3).toBeGreaterThan(1);
  });

  test('the cap bounds a full-board fall so a tall shaped level can never drag', () => {
    expect(fallDurationForCells(MEDIUM, 50)).toBe(MEDIUM.capMs);
    expect(fallDurationForCells(MEDIUM, 50)).toBe(fallDurationForCells(MEDIUM, 100));
  });

  test('fractional distances are legal — a mid-flight retarget derives from real remaining travel', () => {
    const half = fallDurationForCells(MEDIUM, 0.5);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(fallDurationForCells(MEDIUM, 1));
  });

  test('a typical short cascade fall keeps the calm register the old flat 480ms set', () => {
    // 2-3 cells lands in the same unhurried neighborhood as before; only the
    // 1-cell fall (previously glacial at 480ms) genuinely tightens.
    expect(fallDurationForCells(MEDIUM, 2)).toBeGreaterThanOrEqual(350);
    expect(fallDurationForCells(MEDIUM, 3)).toBeLessThanOrEqual(560);
    expect(fallDurationForCells(MEDIUM, 1)).toBeLessThan(300);
  });
});

describe('passFallDelayMs / passClearsEndMs (clears first, THEN the collapse — sequential, not concurrent)', () => {
  const base = {
    maxMotionCells: 0,
    hasClears: true,
    maxClearDelayMs: 0,
    hasBlockerClear: false,
    matchDurationMs: 300,
    settleMs: 0,
  };

  test('falls wait out the full pop-and-shrink of an ordinary clear', () => {
    // The bug the first live playtest caught: a refill visibly fell onto a
    // match that was still on screen. Falls now start when clears end.
    expect(passFallDelayMs(base)).toBe(300);
  });

  test('a staggered clear (sweep/radial/chain) pushes the collapse out by its latest start', () => {
    expect(passFallDelayMs({ ...base, maxClearDelayMs: 385 })).toBe(385 + 300);
  });

  test('a blocker clear holds the collapse through its highlight pulse', () => {
    expect(passFallDelayMs({ ...base, hasBlockerClear: true })).toBe(
      BLOCKER_CLEAR_HIGHLIGHT_MS + 300
    );
  });

  test('the blocker pulse and a larger stagger do not stack — the later one wins', () => {
    expect(passFallDelayMs({ ...base, hasBlockerClear: true, maxClearDelayMs: 500 })).toBe(500 + 300);
  });

  test("pass 0's swap settle holds the clears, and therefore the collapse after them", () => {
    expect(passFallDelayMs({ ...base, settleMs: 500 })).toBe(500 + 300);
  });

  test('a motion-only pass (shuffle rescue) has no clears to wait for', () => {
    expect(passFallDelayMs({ ...base, hasClears: false })).toBe(0);
    expect(passClearsEndMs({ ...base, hasClears: false, settleMs: 500 })).toBe(500);
  });
});

describe('passDurationMs (a pass runs as long as its own content, no metronome)', () => {
  const base = {
    maxMotionCells: 0,
    hasClears: true,
    maxClearDelayMs: 0,
    hasBlockerClear: false,
    matchDurationMs: 300,
    settleMs: 0,
  };

  test('a clear-only pass is just the pop-and-shrink', () => {
    expect(passDurationMs(base, MEDIUM)).toBe(300);
  });

  test('clears and falls run in sequence — the pass is their sum, not their max', () => {
    const withFall = { ...base, maxMotionCells: 4 };
    expect(passDurationMs(withFall, MEDIUM)).toBe(300 + fallDurationForCells(MEDIUM, 4));
  });

  test('a staggered clear pushes both the collapse and the pass end out together', () => {
    const withDelay = { ...base, maxClearDelayMs: 385, maxMotionCells: 2 };
    expect(passDurationMs(withDelay, MEDIUM)).toBe(
      385 + 300 + fallDurationForCells(MEDIUM, 2)
    );
  });

  test('a motion-only pass is just its longest move', () => {
    const shuffleLike = { ...base, hasClears: false, maxMotionCells: 3 };
    expect(passDurationMs(shuffleLike, MEDIUM)).toBe(fallDurationForCells(MEDIUM, 3));
  });
});

describe('planCascadeAnimation (content-driven schedule, one beat of stillness between passes)', () => {
  test('the terminal overlay is revealed only after the single pass of a one-pass move has played', () => {
    const { stepStartsMs, overlayRevealMs } = planCascadeAnimation([300]);
    expect(stepStartsMs).toEqual([0]);
    expect(overlayRevealMs).toBe(300 + PASS_BEAT_MS);
    expect(overlayRevealMs).toBeGreaterThan(stepStartsMs[stepStartsMs.length - 1]);
  });

  test('every cascade pass begins before the terminal overlay, for a multi-pass chain', () => {
    const durations = [440, 640, 300];
    const { stepStartsMs, overlayRevealMs } = planCascadeAnimation(durations);

    expect(stepStartsMs).toEqual([0, 440 + PASS_BEAT_MS, 440 + 640 + 2 * PASS_BEAT_MS]);
    for (const start of stepStartsMs) {
      expect(overlayRevealMs).toBeGreaterThan(start);
    }
    // Specifically one beat past the final pass's own end.
    expect(overlayRevealMs).toBe(440 + 640 + 300 + 3 * PASS_BEAT_MS);
  });

  test('pass spacing tracks each pass content, not a fixed interval', () => {
    // The whole point of the rework: a light pass hands off quickly, a heavy
    // pass gets its full motion — the gaps differ when the content differs.
    const { stepStartsMs } = planCascadeAnimation([200, 800, 200]);
    const gap1 = stepStartsMs[1] - stepStartsMs[0];
    const gap2 = stepStartsMs[2] - stepStartsMs[1];
    expect(gap1).toBe(200 + PASS_BEAT_MS);
    expect(gap2).toBe(800 + PASS_BEAT_MS);
    expect(gap2).not.toBe(gap1);
  });

  test('an empty move yields an empty schedule (the zero-pass dropdown case)', () => {
    const { stepStartsMs, overlayRevealMs } = planCascadeAnimation([]);
    expect(stepStartsMs).toEqual([]);
    expect(overlayRevealMs).toBe(0);
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

describe('passRewardIntensity (a bigger cascade should visibly feel bigger)', () => {
  test('a flat first-pass match at minimal size is zero intensity', () => {
    expect(passRewardIntensity(0, 3)).toBe(0);
  });

  test('a later pass in a chain scores higher than the same-size first pass', () => {
    expect(passRewardIntensity(2, 3)).toBeGreaterThan(passRewardIntensity(0, 3));
  });

  test('clearing more cells than a minimal match scores higher, same pass', () => {
    expect(passRewardIntensity(0, 8)).toBeGreaterThan(passRewardIntensity(0, 3));
  });

  test('intensity never exceeds 1, however deep or large the pass', () => {
    expect(passRewardIntensity(10, 40)).toBe(1);
  });

  test('never negative for a below-minimum cleared count', () => {
    expect(passRewardIntensity(0, 0)).toBe(0);
  });
});

describe('scaledByReward (intensity moves within a mechanism\'s own ceiling, never past it)', () => {
  test('zero intensity still returns a real floor fraction of peak, not near-zero', () => {
    const floor = scaledByReward(0.5, 0);
    expect(floor).toBeGreaterThan(0.5 * 0.5);
    expect(floor).toBeLessThan(0.5);
  });

  test('full intensity reaches exactly the peak, never past it', () => {
    expect(scaledByReward(0.5, 1)).toBe(0.5);
  });

  test('scales monotonically between floor and peak', () => {
    const low = scaledByReward(0.5, 0.2);
    const high = scaledByReward(0.5, 0.8);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(0.5);
  });
});

describe('the ordinary-match anticipation beat fits inside the clear budget', () => {
  test('the pop is a small fraction of matchDurationMs, so the clear total is unchanged', () => {
    // Folded into the FRONT of the existing budget (the sweep pop's own
    // pattern) — if the pop ever grew past the budget the shrink would clamp
    // to zero and the clear would read as a flash with no exit.
    expect(MATCH_POP_MS).toBeLessThan(300 / 2);
  });

  test('milder than every special-effect pop on both axes', () => {
    // It plays on every single match: acknowledge, never celebrate. The
    // sweep pops to 1.15 scale / 0.5 wash; this must stay under both.
    expect(MATCH_POP_SCALE).toBeGreaterThan(1);
    expect(MATCH_POP_SCALE).toBeLessThan(1.15);
    expect(MATCH_POP_OPACITY).toBeGreaterThan(0);
    expect(MATCH_POP_OPACITY).toBeLessThan(0.5);
  });
});

describe('per-mechanism clear motion stays distinct and in the calm register', () => {
  test('the ordinary match twist is a texture, not a spin — still the mildest mechanism', () => {
    expect(MATCH_POP_ROTATE_DEG).toBeGreaterThan(0);
    expect(MATCH_POP_ROTATE_DEG).toBeLessThan(45);
  });

  test('a blocker shard travels outward but stays under one full tile of distance', () => {
    expect(BLOCKER_SHATTER_TRAVEL_FRACTION).toBeGreaterThan(0);
    expect(BLOCKER_SHATTER_TRAVEL_FRACTION).toBeLessThan(1);
  });

  test('a blocker shard visibly tumbles as it flies — more than the ordinary twist', () => {
    expect(BLOCKER_SHATTER_ROTATE_DEG).toBeGreaterThan(MATCH_POP_ROTATE_DEG);
  });

  test('the radial shockwave ring outgrows its own tile but stays a legible near-field wave', () => {
    expect(RADIAL_RING_MAX_SCALE).toBeGreaterThan(1);
    expect(RADIAL_RING_MAX_SCALE).toBeLessThan(4);
  });

  test('the ring peak opacity stays a wash, never a solid fill', () => {
    expect(RADIAL_RING_PEAK_OPACITY).toBeGreaterThan(0);
    expect(RADIAL_RING_PEAK_OPACITY).toBeLessThan(0.8);
  });
});

describe('spawn/beat constants stay in the calm register', () => {
  test('the between-pass beat is stillness, not a second metronome', () => {
    // Short enough that back-to-back passes read as continuous, long enough
    // that a landing squash (SQUASH_TOTAL_MS = 200) gets most of its room.
    expect(PASS_BEAT_MS).toBeGreaterThanOrEqual(100);
    expect(PASS_BEAT_MS).toBeLessThanOrEqual(SQUASH_TOTAL_MS);
  });

  test('the enclosed-segment fade is brief — a rare fallback, not a feature', () => {
    expect(SPAWN_FADE_MS).toBeLessThanOrEqual(300);
  });
});

describe('tile motion has no position overshoot; squash carries the "juice" instead', () => {
  // See engine/DECISIONS.md's swap-smoothness Follow-up 5: three rounds of
  // tuning a spring's damping ratio (including a distance-aware swap/fall
  // split, once real here) never converged, because a tile sliding past its
  // own grid cell and back is a structurally worse-looking thing than a
  // spring overshooting in open space, independent of how small the overshoot
  // is. Position is now critically damped for every deliberate motion (falls
  // run an accelerating timing curve — see Tile.tsx's FALL_EASING — which by
  // construction cannot overshoot either).
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

describe('EXPERIMENTAL_HIT_STOP_MS (dev-only game-feel-comparison hit-stop)', () => {
  test('is a short, positive beat — a deliberate freeze, not a stutter or a stall', () => {
    expect(EXPERIMENTAL_HIT_STOP_MS).toBeGreaterThan(0);
    expect(EXPERIMENTAL_HIT_STOP_MS).toBeLessThan(200);
  });
});
