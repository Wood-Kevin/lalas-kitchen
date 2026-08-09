import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { GinghamTrim } from './GinghamTrim';
import { resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';

export interface KitchenSceneDecorProps {
  accentColor: string;
  panelColor: string;
  spriteAssets: SpriteAssetMap;
}

// Quiet corner scene dressing — a gingham cloth peeking from behind the
// board with an herb sprite tucked in the opposite corner. Decorative only,
// `pointerEvents="none"` throughout, so it was never actually a tap-target
// risk (that guard was already structurally correct). What WAS wrong, found
// during the commercial-polish consolidation pass: the caller originally
// mounted this absolutely-filling the entire outer screen container —
// spanning the HUD and every overlay, not just the board — because it never
// received the board's own measured area. It's now rendered as a sibling
// INSIDE Board.tsx's `boardArea` View (see that file), gated behind the same
// `tileSize > 0` condition the board grid itself uses, and painted BEFORE
// the board View so tiles occlude it wherever they visually overlap — the
// cloth/herb corners are meant to peek out from behind the board's edges,
// not compete with it. The fixed pixel offsets below (`left: -38`, etc.)
// are relative to `boardArea`'s own bounds now, not the screen's, which is
// what makes them a reasonable "peek from the corner" position rather than
// an arbitrary screen-relative guess.
export function KitchenSceneDecor({ accentColor, panelColor, spriteAssets }: KitchenSceneDecorProps) {
  const herb = resolveSpriteAsset('herb.webp', spriteAssets);

  return (
    <View pointerEvents="none" style={styles.layer}>
      <View style={styles.clothShadow} />
      <View style={styles.cloth}>
        <GinghamTrim accentColor={accentColor} panelColor={panelColor} height={64} cellSize={16} />
        <View style={styles.clothFold} />
      </View>
      {herb.kind === 'image' && <Image source={herb.source} style={styles.herb} resizeMode="contain" />}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  clothShadow: {
    position: 'absolute',
    width: 170,
    height: 48,
    left: -38,
    bottom: -2,
    borderRadius: 8,
    backgroundColor: 'rgba(72, 43, 25, 0.16)',
    transform: [{ rotate: '32deg' }],
  },
  cloth: {
    position: 'absolute',
    width: 170,
    height: 64,
    left: -42,
    bottom: 4,
    borderRadius: 6,
    overflow: 'hidden',
    transform: [{ rotate: '32deg' }],
    opacity: 0.82,
  },
  clothFold: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 10,
    backgroundColor: 'rgba(112, 58, 42, 0.2)',
  },
  herb: {
    position: 'absolute',
    width: 64,
    height: 64,
    right: -8,
    bottom: -8,
    opacity: 0.7,
    transform: [{ rotate: '-16deg' }],
  },
});
