import React, { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Objective } from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { getSpriteForMatchType } from './spriteMap';
import { ResolvedSprite, resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';
import { SteamWisp } from './SteamWisp';

export interface WonOverlayProps {
  objectives: Objective[];
  // Display-only "LEVEL N" label — see Board.tsx's levelIndex prop comment.
  levelIndex: number;
  config: SkinConfig;
  // Same sprite registry Board already threads to every Tile, reused here
  // so the plated-dish illustration and the objective chip both show the
  // real ingredient art instead of a hand-drawn stand-in for "food".
  spriteAssets: SpriteAssetMap;
  // Replays this same level with a new seed — see Board.tsx's
  // handlePlayAgain, unchanged by the level-queue work below.
  onPlayAgain: () => void;
  // Advances to the next level — hand-built while the queue lasts, then
  // generator-driven indefinitely (see appPersistence.ts's
  // buildGeneratedLevelConfig), so this always has somewhere to go and the
  // label is always "Next Recipe".
  onNext: () => void;
  // Routes to the level-select dashboard instead of continuing — kept as a
  // small tertiary link (not a same-weight button) so it reads as a quiet
  // detour, not a third competing action — see PausedOverlay.tsx's
  // matching "Exit to Kitchen" link for the sibling treatment.
  onOpenDashboard: () => void;
}

// Fixed brand accents from the design brief, not skin-configurable data —
// SkinPalette only carries the identity colors reused across the whole
// app (panel/border/accent/secondaryAccent/text). These two are decorative
// sparkle colors used nowhere else, so they live here rather than growing
// the shared palette schema for a two-file visual pass.
const YOLK = '#E3A43B';
const FLAME = '#F2793A';
// A soft low-alpha tint of config.palette.secondaryAccent (#7C8F6E), used
// only for the objective chip's fill — not itself config data.
const SAGE_WASH = 'rgba(124, 143, 110, 0.14)';

// Reuses Tile.tsx's exact image/text-label fallback contract
// (resolveSpriteAsset's ResolvedSprite) so a skin with no bundled art yet
// still renders something instead of a broken image.
function SpriteIcon({ sprite, size, labelColor }: { sprite: ResolvedSprite; size: number; labelColor: string }) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={{ width: size, height: size }} resizeMode="contain" />;
  }
  return <Text style={[styles.spriteLabel, { fontSize: size * 0.5, color: labelColor }]}>{sprite.label}</Text>;
}

// A small twinkling accent — scale/opacity pulse only, no motion trail, so
// it reads as a quiet sparkle rather than a firework.
function Sparkle({ style, color, delayMs }: { style: object; color: string; delayMs: number }) {
  const pulse = useSharedValue(0.3);

  useEffect(() => {
    pulse.value = withDelay(
      delayMs,
      withRepeat(withSequence(withTiming(1, { duration: 1100 }), withTiming(0.3, { duration: 1100 })), -1, false)
    );
  }, [delayMs, pulse]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ scale: 0.7 + pulse.value * 0.4 }],
  }));

  return <Animated.View style={[styles.sparkle, style, { backgroundColor: color }, animatedStyle]} />;
}

// Mirrors PausedOverlay.tsx's card/backdrop shape and the same
// one-primary-plus-two-quiet-secondary-links structure — same warm cream
// card, same border, differentiated by color balance (yolk/flame sparkle
// here vs. sage/flame calm here) rather than layout, so the two overlays
// read as siblings but are never mistakable for each other. Matches
// skins/lalas-kitchen/design-reference (see this session's mockup).
export function WonOverlay({
  objectives,
  levelIndex,
  config,
  spriteAssets,
  onPlayAgain,
  onNext,
  onOpenDashboard,
}: WonOverlayProps) {
  // The plated-dish illustration only has room for one icon — it stays
  // pinned to the first objective regardless of how many there are, the
  // same way the illustration itself never changes shape per level. The
  // chip row below is what actually shows every objective's final count.
  const sprite = resolveSpriteAsset(getSpriteForMatchType(objectives[0].targetMatchType, config), spriteAssets);
  const { accent, secondaryAccent, mutedText, text, panel, border } = config.palette;

  return (
    <View style={styles.backdrop}>
      <View style={[styles.card, { backgroundColor: panel, borderColor: border }]}>
        <View style={styles.illustration}>
          <SteamWisp left="38%" delayMs={0} />
          <SteamWisp left="50%" delayMs={500} />
          <SteamWisp left="62%" delayMs={1000} />
          <Sparkle style={{ left: '16%', top: '14%' }} color={YOLK} delayMs={0} />
          <Sparkle style={{ right: '14%', top: '20%' }} color={FLAME} delayMs={550} />

          <View style={[styles.plateRim, { backgroundColor: border }]} />
          <View style={[styles.plateFace, { backgroundColor: panel, borderColor: border }]}>
            <SpriteIcon sprite={sprite} size={44} labelColor={accent} />
          </View>
        </View>

        <Text style={[styles.levelLabel, { color: accent }]}>LEVEL {levelIndex}</Text>
        <Text style={[styles.headline, { color: text }]}>Order&apos;s Up!</Text>
        <Text style={[styles.subtext, { color: mutedText }]}>Plated with moves to spare — nicely done.</Text>

        <View style={styles.chipRow}>
          {objectives.map((objective) => {
            const chipSprite = resolveSpriteAsset(
              getSpriteForMatchType(objective.targetMatchType, config),
              spriteAssets
            );
            return (
              <View
                key={objective.targetMatchType}
                style={[styles.chip, { backgroundColor: SAGE_WASH, borderColor: secondaryAccent }]}
              >
                <SpriteIcon sprite={chipSprite} size={22} labelColor={secondaryAccent} />
                <View>
                  {/* Reads each objective's real counts directly, so an
                      overshoot cascade (currentCount > targetCount) always
                      shows the true numbers rather than clamping to the
                      target — unchanged per-objective, just now repeated
                      once per entry instead of assumed singular. */}
                  <Text style={[styles.chipAmount, { color: text }]}>
                    {objective.currentCount} / {objective.targetCount}
                  </Text>
                  <Text style={[styles.chipLabel, { color: secondaryAccent }]}>COLLECTED</Text>
                </View>
              </View>
            );
          })}
        </View>

        <Pressable style={[styles.primaryButton, { backgroundColor: accent }]} onPress={onNext}>
          <Text style={styles.primaryButtonLabel}>Next Recipe</Text>
        </Pressable>
        <Pressable style={styles.secondaryLink} onPress={onPlayAgain}>
          <Text style={[styles.secondaryLinkLabel, { color: text }]}>Play Again</Text>
        </Pressable>
        <Pressable style={styles.tertiaryLink} onPress={onOpenDashboard}>
          <Text style={[styles.tertiaryLinkLabel, { color: mutedText }]}>Back to Levels</Text>
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
    // Warm brown wash, not black — see PausedOverlay.tsx's matching scrim.
    backgroundColor: 'rgba(59, 38, 26, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 320,
    maxWidth: '88%',
    borderWidth: 2,
    borderRadius: 26,
    paddingTop: 8,
    paddingBottom: 22,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  illustration: {
    width: '100%',
    height: 116,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  sparkle: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 3,
    transform: [{ rotate: '45deg' }],
  },
  plateRim: {
    width: 116,
    height: 26,
    borderRadius: 13,
    marginTop: -10,
  },
  plateFace: {
    position: 'absolute',
    bottom: 10,
    width: 92,
    height: 68,
    borderRadius: 46,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spriteLabel: {
    fontWeight: '700',
  },
  levelLabel: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  headline: {
    marginTop: 4,
    fontSize: 22,
    fontWeight: '800',
  },
  subtext: {
    marginTop: 6,
    fontSize: 13.5,
    fontWeight: '500',
    textAlign: 'center',
  },
  chipRow: {
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  chipAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  chipLabel: {
    marginTop: 1,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
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
  secondaryLink: {
    marginTop: 10,
    paddingVertical: 4,
  },
  secondaryLinkLabel: {
    fontWeight: '600',
    fontSize: 14,
    opacity: 0.85,
  },
  tertiaryLink: {
    marginTop: 6,
    paddingVertical: 4,
  },
  tertiaryLinkLabel: {
    fontWeight: '600',
    fontSize: 12,
    opacity: 0.7,
  },
});
