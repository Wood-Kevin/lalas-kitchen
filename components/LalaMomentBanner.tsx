import React, { useEffect } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Text } from './AppText';
import { Fonts } from './fonts';
import { resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';
import { TOAST_BORDER_WIDTH, TOAST_SHADOW } from './toastChrome';

export interface LalaMomentBannerProps {
  copy: string;
  accentColor: string;
  panelColor: string;
  spriteAssets: SpriteAssetMap;
  onDone: () => void;
}

const FADE_IN_MS = 180;
const HOLD_MS = 900;
const FADE_OUT_MS = 320;

/** Sparse, non-blocking character copy. It never owns input or pauses play. */
export function LalaMomentBanner({ copy, accentColor, panelColor, spriteAssets, onDone }: LalaMomentBannerProps) {
  const opacity = useSharedValue(0);
  // This banner IS Lala speaking (see the copy bank this reads from,
  // release-character-pack.md) — the one toast where a portrait is a
  // genuine content tie-in, not decoration repeated across every popup.
  // ScorePopup/ComboStreakBanner stay text-only; they're generic reward
  // feedback, not her voice.
  const mascotSprite = resolveSpriteAsset('mascot.webp', spriteAssets);

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
        {mascotSprite.kind === 'image' && (
          <Image source={mascotSprite.source} style={styles.avatar} resizeMode="cover" />
        )}
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
    // Live tiles now derive their own zIndex from row position (up to
    // rows*1000, or 100000 while dragged — see Tile.tsx) so a shuffled or
    // falling tile always stacks correctly against its neighbours. This
    // banner predates that change and was left on a flat single-digit
    // value, which any tile past row 0 now paints over — a real playtest
    // report ("shuffle message is hidden behind tiles"). Comfortably above
    // the highest tile zIndex can ever reach, so this always wins.
    zIndex: 1000000,
  },
  pill: {
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: TOAST_BORDER_WIDTH,
    ...TOAST_SHADOW,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  text: {
    flexShrink: 1,
    fontFamily: Fonts.bodyRegular,
    fontSize: 13,
    textAlign: 'center',
  },
});

