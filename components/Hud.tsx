import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { Objective } from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { getSpriteForMatchType } from './spriteMap';
import {
  CLEARANCE_OBJECTIVE_SPRITE,
  resolveSpriteAsset,
  ResolvedSprite,
  SCORE_OBJECTIVE_SPRITE,
  SpriteAssetMap,
} from './spriteAsset';

export interface HudProps {
  objectives: Objective[];
  movesRemaining: number;
  lives: number;
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  // Already-resolved display label (a hand-built level's displayName, or
  // "Level N" for a generated one — see levelProgress.ts's
  // resolveLevelDisplayName) — Hud only renders it, it doesn't derive it.
  levelLabel: string;
}

// Flat panels, no decorative frame — per CLAUDE.md's design constraints,
// every pixel spent on chrome here is a pixel not spent on tile size (and
// tap accuracy) for the actual board.
export function Hud({ objectives, movesRemaining, lives, config, spriteAssets, levelLabel }: HudProps) {
  // config.lives.icon is a sprite reference with the same shape as a
  // pieceTypes entry (see lalas-kitchen-build-spec.md), so it goes through
  // the exact same resolveSpriteAsset() pipeline as any board piece —
  // "flame.webp" today, swapped for a real icon the same file-drop way.
  const livesSprite = resolveSpriteAsset(config.lives.icon, spriteAssets);

  return (
    <View>
      {/* A plain muted line, not a fourth panel — the same "never compete
          with Target/Moves/Lives" reasoning Board.tsx's exit button already
          uses, just applied to a label instead of a button. */}
      <Text style={[styles.levelLabel, { color: config.palette.mutedText }]}>{levelLabel}</Text>
      <View style={styles.row}>
        <Panel config={config} label="Target">
          {/* One icon+count pair per objective, stacked — a single-objective
              level (still every hand-built level today) renders exactly the
              one row this panel always has, so this isn't a visual change
              unless a level actually has more than one. */}
          {objectives.map((objective, index) => {
            const targetSprite =
              objective.type === 'score'
                ? SCORE_OBJECTIVE_SPRITE
                : objective.type === 'clearance'
                  ? CLEARANCE_OBJECTIVE_SPRITE
                  : resolveSpriteAsset(getSpriteForMatchType(objective.targetMatchType, config), spriteAssets);
            return (
              <View
                key={objective.type === 'score' || objective.type === 'clearance' ? objective.type : objective.targetMatchType}
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
  levelLabel: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 4,
  },
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
