import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { LinearGradient } from 'expo-linear-gradient';
import { SkinConfig } from './skinConfig';
import {
  CLEARANCE_OBJECTIVE_SPRITE,
  ESCORT_OBJECTIVE_SPRITE,
  SCORE_OBJECTIVE_SPRITE,
  SpriteAssetMap,
  resolveSpriteAsset,
} from './spriteAsset';
import { getSpriteForMatchType } from './spriteMap';
import { GinghamTrim } from './GinghamTrim';
import { LivesBadge } from './LivesBadge';
import { Fonts } from './fonts';
import { LevelSummary, buildRecipeBookSubtitle } from './levelProgress';
import { SURFACE_BORDER_WIDTH, SURFACE_SHADOW } from './surfaceChrome';

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
  // The calm forward-looking session goal ("A new recipe waits N levels
  // ahead") — built by App.tsx from levelProgress.ts's buildNextRecipeHint
  // over appPersistence.ts's findNextRecipeCard, anchored on the real
  // next-unplayed level. Undefined once nothing lies ahead (past the last
  // curated milestone), in which case the card shows only its plain count.
  nextRecipeHint?: string;
  // The windowed fill fraction (0-1) toward nextRecipeHint's own card — see
  // levelProgress.ts's buildRecipeProgressFraction and SPEC.md's
  // recipe-progress-visibility thread. Undefined exactly when
  // nextRecipeHint is (nothing lies ahead), never a bare 0. Deliberately
  // windowed (since the player's last real unlock), not lifetime progress
  // over the full curated set — see that function's own comment for why a
  // lifetime bar would read as static instead of alive. This is a
  // different surface from unlockedRecipeCardCount/totalRecipeCardCount
  // above, which stay a plain, un-gamified count — see
  // buildRecipeBookSubtitle's own "not a competitive achievement system"
  // design brief, which this doesn't touch.
  nextRecipeProgressFraction?: number;
  // The target card's own sprite reference (RecipeCard.sprite), shown as
  // the fill bar's destination icon — reusing the real card art rather
  // than a generic icon, without naming the card in text (see
  // buildNextRecipeHint's own "never leak the surprise" comment, which
  // this respects the same way: the icon is the card's illustration, not
  // its title).
  nextRecipeSprite?: string;
  onStartNext: () => void;
  onBrowseAllLevels: () => void;
  // The recipe book card's own tap target — opens the RecipeBook collection
  // screen (see App.tsx's handleOpenRecipeBook).
  onOpenRecipeBook: () => void;
  // The settings card's own tap target — opens the dedicated Settings
  // screen (components/Settings.tsx), which now owns the Sound/Haptics
  // toggles that used to render inline here. The build spec's original
  // "not buried in a settings menu" note was about keeping mute quick to
  // reach, not about which screen it lives on — one tap from Home into
  // Settings, toggle immediately visible with no further navigation,
  // preserves that property (see Settings.tsx's own comment).
  onOpenSettings: () => void;
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
  nextRecipeHint,
  nextRecipeProgressFraction,
  nextRecipeSprite,
  onStartNext,
  onBrowseAllLevels,
  onOpenRecipeBook,
  onOpenSettings,
  onDevReset,
}: HomeProps) {
  const recipeBookSubtitle = buildRecipeBookSubtitle(unlockedRecipeCardCount, totalRecipeCardCount);
  const nextRecipeIcon = nextRecipeSprite ? resolveSpriteAsset(nextRecipeSprite, spriteAssets) : undefined;

  const heroSprite = resolveSpriteAsset('home-hero-500h-crop.webp', spriteAssets);
  // The welcome line below is literally Lala's own dialogue ("Welcome
  // back, dear...") — same reasoning as LalaMomentBanner's own avatar: a
  // real content tie-in, not decoration, to show her face next to her own
  // words. No fallback if the sprite is ever missing (same choice
  // LalaMomentBanner made) — the quote itself is always there regardless.
  const mascotSprite = resolveSpriteAsset('mascot.webp', spriteAssets);
  const nextIconSprite =
    nextLevel.objectiveType === 'score'
      ? SCORE_OBJECTIVE_SPRITE
      : nextLevel.objectiveType === 'clearance'
        ? CLEARANCE_OBJECTIVE_SPRITE
        : nextLevel.objectiveType === 'escort'
          ? ESCORT_OBJECTIVE_SPRITE
          : resolveSpriteAsset(getSpriteForMatchType(nextLevel.targetMatchType, config), spriteAssets);

  return (
    <View style={[styles.container, { backgroundColor: config.palette.background[0] }]}>
      <GinghamTrim accentColor={config.palette.accent} panelColor={config.palette.panel} height={16} />

      {/* Everything below the trim is scrollable — a fixed screen at a real
          iPhone's shortest tested height (an SE) already sits within a few
          points of this content's natural height, and a viewport shorter
          than that (an iPadOS compatibility/windowed-mode instance of this
          iPhone-only app, which can be resized well below any real iPhone's
          dimensions) would push "Start cooking" itself off-screen with no
          way to reach it — a real App Store rejection this fixed, non-
          scrolling layout caused (see CLAUDE.md's iOS-device-family entry).
          Matches the ScrollView convention LevelMap.tsx/RecipeBook.tsx
          already use for their own variable-length content.
          contentContainerStyle's flexGrow: 1 keeps the footer pinned to the
          bottom via the existing flex spacer below on any screen tall
          enough to fit everything without scrolling — unchanged from
          before — and only yields to real scrolling once content
          genuinely exceeds the viewport. */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
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
          <View style={styles.welcomeRow}>
            {mascotSprite.kind === 'image' && (
              // Same shadow-vs-overflow:hidden split as the cards above —
              // the shadow lives on an unclipped outer View, the border/
              // corner-clip on an inner one.
              <View style={styles.welcomeAvatarShadow}>
                <View style={[styles.welcomeAvatarFrame, { borderColor: config.palette.panel }]}>
                  <Image source={mascotSprite.source} style={styles.welcomeAvatarImage} resizeMode="cover" />
                </View>
              </View>
            )}
            <Text style={[styles.welcome, { color: config.palette.mutedText }]}>
              &quot;Welcome back, dear. The pot&apos;s already warming.&quot;
            </Text>
          </View>
        </View>
        {/* Corner badge, not a new row — keeps the hero's own title/welcome
            text as the visual focus (see LivesBadge.tsx's own comment on
            why this isn't the full bordered/labeled Hud.tsx Panel). */}
        <View style={styles.livesBadgeSlot}>
          <LivesBadge config={config} spriteAssets={spriteAssets} lives={lives} />
        </View>
      </View>

      {/* Every card below is now a shadow-carrying outer View wrapping a
          clipped inner surface — React Native drops a shadow entirely on a
          View that also sets overflow: 'hidden' (needed here so
          GinghamTrim's square top corners and the Pressable's own ripple
          stay inside the card's rounded corners), so the shadow has to live
          on an unclipped parent instead. See surfaceChrome.ts's own header
          comment for why this shadow now exists at all — a real DOM check
          found zero shadowed elements anywhere on this screen before this
          pass, the same flatness the board's toasts had before their own
          facelift. */}
      <View style={[styles.cardShadow, { marginTop: 14 }]}>
        <Pressable
          style={[styles.card, { backgroundColor: config.palette.panel, borderColor: config.palette.border }]}
          onPress={onOpenRecipeBook}
          accessibilityRole="button"
          accessibilityLabel="Your recipe book"
        >
          <View style={styles.cardPadding}>
            <Text style={[styles.cardTitle, { color: config.palette.text }]}>Your recipe book</Text>
            <Text style={[styles.progressLine, { color: config.palette.mutedText }]}>{recipeBookSubtitle}</Text>
            {nextRecipeHint !== undefined && (
              <>
                <Text style={[styles.progressLine, { color: config.palette.mutedText }]}>
                  {nextRecipeHint}
                </Text>
                {/* The windowed fill (SPEC.md's recipe-progress-visibility
                    thread) — resets to a fresh, visibly-moving start at every
                    unlock rather than crawling toward the full 52-card set,
                    so it stays worth glancing at again next session instead
                    of reading as permanently near-full. The target card's own
                    icon anchors what the fill is heading toward without
                    naming it (see nextRecipeSprite's own comment). */}
                <View style={styles.recipeProgressRow}>
                  <View
                    style={[styles.recipeProgressTrack, { backgroundColor: config.palette.background[0] }]}
                  >
                    <View
                      style={[
                        styles.recipeProgressFill,
                        {
                          backgroundColor: config.palette.accent,
                          width: `${Math.round((nextRecipeProgressFraction ?? 0) * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                  {nextRecipeIcon &&
                    (nextRecipeIcon.kind === 'image' ? (
                      <Image
                        source={nextRecipeIcon.source}
                        style={styles.recipeProgressIcon}
                        resizeMode="contain"
                      />
                    ) : (
                      <Text style={{ color: config.palette.text }}>{nextRecipeIcon.label}</Text>
                    ))}
                </View>
              </>
            )}
          </View>
        </Pressable>
      </View>

      <View style={styles.cardShadow}>
        <Pressable
          style={[styles.card, { backgroundColor: config.palette.panel, borderColor: config.palette.border }]}
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <View style={styles.cardPadding}>
            <Text style={[styles.cardTitle, { color: config.palette.text }]}>Settings</Text>
            <Text style={[styles.progressLine, { color: config.palette.mutedText }]}>Sound, haptics, and more</Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.cardShadow}>
        <View style={[styles.card, { backgroundColor: config.palette.panel, borderColor: config.palette.border }]}>
          <GinghamTrim accentColor={config.palette.accent} panelColor={config.palette.panel} height={10} />
          <View style={styles.cardPadding}>
            <View style={styles.nextRow}>
              <View
                style={[
                  styles.nextIconBadge,
                  { backgroundColor: config.palette.background[0], borderColor: config.palette.border },
                ]}
              >
                {nextIconSprite.kind === 'image' ? (
                  <Image source={nextIconSprite.source} style={styles.nextIconImage} resizeMode="contain" />
                ) : (
                  <Text style={{ color: config.palette.text }}>{nextIconSprite.label}</Text>
                )}
              </View>
              <View style={styles.nextTextBlock}>
                <Text style={[styles.nextLabel, { color: config.palette.secondaryAccentText }]}>
                  Up next · Level {nextLevel.levelIndex}
                </Text>
                <Text style={[styles.nextName, { color: config.palette.text }]}>{nextLevel.displayName}</Text>
              </View>
            </View>
            <Pressable
              style={[styles.startButton, { backgroundColor: config.palette.accent }]}
              onPress={onStartNext}
              accessibilityRole="button"
              accessibilityLabel="Start cooking"
            >
              <Text style={[styles.startButtonLabel, { color: config.palette.panel }]}>Start cooking</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <Pressable
        style={[styles.browseButton, { borderColor: config.palette.border }]}
        onPress={onBrowseAllLevels}
        accessibilityRole="button"
        accessibilityLabel="Browse all levels"
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  // flexGrow (not flex) is what makes the existing `<View style={{flex:1}}
  // />` spacer below the browse button still pin the footer to the bottom
  // on any screen tall enough to fit everything without scrolling — the
  // content container only grows past the viewport, and real scrolling
  // only kicks in, once its natural content height genuinely exceeds it.
  scrollContent: {
    flexGrow: 1,
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
  welcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  welcomeAvatarShadow: {
    borderRadius: 16,
    ...SURFACE_SHADOW,
  },
  welcomeAvatarFrame: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: SURFACE_BORDER_WIDTH,
    overflow: 'hidden',
  },
  welcomeAvatarImage: {
    width: '100%',
    height: '100%',
  },
  welcome: {
    flex: 1,
    fontFamily: Fonts.bodyRegular,
    fontSize: 14,
  },
  // The shadow-carrying outer wrapper — see the JSX comment at the first
  // card for why the shadow can't live directly on `card` itself.
  cardShadow: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 22,
    ...SURFACE_SHADOW,
  },
  card: {
    borderWidth: SURFACE_BORDER_WIDTH,
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
  recipeProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  recipeProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  recipeProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  recipeProgressIcon: {
    width: 20,
    height: 20,
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
    borderWidth: SURFACE_BORDER_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    ...SURFACE_SHADOW,
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
    // The one real CTA on this whole screen — gets the most lift of
    // anything here, a solid fill rather than a bordered pill so the
    // shadow alone carries the "press me" weight.
    ...SURFACE_SHADOW,
  },
  startButtonLabel: {
    fontFamily: Fonts.headingBold,
    fontSize: 17,
    fontWeight: '700',
  },
  // Deliberately still flat, no shadow — the one secondary/tertiary action
  // on this screen, kept quieter than the cards and the primary CTA above
  // so the new material lift reads as a real hierarchy, not just "everything
  // got a shadow."
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
