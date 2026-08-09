import React, { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { buildCelebrationParticles, CelebrationParticle } from './celebrationParticles';

// Real firework-style celebration for a win, intensity-gated by how well it
// went (see wonActions.ts's resolveCelebrationTier) — confirmed in scope
// this session, correcting two stale doc lines that had said otherwise (see
// commercial-polish-with-charm-plan.md and release-character-pack.md).
// Deliberately still bounded, not a full-screen effect: it's anchored to and
// clipped by WonOverlay's own illustration area, the same corner an
// ordinary win's Sparkle pair already occupies, so "more juice" means a
// bigger moment in the same restrained footprint, not the screen taking
// over.
const FADE_IN_FRACTION = 0.15;

// Three numbers per tier, not one — SPEC.md's win-tier thread added 'light'
// (a 2-star win) alongside the original 'full' (3-star or a recipe unlock),
// scaling particle count, flight duration, AND distance together so a
// lighter win reads as a genuinely smaller moment, not just the same burst
// with fewer dots.
const INTENSITY: Record<'light' | 'full', { particleCount: number; flightMs: number; distanceScale: number }> = {
  light: { particleCount: 7, flightMs: 380, distanceScale: 0.6 },
  full: { particleCount: 14, flightMs: 560, distanceScale: 1 },
};

function BurstParticle({ particle, flightMs }: { particle: CelebrationParticle; flightMs: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      particle.delayMs,
      withTiming(1, { duration: flightMs, easing: Easing.out(Easing.cubic) })
    );
    // flightMs is fixed for this particle's whole lifetime (derived from the
    // intensity prop, which WonOverlay never changes mid-mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [particle.delayMs, progress]);

  const rad = (particle.angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * particle.distance;
  const dy = Math.sin(rad) * particle.distance;

  // Same fade-in-fast/fade-out-the-rest curve SteamWisp.tsx already uses,
  // reused rather than re-derived, so every overlay motion in this file
  // shares one "arrive then dissolve" feel.
  const animatedStyle = useAnimatedStyle(() => ({
    opacity:
      progress.value < FADE_IN_FRACTION
        ? progress.value / FADE_IN_FRACTION
        : 1 - (progress.value - FADE_IN_FRACTION) / (1 - FADE_IN_FRACTION),
    transform: [
      { translateX: dx * progress.value },
      { translateY: dy * progress.value },
      { rotate: `${45 + particle.rotateDeg * progress.value}deg` },
      { scale: 0.5 + progress.value * 0.5 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.particle, { backgroundColor: particle.color }, animatedStyle]}
    />
  );
}

export interface WinCelebrationBurstProps {
  colors: string[];
  intensity: 'light' | 'full';
}

// Reuses the game's own accent-color language (WonOverlay passes its
// sparkle yolk/flame pair plus the skin's accent/secondaryAccent) rather
// than inventing a generic confetti palette, so a strong win still reads as
// distinctly THIS game's colors, not a stock celebration overlay.
export function WinCelebrationBurst({ colors, intensity }: WinCelebrationBurstProps) {
  const { particleCount, flightMs, distanceScale } = INTENSITY[intensity];
  const particles = useMemo(
    () => buildCelebrationParticles(particleCount, colors, distanceScale),
    [particleCount, colors, distanceScale]
  );

  return (
    <Animated.View pointerEvents="none" style={styles.layer}>
      {particles.map((particle) => (
        <BurstParticle key={particle.id} particle={particle} flightMs={flightMs} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Centered rather than anchored to either branch's own internal layout —
  // WonOverlay mounts this once as a sibling over whichever of
  // RecipeCardReveal or the plated-dish illustration is showing (see that
  // file's celebrationSlot), and the two have different heights/content, so
  // a shared true-center anchor is the one placement that stays reasonable
  // for both without duplicating this component into each branch.
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 3,
  },
});
