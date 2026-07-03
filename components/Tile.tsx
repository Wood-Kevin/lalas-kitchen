import React, { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ResolvedSprite } from './spriteAsset';

export interface TileProps {
  pieceId: string;
  row: number;
  col: number;
  tileSize: number;
  sprite: ResolvedSprite;
  accentColor: string;
  panelColor: string;
  selected: boolean;
  durationMs: number;
  // Set only on the render where this piece first appears (a cascade
  // spawn). Read once, at mount, to make the tile animate down into place
  // instead of popping directly into its landing row — see
  // components/NOTES.md.
  enterFromRow?: number;
  onPress: () => void;
}

// A single animated board tile. Position is driven entirely by Reanimated
// shared values so a full cascade resolves on the UI thread, not via
// per-frame React state (see CLAUDE.md's testing/perf note on the JS
// bridge bottlenecking on a 15-piece cascade).
export function Tile({
  pieceId,
  row,
  col,
  tileSize,
  sprite,
  accentColor,
  panelColor,
  selected,
  durationMs,
  enterFromRow,
  onPress,
}: TileProps) {
  const rowShared = useSharedValue(enterFromRow ?? row);
  const colShared = useSharedValue(col);
  const opacity = useSharedValue(enterFromRow !== undefined ? 0 : 1);

  useEffect(() => {
    rowShared.value = withTiming(row, { duration: durationMs });
    colShared.value = withTiming(col, { duration: durationMs });
    opacity.value = withTiming(1, { duration: durationMs });
    // Only the target position/duration should retrigger the animation —
    // reanimated shared values are stable across renders by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, col, durationMs]);

  const animatedStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    top: rowShared.value * tileSize,
    left: colShared.value * tileSize,
    width: tileSize,
    height: tileSize,
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={animatedStyle} testID={`tile-${pieceId}`}>
      <Pressable
        onPress={onPress}
        style={[
          styles.tile,
          {
            backgroundColor: panelColor,
            borderColor: accentColor,
            borderWidth: selected ? 3 : 1,
          },
        ]}
      >
        <SpriteContent sprite={sprite} accentColor={accentColor} />
      </Pressable>
    </Animated.View>
  );
}

export interface ExitingTileProps {
  pieceId: string;
  row: number;
  col: number;
  tileSize: number;
  sprite: ResolvedSprite;
  accentColor: string;
  panelColor: string;
  durationMs: number;
  onExited: () => void;
}

// A piece that just matched. Plays a calm pop-and-shrink (per the
// lalas-kitchen config's matchStyle) and unmounts itself once the
// animation finishes — deliberately no particle burst or flash, per
// CLAUDE.md's "calm, not frantic" design constraint.
export function ExitingTile({
  pieceId,
  row,
  col,
  tileSize,
  sprite,
  accentColor,
  panelColor,
  durationMs,
  onExited,
}: ExitingTileProps) {
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withTiming(0, { duration: durationMs });
    scale.value = withTiming(0, { duration: durationMs });
    const timeout = setTimeout(onExited, durationMs);
    return () => clearTimeout(timeout);
    // Runs once on mount — an exiting tile never changes position or duration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    top: row * tileSize,
    left: col * tileSize,
    width: tileSize,
    height: tileSize,
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle} pointerEvents="none" testID={`exiting-${pieceId}`}>
      <Animated.View style={[styles.tile, { backgroundColor: panelColor, borderColor: accentColor }]}>
        <SpriteContent sprite={sprite} accentColor={accentColor} />
      </Animated.View>
    </Animated.View>
  );
}

// Shared by Tile and ExitingTile so there's exactly one place that decides
// between an image and the text-label fallback — driven entirely by
// resolveSpriteAsset()'s output, never by which piece is being drawn.
function SpriteContent({ sprite, accentColor }: { sprite: ResolvedSprite; accentColor: string }) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={styles.image} resizeMode="contain" />;
  }
  return <Text style={[styles.label, { color: accentColor }]}>{sprite.label}</Text>;
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    margin: 2,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 20,
    fontWeight: '600',
  },
  image: {
    width: '80%',
    height: '80%',
  },
});
