import React, { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { buildCelebrationParticles, CelebrationParticle } from './celebrationParticles';

// Real firework-style celebration for a strong win (see wonActions.ts's
// isStrongWin) — confirmed in scope this session, correcting two stale doc
// lines that had said otherwise (see commercial-polish-with-charm-plan.md
// and release-character-pack.md). Deliberately still bounded, not a
// full-screen effect: it's anchored to and clipped by WonOverlay's own
// illustration area, the same corner an ordinary win's Sparkle pair already
// occupies, so "more juice" means a bigger moment in the same restrained
// footprint, not the screen taking over.
const PARTICLE_COUNT = 14;
const FLIGHT_MS = 560;
const FADE_IN_FRACTION = 0.15;

function BurstParticle({ particle }: { particle: CelebrationParticle }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      particle.delayMs,
      withTiming(1, { duration: FLIGHT_MS, easing: Easing.out(Easing.cubic) })
    );
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
}

// Reuses the game's own accent-color language (WonOverlay passes its
// sparkle yolk/flame pair plus the skin's accent/secondaryAccent) rather
// than inventing a generic confetti palette, so a strong win still reads as
// distinctly THIS game's colors, not a stock celebration overlay.
export function WinCelebrationBurst({ colors }: WinCelebrationBurstProps) {
  const particles = useMemo(() => buildCelebrationParticles(PARTICLE_COUNT, colors), [colors]);

  return (
    <Animated.View pointerEvents="none" style={styles.layer}>
      {particles.map((particle) => (
        <BurstParticle key={particle.id} particle={particle} />
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
