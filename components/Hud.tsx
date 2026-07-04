import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Objective } from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { getSpriteForMatchType } from './spriteMap';
import { resolveSpriteAsset, ResolvedSprite, SpriteAssetMap } from './spriteAsset';

export interface HudProps {
  objectives: Objective[];
  movesRemaining: number;
  lives: number;
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
}

// Flat panels, no decorative frame — per CLAUDE.md's design constraints,
// every pixel spent on chrome here is a pixel not spent on tile size (and
// tap accuracy) for the actual board.
export function Hud({ objectives, movesRemaining, lives, config, spriteAssets }: HudProps) {
  // config.lives.icon is a sprite reference with the same shape as a
  // pieceTypes entry (see lalas-kitchen-build-spec.md), so it goes through
  // the exact same resolveSpriteAsset() pipeline as any board piece —
  // "flame.webp" today, swapped for a real icon the same file-drop way.
  const livesSprite = resolveSpriteAsset(config.lives.icon, spriteAssets);

  return (
    <View style={styles.row}>
      <Panel config={config} label="Target">
        {/* One icon+count pair per objective, stacked — a single-objective
            level (still every hand-built level today) renders exactly the
            one row this panel always has, so this isn't a visual change
            unless a level actually has more than one. */}
        {objectives.map((objective, index) => {
          const targetSprite = resolveSpriteAsset(
            getSpriteForMatchType(objective.targetMatchType, config),
            spriteAssets
          );
          return (
            <View
              key={objective.targetMatchType}
              style={[styles.glyphRow, index > 0 && styles.glyphRowSpacing]}
            >
              <Glyph sprite={targetSprite} color={config.palette.accent} />
              <Text style={styles.value}>
                {objective.currentCount}/{objective.targetCount}
              </Text>
            </View>
          );
        })}
      </Panel>
      <Panel config={config} label="Moves">
        <Text style={styles.value}>{movesRemaining}</Text>
      </Panel>
      <Panel config={config} label="Lives">
        <View style={styles.glyphRow}>
          <Glyph sprite={livesSprite} color={config.palette.accent} />
          <Text style={styles.value}>{Math.max(lives, 0)}</Text>
        </View>
      </Panel>
    </View>
  );
}

function Glyph({ sprite, color }: { sprite: ResolvedSprite; color: string }) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={styles.glyphImage} resizeMode="contain" />;
  }
  return <Text style={[styles.value, { color }]}>{sprite.label}</Text>;
}

function Panel({
  label,
  config,
  children,
}: {
  label: string;
  config: SkinConfig;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.panel, { backgroundColor: config.palette.panel, borderColor: config.palette.accent }]}>
      <Text style={[styles.label, { color: config.palette.accent }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  panel: {
    flex: 1,
    marginHorizontal: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  value: {
    fontSize: 16,
    fontWeight: '700',
  },
  glyphRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  glyphRowSpacing: {
    marginTop: 4,
  },
  glyphImage: {
    width: 18,
    height: 18,
    marginRight: 4,
  },
});
