import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { Fonts } from './fonts';
import { RecipeCard, SkinConfig } from './skinConfig';
import { ResolvedSprite, resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';
import { GinghamTrim } from './GinghamTrim';
import { buildRecipeBookSubtitle } from './levelProgress';
import { RecipeDetailModal } from './RecipeDetailModal';

export interface RecipeBookProps {
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  // Which of config.recipeCards's ids have been unlocked so far (App.tsx's
  // unlockedRecipeCards, loaded from SaveData) — the only thing that
  // decides filled vs. empty per card. config.recipeCards itself is the
  // skin's curated recipe set; this list is what grows over time.
  unlockedCardIds: string[];
  onBack: () => void;
}

// Reuses the exact image/text-label fallback contract every other sprite
// consumer in this app already uses — see RecipeCardReveal.tsx's matching
// CardIllustration for why no real recipe-card art existing yet is a
// non-event here.
function CardIllustration({ sprite, labelColor }: { sprite: ResolvedSprite; labelColor: string }) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={styles.illustrationImage} resizeMode="contain" />;
  }
  return <Text style={[styles.illustrationLabel, { color: labelColor }]}>{sprite.label}</Text>;
}

const GRID_COLUMNS = 3;

// Splits the curated recipe-card list into rows of 3 — each row is its own flex
// container with `flex: 1` cells (see styles.cell), which is what makes the
// gap math work out exactly to 100% width with no overflow. A single
// flexWrap container with percentage-width cells was tried first and
// rejected: cell width (33.33%) plus the same row's `gap` between cells
// sums to *more* than 100%, which silently wraps the third column onto its
// own line instead of overflowing visibly — an easy bug to miss without
// actually measuring the rendered layout.
function chunkIntoRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}

// The collection view — a simple 3-column grid over skinConfig.recipeCards,
// never a scrolling/paginated list per row, since the set itself is fixed and
// still intentionally small (see
// appPersistence.ts's findRecipeCardForLevel). Filled cells show the real
// card; unfilled cells are a plain dashed outline with nothing inside — no
// lock glyph (unlike LevelMap.tsx's locked-level nodes), no number, no
// star, no "X%" — this is deliberately calmer than that screen's treatment,
// per this feature's "not a gamified badge system" design brief.
export function RecipeBook({ config, spriteAssets, unlockedCardIds, onBack }: RecipeBookProps) {
  const subtitle = buildRecipeBookSubtitle(unlockedCardIds.length, config.recipeCards.length);
  const { accent, panel, border, text, mutedText, background } = config.palette;

  // Which unlocked card's recipe is currently open, if any — a plain id
  // lookup against config.recipeCards rather than storing the card object
  // itself, the same shape Board.tsx's own selected-tile state already
  // uses. Only ever set by tapping an UNLOCKED cell (see RecipeGridCell's
  // onPress, gated behind `unlocked` there) — a locked cell has no card to
  // show a recipe for.
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const openCard = openCardId ? config.recipeCards.find((card) => card.id === openCardId) : undefined;

  return (
    <View style={[styles.container, { backgroundColor: background[0] }]}>
      <GinghamTrim accentColor={accent} panelColor={panel} height={12} />

      <View style={styles.header}>
        <Pressable
          style={[styles.backButton, { backgroundColor: panel, borderColor: border }]}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
        >
          <Text style={[styles.backArrow, { color: text }]} allowFontScaling={false}>
            ‹
          </Text>
        </Pressable>
        <View>
          <Text style={[styles.title, { color: accent }]}>My Recipe Book</Text>
          <Text style={[styles.subtitle, { color: mutedText }]}>{subtitle}</Text>
        </View>
      </View>

      <ScrollView style={styles.grid} contentContainerStyle={styles.gridContent}>
        {chunkIntoRows(config.recipeCards, GRID_COLUMNS).map((row, i) => (
          <View key={i} style={styles.row}>
            {row.map((card) => (
              <RecipeGridCell
                key={card.id}
                card={card}
                unlocked={unlockedCardIds.includes(card.id)}
                config={config}
                spriteAssets={spriteAssets}
                onPress={() => setOpenCardId(card.id)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {openCard && (
        <RecipeDetailModal
          card={openCard}
          config={config}
          spriteAssets={spriteAssets}
          onDismiss={() => setOpenCardId(null)}
        />
      )}
    </View>
  );
}

function RecipeGridCell({
  card,
  unlocked,
  config,
  spriteAssets,
  onPress,
}: {
  card: RecipeCard;
  unlocked: boolean;
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  onPress: () => void;
}) {
  const { panel, border, text } = config.palette;

  if (!unlocked) {
    return <View style={[styles.cell, styles.emptyCell, { borderColor: border }]} />;
  }

  const sprite = resolveSpriteAsset(card.sprite, spriteAssets);
  return (
    <Pressable
      style={[styles.cell, { backgroundColor: panel, borderColor: border }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${card.title} recipe`}
    >
      <View style={styles.cellIllustration}>
        <CardIllustration sprite={sprite} labelColor={text} />
      </View>
      <Text style={[styles.cellTitle, { color: text }]} numberOfLines={2}>
        {card.title}
      </Text>
    </Pressable>
  );
}

const CELL_GAP = 12;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: -2,
  },
  title: {
    fontFamily: Fonts.headingBold,
    fontSize: 23,
    fontWeight: '700',
    lineHeight: 26,
  },
  subtitle: {
    fontFamily: Fonts.bodyRegular,
    fontSize: 12,
    marginTop: 1,
  },
  grid: {
    flex: 1,
  },
  gridContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    gap: CELL_GAP,
    marginBottom: CELL_GAP,
  },
  cell: {
    // flex: 1 (not a percentage width) is what makes three cells plus two
    // `gap`s in the same row sum to exactly the row's own width — see
    // chunkIntoRows' comment above for the percentage-width approach this
    // replaced.
    flex: 1,
    aspectRatio: 0.82,
    borderWidth: 1.5,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  emptyCell: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  cellIllustration: {
    width: '68%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustrationImage: {
    width: '100%',
    height: '100%',
  },
  illustrationLabel: {
    fontSize: 22,
    fontWeight: '700',
  },
  cellTitle: {
    fontFamily: Fonts.bodyBold,
    marginTop: 6,
    // 12pt legibility floor (1.0.1 pass) — see LevelMap.tsx's captionText.
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
