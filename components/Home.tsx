import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SkinConfig } from './skinConfig';
import { SpriteAssetMap, resolveSpriteAsset } from './spriteAsset';
import { getSpriteForMatchType } from './spriteMap';
import { GinghamTrim } from './GinghamTrim';
import { LevelSummary, buildProgressCopy } from './levelProgress';

export interface HomeProps {
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  completedLevels: number[];
  // The real next-unplayed level (see App.tsx's use of
  // resolveNextUnplayedLevel + buildLevelSummary) — never the mockup's
  // illustrative "Level 12, Wooden Spoon" placeholder values.
  nextLevel: LevelSummary;
  onStartNext: () => void;
  onBrowseAllLevels: () => void;
}

const HERO_HEIGHT = 260;

// The new landing screen (see App.tsx's resolveStartScreen) — replaces the
// old "always resume straight into gameplay" boot behavior with a
// deliberate-tap-to-play flow. Nothing like this existed before this
// session; components/AllLevels.tsx (formerly Dashboard.tsx) is the only
// screen that previously stood in for a level-select hub.
export function Home({
  config,
  spriteAssets,
  completedLevels,
  nextLevel,
  onStartNext,
  onBrowseAllLevels,
}: HomeProps) {
  const completedCount = completedLevels.length;
  const progressCopy = buildProgressCopy(completedCount);

  const heroSprite = resolveSpriteAsset('home-hero-500h-crop.webp', spriteAssets);
  const nextIconSprite = resolveSpriteAsset(
    getSpriteForMatchType(nextLevel.targetMatchType, config),
    spriteAssets
  );

  return (
    <View style={[styles.container, { backgroundColor: config.palette.background[0] }]}>
      <GinghamTrim accentColor={config.palette.accent} panelColor={config.palette.panel} height={16} />

      <View style={styles.hero}>
        {heroSprite.kind === 'image' ? (
          <Image source={heroSprite.source} style={styles.heroImage} resizeMode="cover" />
        ) : (
          <View style={[styles.heroImage, styles.heroLabelFallback, { backgroundColor: config.palette.panel }]}>
            <Text style={{ color: config.palette.mutedText }}>{heroSprite.label}</Text>
          </View>
        )}
        {/* Dependency-free stand-in for the mockup's CSS gradient fade from
            the hero image into the screen background — stacked bands of
            rising opacity instead of a real gradient (see GinghamTrim.tsx
            for the same tradeoff on the checkerboard trim). */}
        <View style={styles.heroFade} pointerEvents="none">
          {[0.15, 0.35, 0.6, 0.85, 1].map((opacity, i) => (
            <View
              key={i}
              style={[styles.heroFadeBand, { backgroundColor: config.palette.background[0], opacity }]}
            />
          ))}
        </View>
        <View style={styles.heroTextBlock}>
          <Text style={[styles.title, { color: config.palette.accent }]}>Lala&apos;s Kitchen</Text>
          <Text style={[styles.welcome, { color: config.palette.mutedText }]}>
            &quot;Welcome back, dear. The pot&apos;s already warming.&quot;
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: config.palette.panel, borderColor: config.palette.border, marginTop: 14 },
        ]}
      >
        <View style={styles.cardPadding}>
          <Text style={[styles.cardTitle, { color: config.palette.text }]}>Your recipe book</Text>
          <Text style={[styles.progressLine, { color: config.palette.mutedText }]}>{progressCopy}</Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: config.palette.panel, borderColor: config.palette.border }]}>
        <GinghamTrim accentColor={config.palette.accent} panelColor={config.palette.panel} height={10} />
        <View style={styles.cardPadding}>
          <View style={styles.nextRow}>
            <View style={[styles.nextIconBadge, { backgroundColor: config.palette.background[0], borderColor: config.palette.border }]}>
              {nextIconSprite.kind === 'image' ? (
                <Image source={nextIconSprite.source} style={styles.nextIconImage} resizeMode="contain" />
              ) : (
                <Text style={{ color: config.palette.text }}>{nextIconSprite.label}</Text>
              )}
            </View>
            <View style={styles.nextTextBlock}>
              <Text style={[styles.nextLabel, { color: config.palette.secondaryAccent }]}>
                Up next · Level {nextLevel.levelIndex}
              </Text>
              <Text style={[styles.nextName, { color: config.palette.text }]}>{nextLevel.displayName}</Text>
            </View>
          </View>
          <Pressable style={[styles.startButton, { backgroundColor: config.palette.accent }]} onPress={onStartNext}>
            <Text style={[styles.startButtonLabel, { color: config.palette.panel }]}>Start cooking</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={[styles.browseButton, { borderColor: config.palette.border }]}
        onPress={onBrowseAllLevels}
      >
        <Text style={[styles.browseButtonLabel, { color: config.palette.text }]}>Browse all levels</Text>
      </Pressable>

      <View style={{ flex: 1 }} />

      <Text style={[styles.footer, { color: config.palette.mutedText }]}>No timers. No rush. The kitchen keeps.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hero: {
    height: HERO_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  heroLabelFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_HEIGHT * 0.55,
    flexDirection: 'column',
  },
  heroFadeBand: {
    flex: 1,
  },
  heroTextBlock: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 14,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 38,
  },
  welcome: {
    marginTop: 4,
    fontSize: 14,
  },
  card: {
    marginHorizontal: 20,
    marginTop: 16,
    borderWidth: 1.5,
    borderRadius: 22,
    overflow: 'hidden',
  },
  cardPadding: {
    padding: 18,
    gap: 12,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '700',
  },
  progressLine: {
    fontSize: 14,
    lineHeight: 20,
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  nextIconBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextIconImage: {
    width: 34,
    height: 34,
  },
  nextTextBlock: {
    flex: 1,
    gap: 2,
  },
  nextLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  nextName: {
    fontSize: 21,
    fontWeight: '700',
  },
  startButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startButtonLabel: {
    fontSize: 17,
    fontWeight: '700',
  },
  browseButton: {
    marginHorizontal: 20,
    marginTop: 14,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
  },
  browseButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    marginBottom: 16,
  },
});
