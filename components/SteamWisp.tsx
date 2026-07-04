import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export interface SteamWispProps {
  left: string;
  delayMs: number;
}

// A single soft rising-and-fading wisp, shared by WonOverlay's dish
// illustration and PausedOverlay's pot illustration — same gentle motion on
// both so the two overlays read as siblings. Deliberately opacity/position
// only (no burst, no scale spike), per CLAUDE.md's "calm and satisfying,
// not frantic" constraint.
export function SteamWisp({ left, delayMs }: SteamWispProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delayMs,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 0 })
        ),
        -1,
        false
      )
    );
  }, [delayMs, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value < 0.15 ? progress.value / 0.15 : 1 - (progress.value - 0.15) / 0.85,
    transform: [{ translateY: -18 * progress.value }],
  }));

  return <Animated.View style={[styles.steamWisp, { left }, animatedStyle]} />;
}

const styles = StyleSheet.create({
  steamWisp: {
    position: 'absolute',
    top: 8,
    width: 5,
    height: 26,
    borderRadius: 3,
    backgroundColor: '#E9D9AE',
  },
});
