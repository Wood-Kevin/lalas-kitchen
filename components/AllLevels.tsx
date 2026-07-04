import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, Image } from 'react-native';
import { SkinConfig } from './skinConfig';
import { SpriteAssetMap, resolveSpriteAsset } from './spriteAsset';
import { getSpriteForMatchType } from './spriteMap';
import { GinghamTrim } from './GinghamTrim';
import { LevelStatus, LevelSummary } from './levelProgress';

export interface AllLevelsRow extends LevelSummary {
  status: LevelStatus;
}

export interface AllLevelsProps {
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  levels: AllLevelsRow[];
  completedCount: number;
  onBack: () => void;
  // Jumps straight into a completed level to replay it — locked rows never
  // call this (see the per-row Pressable/View split below).
  onPlayLevel: (levelIndex: number) => void;
}

// The level-select screen — evolved from the original Dashboard.tsx (a flat
// Pressable list with no header, icons, or locked state; every hand-built
// level was always shown and always tappable regardless of completion).
// This is the "All Levels" half of the two-screen design; Home.tsx is the
// new landing screen that sits in front of it.
export function AllLevels({ config, spriteAssets, levels, completedCount, onBack, onPlayLevel }: AllLevelsProps) {
  return (
    <View style={[styles.container, { backgroundColor: config.palette.background[0] }]}>
      <GinghamTrim accentColor={config.palette.accent} panelColor={config.palette.panel} height={12} />

      <View style={styles.header}>
        <Pressable
          style={[styles.backButton, { backgroundColor: config.palette.panel, borderColor: config.palette.border }]}
          onPress={onBack}
          accessibilityLabel="Back to home"
        >
          <Text style={[styles.backArrow, { color: config.palette.text }]}>‹</Text>
        </Pressable>
        <View>
          <Text style={[styles.title, { color: config.palette.accent }]}>All levels</Text>
          <Text style={[styles.statusLine, { color: config.palette.mutedText }]}>
            {completedCount} cooked · pick up wherever you like
          </Text>
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {levels.map((level) => (
          <LevelRow key={level.levelIndex} level={level} config={config} spriteAssets={spriteAssets} onPlayLevel={onPlayLevel} />
        ))}
      </ScrollView>
    </View>
  );
}

function LevelRow({
  level,
  config,
  spriteAssets,
  onPlayLevel,
}: {
  level: AllLevelsRow;
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  onPlayLevel: (levelIndex: number) => void;
}) {
  const isCompleted = level.status === 'completed';
  const sprite = resolveSpriteAsset(getSpriteForMatchType(level.targetMatchType, config), spriteAssets);

  const content = (
    <View
      style={[
        styles.row,
        {
          backgroundColor: config.palette.panel,
          borderColor: config.palette.border,
          opacity: isCompleted ? 1 : 0.6,
        },
      ]}
    >
      <View style={[styles.iconBadge, { backgroundColor: config.palette.background[0] }]}>
        {sprite.kind === 'image' ? (
          <Image source={sprite.source} style={styles.iconImage} resizeMode="contain" />
        ) : (
          <Text style={{ color: config.palette.text }}>{sprite.label}</Text>
        )}
      </View>
      <View style={styles.rowTextBlock}>
        <Text
          style={[
            styles.levelLabel,
            { color: isCompleted ? config.palette.secondaryAccent : config.palette.mutedText },
          ]}
        >
          Level {level.levelIndex}
        </Text>
        <Text style={[styles.levelName, { color: config.palette.text }]}>{level.displayName}</Text>
      </View>
      {isCompleted ? (
        <View style={[styles.statusBadge, { backgroundColor: `${config.palette.secondaryAccent}30` }]}>
          <Text style={[styles.checkGlyph, { color: config.palette.secondaryAccent }]}>{'✓'}</Text>
        </View>
      ) : (
        <View style={[styles.statusBadge, { backgroundColor: `${config.palette.border}55` }]}>
          <Text style={styles.lockGlyph}>{'🔒'}</Text>
        </View>
      )}
    </View>
  );

  if (!isCompleted) {
    // Not-yet-reached levels are visually present but inert — no
    // Pressable wrapper at all, so there's nothing to tap.
    return content;
  }

  return <Pressable onPress={() => onPlayLevel(level.levelIndex)}>{content}</Pressable>;
}

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
    fontSize: 23,
    fontWeight: '700',
    lineHeight: 26,
  },
  statusLine: {
    fontSize: 12,
    marginTop: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 9,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 11,
  },
  iconBadge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconImage: {
    width: 28,
    height: 28,
  },
  rowTextBlock: {
    flex: 1,
    gap: 1,
  },
  levelLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  levelName: {
    fontSize: 17,
    fontWeight: '700',
  },
  statusBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: {
    fontSize: 15,
    fontWeight: '700',
  },
  lockGlyph: {
    fontSize: 13,
  },
});
