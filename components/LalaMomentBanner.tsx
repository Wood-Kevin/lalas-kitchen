import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Text } from './AppText';
import { Fonts } from './fonts';

export interface LalaMomentBannerProps {
  copy: string;
  accentColor: string;
  panelColor: string;
  onDone: () => void;
}

const FADE_IN_MS = 180;
const HOLD_MS = 900;
const FADE_OUT_MS = 320;

/** Sparse, non-blocking character copy. It never owns input or pauses play. */
export function LalaMomentBanner({ copy, accentColor, panelColor, onDone }: LalaMomentBannerProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS }),
      withTiming(1, { duration: HOLD_MS }),
      withTiming(0, { duration: FADE_OUT_MS })
    );
    const timeout = setTimeout(onDone, FADE_IN_MS + HOLD_MS + FADE_OUT_MS);
    return () => clearTimeout(timeout);
    // Each banner is keyed by the move that created it, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View pointerEvents="none" testID="lala-moment-banner" style={[styles.container, animatedStyle]}>
      <Animated.View style={[styles.pill, { backgroundColor: panelColor, borderColor: accentColor }]}>
        <Text style={[styles.text, { color: accentColor }]}>{copy}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    alignItems: 'center',
    zIndex: 6,
  },
  pill: {
    maxWidth: '92%',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  text: {
    fontFamily: Fonts.bodyRegular,
    fontSize: 13,
    textAlign: 'center',
  },
});

