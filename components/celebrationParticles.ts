// Pure layout for WinCelebrationBurst.tsx's particles — kept separate from
// the Reanimated component the same way specialEffectAnimation.ts's
// radialDelaysForClears is kept separate from the tiles that consume it, so
// the geometry is a plain, testable function instead of logic buried inside
// a worklet closure.
//
// Deterministic on purpose (no Math.random): a golden-angle step (~137.5°,
// the standard technique for scattering N points around a circle with no
// visible clustering or symmetry) spreads particles evenly without ever
// repeating the exact same burst shape twice in a row feeling suspicious,
// and it means this function's own output is exactly reproducible in a
// test. Distance alternates across three fixed rings (rather than one
// perfect circle) so the burst reads as scattered debris, not a rosette.
export interface CelebrationParticle {
  id: string;
  angleDeg: number;
  distance: number;
  delayMs: number;
  color: string;
  rotateDeg: number;
}

const GOLDEN_ANGLE_DEG = 137.5;
const RING_DISTANCES = [42, 58, 74];
// Spread across a short window so the burst reads as one continuous
// eruption rather than N simultaneous pops — short enough to still feel
// like a single beat, not a sequence of separate events.
const STAGGER_WINDOW_MS = 140;

export function buildCelebrationParticles(count: number, colors: string[]): CelebrationParticle[] {
  if (count <= 0 || colors.length === 0) return [];
  const particles: CelebrationParticle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      id: `particle-${i}`,
      angleDeg: (i * GOLDEN_ANGLE_DEG) % 360,
      distance: RING_DISTANCES[i % RING_DISTANCES.length],
      delayMs: Math.round((i / count) * STAGGER_WINDOW_MS),
      color: colors[i % colors.length],
      rotateDeg: (i * 53) % 360,
    });
  }
  return particles;
}
