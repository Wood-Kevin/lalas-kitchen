import { buildCelebrationParticles } from './celebrationParticles';

describe('buildCelebrationParticles', () => {
  test('produces exactly `count` particles', () => {
    expect(buildCelebrationParticles(12, ['#fff'])).toHaveLength(12);
  });

  test('returns nothing for a non-positive count or an empty color list', () => {
    expect(buildCelebrationParticles(0, ['#fff'])).toEqual([]);
    expect(buildCelebrationParticles(-3, ['#fff'])).toEqual([]);
    expect(buildCelebrationParticles(10, [])).toEqual([]);
  });

  test('cycles through the given colors in order', () => {
    const particles = buildCelebrationParticles(5, ['#a', '#b']);
    expect(particles.map((p) => p.color)).toEqual(['#a', '#b', '#a', '#b', '#a']);
  });

  test('spreads angles by the golden-angle step, wrapped to 0-360', () => {
    const particles = buildCelebrationParticles(4, ['#fff']);
    expect(particles.map((p) => p.angleDeg)).toEqual([0, 137.5, 275, 52.5]);
  });

  test('delays start at 0 and stay within the stagger window, strictly increasing', () => {
    const particles = buildCelebrationParticles(8, ['#fff']);
    expect(particles[0].delayMs).toBe(0);
    for (let i = 1; i < particles.length; i++) {
      expect(particles[i].delayMs).toBeGreaterThan(particles[i - 1].delayMs);
      expect(particles[i].delayMs).toBeLessThanOrEqual(140);
    }
  });

  test('is deterministic — same inputs always produce the same output', () => {
    expect(buildCelebrationParticles(10, ['#a', '#b', '#c'])).toEqual(
      buildCelebrationParticles(10, ['#a', '#b', '#c'])
    );
  });

  test('every particle has a unique id', () => {
    const ids = buildCelebrationParticles(14, ['#fff']).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('distanceScale defaults to 1 — omitting it matches passing it explicitly', () => {
    expect(buildCelebrationParticles(6, ['#fff'])).toEqual(buildCelebrationParticles(6, ['#fff'], 1));
  });

  test('distanceScale shrinks every particle\'s distance proportionally, for the light win-celebration tier', () => {
    const full = buildCelebrationParticles(6, ['#fff'], 1);
    const light = buildCelebrationParticles(6, ['#fff'], 0.6);
    for (let i = 0; i < full.length; i++) {
      expect(light[i].distance).toBeCloseTo(full[i].distance * 0.6);
    }
  });
});
