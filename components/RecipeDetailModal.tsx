import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { Fonts } from './fonts';
import { RecipeCard, SkinConfig } from './skinConfig';
import { ResolvedSprite, resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';

// Reuses the exact image/text-label fallback contract every other sprite
// consumer in this app already uses — see RecipeCardReveal.tsx's matching
// CardIllustration.
function CardIllustration({ sprite, labelColor }: { sprite: ResolvedSprite; labelColor: string }) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={styles.illustrationImage} resizeMode="contain" />;
  }
  return <Text style={[styles.illustrationLabel, { color: labelColor }]}>{sprite.label}</Text>;
}

export interface RecipeDetailModalProps {
  card: RecipeCard;
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  onDismiss: () => void;
}

// The detail view a tap on an unlocked RecipeBook.tsx card opens — the
// real recipe (ingredients + steps) behind each card's flavor text, not
// just the collectible reveal RecipeCardReveal.tsx already shows once at
// unlock time. Same backdrop/card shape SpecialTutorialOverlay.tsx uses
// (a dismissible full-screen card, not RecipeCardReveal's non-dismissible
// in-flow reveal), since this is reached by a deliberate tap, not a
// one-time automatic moment. `card.recipe` is optional — a card can exist
// (real art, a real milestone) before its recipe content is written, so a
// missing recipe falls back to a plain, honest "not written down yet"
// line rather than an empty ingredients/steps section or a crash.
export function RecipeDetailModal({ card, config, spriteAssets, onDismiss }: RecipeDetailModalProps) {
  const sprite = resolveSpriteAsset(card.sprite, spriteAssets);
  const { accent, mutedText, text, panel, border } = config.palette;

  return (
    <View style={styles.backdrop}>
      <View style={[styles.card, { backgroundColor: panel, borderColor: border }]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.iconWrap, { backgroundColor: ICON_WASH }]}>
            <CardIllustration sprite={sprite} labelColor={accent} />
          </View>

          <Text style={[styles.title, { color: text }]}>{card.title}</Text>
          <Text style={[styles.flavorText, { color: mutedText }]}>{card.flavorText}</Text>

          {card.recipe ? (
            <>
              <View style={[styles.divider, { backgroundColor: border }]} />

              <Text style={[styles.sectionLabel, { color: accent }]}>Ingredients</Text>
              {card.recipe.ingredients.map((item, i) => (
                <Text key={i} style={[styles.listItem, { color: text }]}>
                  {'• '}
                  {item}
                </Text>
              ))}

              <Text style={[styles.sectionLabel, { color: accent }]}>Steps</Text>
              {card.recipe.steps.map((step, i) => (
                <Text key={i} style={[styles.listItem, { color: text }]}>
                  {i + 1}. {step}
                </Text>
              ))}
            </>
          ) : (
            <Text style={[styles.comingSoon, { color: mutedText }]}>
              The recipe for this one hasn't been written down yet.
            </Text>
          )}
        </ScrollView>

        <Pressable
          style={[styles.primaryButton, { backgroundColor: accent }]}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close recipe"
        >
          <Text style={styles.primaryButtonLabel}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Matches SpecialTutorialOverlay.tsx's icon wash exactly — same overlay
// family, same treatment.
const ICON_WASH = 'rgba(217, 199, 158, 0.45)';

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Warm brown wash, not black — see WonOverlay.tsx/SpecialTutorialOverlay.tsx's matching scrim.
    backgroundColor: 'rgba(59, 38, 26, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: 340,
    maxWidth: '92%',
    maxHeight: '80%',
    borderWidth: 2,
    borderRadius: 26,
    paddingTop: 22,
    paddingBottom: 16,
    paddingHorizontal: 22,
    alignItems: 'stretch',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustrationImage: {
    width: '78%',
    height: '78%',
  },
  illustrationLabel: {
    fontSize: 26,
    fontWeight: '700',
  },
  title: {
    fontFamily: Fonts.headingBold,
    marginTop: 14,
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },
  flavorText: {
    fontFamily: Fonts.bodyRegular,
    marginTop: 4,
    fontSize: 12.5,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  divider: {
    width: '100%',
    height: 1,
    marginTop: 16,
    marginBottom: 4,
  },
  sectionLabel: {
    fontFamily: Fonts.headingBold,
    alignSelf: 'flex-start',
    marginTop: 14,
    fontSize: 14,
    fontWeight: '700',
  },
  listItem: {
    fontFamily: Fonts.bodyRegular,
    alignSelf: 'flex-start',
    marginTop: 6,
    fontSize: 13.5,
    lineHeight: 19,
  },
  comingSoon: {
    fontFamily: Fonts.bodyRegular,
    marginTop: 18,
    fontSize: 13,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButtonLabel: {
    fontFamily: Fonts.headingBold,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
