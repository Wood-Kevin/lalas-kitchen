import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SkinConfig } from './skinConfig';
import { getSpriteForMatchType } from './spriteMap';
import { resolveSpriteAsset, ResolvedSprite, SpriteAssetMap } from './spriteAsset';

export interface BlockerTutorialOverlayProps {
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  // The specific blocker matchType found on this level's board (see
  // appPersistence.ts's findBlockerMatchType) — resolved through the exact
  // same getSpriteForMatchType lookup Board.tsx uses for every tile, so
  // this always shows the real in-play sprite, never a hardcoded "cling"
  // reference.
  blockerMatchType: string | undefined;
  onDismiss: () => void;
}

// A soft low-alpha tint of config.palette.border (#D9C79E) behind the
// icon — a translucent backgroundColor rather than the RN `opacity` prop,
// so the tint dims only the circle, not the sprite drawn on top of it.
const ICON_WASH = 'rgba(217, 199, 158, 0.45)';

function SpriteIcon({ sprite, size, labelColor }: { sprite: ResolvedSprite; size: number; labelColor: string }) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={{ width: size, height: size }} resizeMode="contain" />;
  }
  return <Text style={[styles.spriteLabel, { fontSize: size * 0.4, color: labelColor }]}>{sprite.label}</Text>;
}

// Mirrors WonOverlay.tsx/PausedOverlay.tsx/OutOfLives.tsx's card/backdrop
// shape exactly — the fourth sibling in that same family, shown once ever
// (see appPersistence.ts's shouldShowBlockerTutorial) the first time a
// level's board actually contains a blocker, before the board accepts any
// taps (Board.tsx gates handleTilePress on this exact same condition).
// Deliberately a single dismiss action, not a primary/secondary pair —
// this is an explanation, not a decision with real alternatives.
export function BlockerTutorialOverlay({ config, spriteAssets, blockerMatchType, onDismiss }: BlockerTutorialOverlayProps) {
  const sprite = resolveSpriteAsset(getSpriteForMatchType(blockerMatchType, config), spriteAssets);
  const { accent, mutedText, text, panel, border } = config.palette;

  return (
    <View style={styles.backdrop}>
      <View style={[styles.card, { backgroundColor: panel, borderColor: border }]}>
        <View style={[styles.iconWrap, { backgroundColor: ICON_WASH }]}>
          <SpriteIcon sprite={sprite} size={48} labelColor={accent} />
        </View>

        <Text style={[styles.headline, { color: text }]}>A Covered Dish</Text>
        <Text style={[styles.subtext, { color: mutedText }]}>
          Match ingredients next to a covered dish to help clear it away.
        </Text>

        <Pressable style={[styles.primaryButton, { backgroundColor: accent }]} onPress={onDismiss}>
          <Text style={styles.primaryButtonLabel}>Got it</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Warm brown wash, not black — see WonOverlay.tsx's matching scrim.
    backgroundColor: 'rgba(59, 38, 26, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 320,
    maxWidth: '88%',
    borderWidth: 2,
    borderRadius: 26,
    paddingTop: 24,
    paddingBottom: 22,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spriteLabel: {
    fontWeight: '700',
  },
  headline: {
    marginTop: 16,
    fontSize: 21,
    fontWeight: '800',
  },
  subtext: {
    marginTop: 6,
    fontSize: 13.5,
    fontWeight: '500',
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    marginTop: 18,
    paddingVertical: 13,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButtonLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
