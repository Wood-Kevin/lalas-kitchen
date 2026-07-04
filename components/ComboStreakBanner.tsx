import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

export interface ComboStreakBannerProps {
  accentColor: string;
  panelColor: string;
  onDone: () => void;
}

// A brief, calm acknowledgment of engine/gameState.ts's combo_streak event
// (4+ chained cascades from one move) — the first thing that actually
// consumes it (see engine/DECISIONS.md's "Combo-streak and level-summary
// events aren't consumed by anything yet"). Board.tsx mounts this fresh per
// event (a new `key` per occurrence) rather than retriggering a persistent
// instance, so the fade sequence below always starts clean.
//
// Deliberately just a soft fade-in/hold/fade-out on a small text pill, no
// scale/bounce/particle burst — CLAUDE.md rules out high-intensity combo
// effects for this specific player, so this reads as a quiet acknowledgment
// rather than a celebration. Purely decorative: Board.tsx renders it with
// pointerEvents="none", so it never gates the player's next tap.
const FADE_IN_MS = 200;
const HOLD_MS = 700;
const FADE_OUT_MS = 300;

export function ComboStreakBanner({ accentColor, panelColor, onDone }: ComboStreakBannerProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS }),
      withTiming(1, { duration: HOLD_MS }),
      withTiming(0, { duration: FADE_OUT_MS })
    );
    const timeout = setTimeout(onDone, FADE_IN_MS + HOLD_MS + FADE_OUT_MS);
    return () => clearTimeout(timeout);
    // Runs once per mount — a fresh combo_streak event gets a fresh instance
    // (see the `key` prop at the Board.tsx call site), so there's nothing
    // else here that should retrigger the sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.container, animatedStyle]} pointerEvents="none" testID="combo-streak-banner">
      <Animated.View style={[styles.pill, { backgroundColor: panelColor, borderColor: accentColor }]}>
        <Text style={[styles.text, { color: accentColor }]}>Nice chain!</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  text: {
    fontSize: 14,
    fontWeight: '700',
  },
});
