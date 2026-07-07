import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SkinConfig } from './skinConfig';
import { resolveSpriteAsset, ResolvedSprite, SpriteAssetMap } from './spriteAsset';

export interface LivesBadgeProps {
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  lives: number;
}

// A calm, corner-placed readout of the same account-level lives count
// Hud.tsx's in-level "Lives" panel already shows — reused here as a plain
// icon+count pill rather than a bordered/labeled Panel, since Home and
// LevelMap have no in-level HUD row to slot it into and a full panel would
// read as a competing focal point next to the hero/start button or the
// back button/title. Same sprite pipeline as Hud.tsx (config.lives.icon
// through resolveSpriteAsset) so a real icon drop-in updates both places
// at once.
export function LivesBadge({ config, spriteAssets, lives }: LivesBadgeProps) {
  const livesSprite = resolveSpriteAsset(config.lives.icon, spriteAssets);

  return (
    <View style={[styles.badge, { backgroundColor: config.palette.panel, borderColor: config.palette.border }]}>
      <Glyph sprite={livesSprite} color={config.palette.accent} />
      <Text style={[styles.value, { color: config.palette.text }]}>{Math.max(lives, 0)}</Text>
    </View>
  );
}

function Glyph({ sprite, color }: { sprite: ResolvedSprite; color: string }) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={styles.glyphImage} resizeMode="contain" />;
  }
  return <Text style={[styles.value, { color }]}>{sprite.label}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 4,
  },
  glyphImage: {
    width: 16,
    height: 16,
  },
  value: {
    fontSize: 13,
    fontWeight: '700',
  },
});
