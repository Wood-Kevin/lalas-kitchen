import React from 'react';
import { Image, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SkinConfig } from './skinConfig';
import { CLEARANCE_OBJECTIVE_SPRITE, SCORE_OBJECTIVE_SPRITE, SpriteAssetMap, resolveSpriteAsset } from './spriteAsset';
import { getSpriteForMatchType } from './spriteMap';
import { GinghamTrim } from './GinghamTrim';
import { LivesBadge } from './LivesBadge';
import { Fonts } from './fonts';
import { LevelSummary, buildRecipeBookSubtitle } from './levelProgress';

export interface HomeProps {
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  // The real account-level lives count (App.tsx's own `lives` state, the
  // same reactive value Hud.tsx and OutOfLives.tsx already read) — shown
  // here as a calm corner badge, never a new value tracked by Home itself.
  lives: number;
  // The real next-unplayed level (see App.tsx's use of
  // resolveNextUnplayedLevel + buildLevelSummary) — never the mockup's
  // illustrative "Level 12, Wooden Spoon" placeholder values.
  nextLevel: LevelSummary;
  // Feeds the "Your recipe book" card's subtitle (see
  // components/levelProgress.ts's buildRecipeBookSubtitle) — a plain count
  // against the fixed curated set, not the old open-ended "levels
  // completed" flavor text this card used to show.
  unlockedRecipeCardCount: number;
  totalRecipeCardCount: number;
  onStartNext: () => void;
  onBrowseAllLevels: () => void;
  // The recipe book card's own tap target — opens the RecipeBook collection
  // screen (see App.tsx's handleOpenRecipeBook).
  onOpenRecipeBook: () => void;
  // Sound/haptics toggle row state — App.tsx's soundEnabled/hapticsEnabled,
  // both off by default (see CLAUDE.md's Design Constraints). Placed
  // directly on Home, not a nested settings screen, per the build spec's
  // explicit "not buried in a settings menu" instruction.
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  onToggleSound: (next: boolean) => void;
  onToggleHaptics: (next: boolean) => void;
  // Dev-only, and provided ONLY in development (App.tsx gates it behind
  // __DEV__). When present, a long-press on the footer line triggers a full
  // save wipe + fresh restart. Undefined in every release build, so the footer
  // is just static text a real player sees — the affordance simply doesn't
  // exist for them. Deliberately hidden (no visible button, no hint) because
  // this is a testing convenience, not a feature.
  onDevReset?: () => void;
}

const HERO_HEIGHT = 260;

// The new landing screen (see App.tsx's resolveStartScreen) — replaces the
// old "always resume straight into gameplay" boot behavior with a
// deliberate-tap-to-play flow. Nothing like this existed before this
// session; components/LevelMap.tsx (formerly Dashboard.tsx, then a plain
// scrollable AllLevels.tsx list, now the winding level map) is the only
// screen that previously stood in for a level-select hub.
export function Home({
  config,
  spriteAssets,
  lives,
  nextLevel,
  unlockedRecipeCardCount,
  totalRecipeCardCount,
  onStartNext,
  onBrowseAllLevels,
  onOpenRecipeBook,
  soundEnabled,
  hapticsEnabled,
  onToggleSound,
  onToggleHaptics,
  onDevReset,
}: HomeProps) {
  const recipeBookSubtitle = buildRecipeBookSubtitle(unlockedRecipeCardCount, totalRecipeCardCount);

  const heroSprite = resolveSpriteAsset('home-hero-500h-crop.webp', spriteAssets);
  const nextIconSprite =
    nextLevel.objectiveType === 'score'
      ? SCORE_OBJECTIVE_SPRITE
      : nextLevel.objectiveType === 'clearance'
        ? CLEARANCE_OBJECTIVE_SPRITE
        : resolveSpriteAsset(getSpriteForMatchType(nextLevel.targetMatchType, config), spriteAssets);

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
        {/* The mockup's actual CSS gradient fade from the hero image into the
            screen background — `linear-gradient(to bottom, rgba(bg,0) 55%,
            rgba(bg,0.85) 85%, bg 100%)` — reproduced with a real gradient
            over the full hero height (the stops are relative to the whole
            hero in the mockup, not just its bottom slice). D9/FF are the
            hex-alpha equivalents of 0.85/1.0, the same `${color}${alphaHex}`
            convention already used elsewhere in this codebase (e.g.
            LevelMap.tsx's glow halo). */}
        <LinearGradient
          pointerEvents="none"
          style={styles.heroFade}
          colors={[
            `${config.palette.background[0]}00`,
            `${config.palette.background[0]}00`,
            `${config.palette.background[0]}D9`,
            `${config.palette.background[0]}FF`,
          ]}
          locations={[0, 0.55, 0.85, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
        <View style={styles.heroTextBlock}>
          <Text style={[styles.title, { color: config.palette.accent }]}>Lala&apos;s Kitchen</Text>
          <Text style={[styles.welcome, { color: config.palette.mutedText }]}>
            &quot;Welcome back, dear. The pot&apos;s already warming.&quot;
          </Text>
        </View>
        {/* Corner badge, not a new row — keeps the hero's own title/welcome
            text as the visual focus (see LivesBadge.tsx's own comment on
            why this isn't the full bordered/labeled Hud.tsx Panel). */}
        <View style={styles.livesBadgeSlot}>
          <LivesBadge config={config} spriteAssets={spriteAssets} lives={lives} />
        </View>
      </View>

      <Pressable
        style={[
          styles.card,
          { backgroundColor: config.palette.panel, borderColor: config.palette.border, marginTop: 14 },
        ]}
        onPress={onOpenRecipeBook}
      >
        <View style={styles.cardPadding}>
          <Text style={[styles.cardTitle, { color: config.palette.text }]}>Your recipe book</Text>
          <Text style={[styles.progressLine, { color: config.palette.mutedText }]}>{recipeBookSubtitle}</Text>
        </View>
      </Pressable>

      <View style={[styles.card, { backgroundColor: config.palette.panel, borderColor: config.palette.border }]}>
        <View style={styles.cardPadding}>
          <View style={styles.toggleRow}>
            <Text style={[styles.cardTitle, { color: config.palette.text }]}>Sound</Text>
            <Switch
              value={soundEnabled}
              onValueChange={onToggleSound}
              trackColor={{ false: config.palette.border, true: config.palette.accent }}
            />
          </View>
          <View style={styles.toggleRow}>
            <Text style={[styles.cardTitle, { color: config.palette.text }]}>Haptics</Text>
            <Switch
              value={hapticsEnabled}
              onValueChange={onToggleHaptics}
              trackColor={{ false: config.palette.border, true: config.palette.accent }}
            />
          </View>
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

      {/* The footer doubles as the hidden dev-reset target in development: a
          long-press (never a plain tap) triggers onDevReset. It looks and
          behaves as ordinary static text otherwise — onDevReset is undefined in
          release builds, so onLongPress is a no-op and there is nothing for a
          player to trigger. A long-press with no visible affordance is chosen
          precisely so it can't be stumbled into. */}
      <Pressable
        onLongPress={onDevReset}
        delayLongPress={800}
        disabled={!onDevReset}
        // Keep the text's normal layout/appearance — no press feedback, so the
        // footer never hints that it's interactive.
        style={styles.footerPressable}
      >
        <Text style={[styles.footer, { color: config.palette.mutedText }]}>No timers. No rush. The kitchen keeps.</Text>
      </Pressable>
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroTextBlock: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 14,
  },
  livesBadgeSlot: {
    position: 'absolute',
    top: 14,
    right: 16,
  },
  title: {
    fontFamily: Fonts.headingBold,
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 38,
  },
  welcome: {
    fontFamily: Fonts.bodyRegular,
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
    fontFamily: Fonts.headingBold,
    fontSize: 19,
    fontWeight: '700',
  },
  progressLine: {
    fontFamily: Fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    // The mockup's "UP NEXT · LEVEL N" eyebrow is plain body text (no
    // font-family override in the design reference), not a heading, despite
    // sitting next to the Baloo 2 level name below it.
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  nextName: {
    fontFamily: Fonts.headingBold,
    fontSize: 21,
    fontWeight: '700',
  },
  startButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startButtonLabel: {
    fontFamily: Fonts.headingBold,
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
    // Explicitly Nunito Sans in the mockup, unlike the other buttons on this
    // screen — it's the one secondary, non-hero action.
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    fontWeight: '700',
  },
  footer: {
    fontFamily: Fonts.bodyRegular,
    textAlign: 'center',
    fontSize: 12,
    marginBottom: 16,
  },
  // Wrapper for the footer's hidden dev-reset long-press — full width so the
  // centered text keeps its position; no press styling so it reads as plain
  // text (see the JSX comment at the footer).
  footerPressable: {
    alignSelf: 'stretch',
  },
});
