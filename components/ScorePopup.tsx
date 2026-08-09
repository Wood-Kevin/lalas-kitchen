import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Text } from './AppText';
import { Fonts } from './fonts';
import { SURFACE_BORDER_WIDTH, SURFACE_SHADOW } from './surfaceChrome';

export type ScorePopupTone = 'ordinary' | 'cascade' | 'special';

export interface ScorePopupProps {
  amount: number;
  tone: ScorePopupTone;
  accentColor: string;
  panelColor: string;
  onDone: () => void;
}

const FADE_IN_MS = 120;
const HOLD_MS = 380;
const FADE_OUT_MS = 300;

/** A small, non-blocking reward beat for every scoring move. */
export function ScorePopup({ amount, tone, accentColor, panelColor, onDone }: ScorePopupProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(8);
  const scale = useSharedValue(0.94);

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS }),
      withTiming(1, { duration: HOLD_MS }),
      withTiming(0, { duration: FADE_OUT_MS })
    );
    translateY.value = withTiming(-4, { duration: FADE_IN_MS + HOLD_MS + FADE_OUT_MS });
    scale.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS }),
      withTiming(1, { duration: HOLD_MS }),
      withTiming(0.98, { duration: FADE_OUT_MS })
    );
    const timeout = setTimeout(onDone, FADE_IN_MS + HOLD_MS + FADE_OUT_MS);
    return () => clearTimeout(timeout);
    // Each popup is keyed by the move that created it, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
  const label = tone === 'special' ? 'Great!' : tone === 'cascade' ? 'Chain!' : 'Nice!';

  return (
    <Animated.View
      pointerEvents="none"
      testID="score-popup"
      style={[styles.container, animatedStyle]}
    >
      <Animated.View style={[styles.pill, { backgroundColor: panelColor, borderColor: accentColor }]}>
        <Text style={[styles.label, { color: accentColor }]}>{label}</Text>
        <Text style={[styles.amount, { color: accentColor }]}>+{amount.toLocaleString()}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 42,
    left: 0,
    right: 0,
    alignItems: 'center',
    // Same fix as LalaMomentBanner.tsx's own zIndex comment — this popup
    // also predates Tile.tsx's row-derived zIndex (up to rows*1000, or
    // 100000 while dragged) and was left on a flat single-digit value that
    // any tile past row 0 now stacks over.
    zIndex: 1000000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: SURFACE_BORDER_WIDTH,
    ...SURFACE_SHADOW,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
  },
  amount: {
    fontFamily: Fonts.headingBold,
    fontSize: 17,
  },
});

