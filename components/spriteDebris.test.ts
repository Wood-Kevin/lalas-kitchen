import { buildDebrisParticlePool, debrisParticleCount } from './spriteDebris';

describe('buildDebrisParticlePool', () => {
  test('returns exactly maxCount entries when the grid has room', () => {
    const pool = buildDebrisParticlePool(4, 10);
    expect(pool.length).toBe(10);
  });

  test('never exceeds the grid\'s own cell count — no duplicate crop shown twice', () => {
    const pool = buildDebrisParticlePool(2, 100);
    expect(pool.length).toBe(4); // a 2x2 grid has only 4 distinct cells
  });

  test('every origin fraction lies inside the tile (0..1, exclusive of 1)', () => {
    const pool = buildDebrisParticlePool(4, 16);
    for (const p of pool) {
      expect(p.originXFrac).toBeGreaterThanOrEqual(0);
      expect(p.originXFrac).toBeLessThan(1);
      expect(p.originYFrac).toBeGreaterThanOrEqual(0);
      expect(p.originYFrac).toBeLessThan(1);
    }
  });

  test('no two particles share the same crop origin — a real scattered sample, not repeats', () => {
    const pool = buildDebrisParticlePool(4, 16);
    const keys = new Set(pool.map((p) => `${p.originXFrac},${p.originYFrac}`));
    expect(keys.size).toBe(pool.length);
  });

  test('every particle carries launch jitter', () => {
    const pool = buildDebrisParticlePool(4, 4);
    for (const p of pool) {
      expect(typeof p.angleRad).toBe('number');
      expect(p.speedMultiplier).toBeGreaterThan(0);
    }
  });
});

describe('debrisParticleCount (scaled by how rewarding the clear feels)', () => {
  test('a flat, unrewarding clear still throws the base count', () => {
    expect(debrisParticleCount(0, 8, 8)).toBe(8);
  });

  test('full reward intensity reaches base + max extra', () => {
    expect(debrisParticleCount(1, 8, 8)).toBe(16);
  });

  test('scales monotonically between the floor and the peak', () => {
    const low = debrisParticleCount(0.2, 8, 8);
    const high = debrisParticleCount(0.8, 8, 8);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(16);
  });
});
