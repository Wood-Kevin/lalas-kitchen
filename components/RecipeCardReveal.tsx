import React, { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { RecipeCard, SkinConfig } from './skinConfig';
import { ResolvedSprite, resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';

export interface RecipeCardRevealProps {
  card: RecipeCard;
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
}

// Reuses the exact image/text-label fallback contract every other sprite
// consumer in this app already uses (Tile.tsx, WonOverlay.tsx) — no real
// recipe-card art exists yet (see skins/lalas-kitchen/config.json's
// recipeCards sprite fields), so every card renders through this same
// path today. Dropping in real art later is purely a
// skins/lalas-kitchen/spriteRegistry.ts addition, zero code changes here.
function CardIllustration({ sprite, labelColor }: { sprite: ResolvedSprite; labelColor: string }) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={styles.illustrationImage} resizeMode="contain" />;
  }
  return <Text style={[styles.illustrationLabel, { color: labelColor }]}>{sprite.label}</Text>;
}

// The reveal moment for a newly unlocked recipe card — the recipe-box
// feature this session brings into V1 scope (see CLAUDE.md's Explicitly
// Out of Scope list). Rendered inside WonOverlay only when the level just
// won is one of skinConfig.recipeCards's milestoneLevel entries and the
// card wasn't already unlocked (see appPersistence.ts's
// findRecipeCardForLevel / App.tsx's handleBoardStateChange).
//
// Deliberately just a slight tilt, a soft glow behind the card, and one
// gentle fade/scale-in on mount — no confetti, no burst, no particle
// animation, no card-flip motion — per CLAUDE.md's calm-not-frantic
// constraint and this feature's own approved design brief ("the only
// celebration cue"). WonOverlay's existing Sparkle/steam accents on its own
// default win illustration are untouched; this is a distinct, calmer
// treatment shown instead of that illustration, not layered on top of it.
export function RecipeCardReveal({ card, config, spriteAssets }: RecipeCardRevealProps) {
  const sprite = resolveSpriteAsset(card.sprite, spriteAssets);
  const { panel, border, text, mutedText } = config.palette;

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: 450 });
    // Runs once on mount — a fresh reveal always gets a fresh instance
    // (WonOverlay only renders this when a genuinely new card unlocked),
    // so there's nothing else that should retrigger the entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Both the fixed tilt and the mount-in scale live in this one animated
  // transform array — RN/Reanimated don't merge `transform` across style
  // objects in a style array, the last one present wins wholesale, so the
  // static tilt would silently vanish if it stayed on styles.card while
  // this animated style also set its own transform.
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ rotate: '-4deg' }, { scale: 0.92 + progress.value * 0.08 }],
  }));

  return (
    <View style={styles.container}>
      <View style={styles.glow} pointerEvents="none" />
      <Animated.View style={[styles.card, { backgroundColor: panel, borderColor: border }, animatedStyle]}>
        <View style={styles.illustration}>
          <CardIllustration sprite={sprite} labelColor={text} />
        </View>
        <Text style={[styles.title, { color: text }]}>{card.title}</Text>
        <Text style={[styles.flavorText, { color: mutedText }]}>{card.flavorText}</Text>
      </Animated.View>
    </View>
  );
}

// A soft, low-alpha egg-yolk-yellow wash — not a config palette color,
// since nothing else in the shared palette is warm/bright enough to read
// as a gentle glow at this alpha (the same reasoning WonOverlay.tsx's own
// YOLK/FLAME sparkle constants already document for its own decorative
// accents).
const GLOW_COLOR = 'rgba(227, 164, 59, 0.35)';

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  glow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: GLOW_COLOR,
  },
  card: {
    width: 178,
    borderWidth: 2,
    borderRadius: 18,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    // The tilt itself lives in animatedStyle's transform array below, not
    // here — see that comment for why a static transform here would be
    // clobbered rather than merged.
  },
  illustration: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustrationImage: {
    width: '100%',
    height: '100%',
  },
  illustrationLabel: {
    fontSize: 32,
    fontWeight: '700',
  },
  title: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  flavorText: {
    marginTop: 4,
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
