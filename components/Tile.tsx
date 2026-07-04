import React, { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { ResolvedSprite } from './spriteAsset';
import { BLOCKER_CLEAR_HIGHLIGHT_MS } from './cascadeTiming';
import { StripeDirection } from '../engine/matrix';

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
  // Present only for a striped piece — which line it will sweep when matched
  // ('row' = horizontal, 'col' = vertical). Drives the small corner badge
  // that replaces the visual signal the old stripe overlay used to carry (see
  // DirectionBadge). Undefined for every ordinary piece, so no badge renders.
  direction?: StripeDirection;
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
  direction,
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
        {direction && (
          <DirectionBadge
            direction={direction}
            tileSize={tileSize}
            accentColor={accentColor}
            panelColor={panelColor}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

// The small corner badge that tells a player, at a glance, whether a striped
// piece will sweep its row or its column before they commit the move. It
// exists because dedicated striped art replaced the old full-tile stripe
// overlay that used to carry this direction cue implicitly; the engine still
// enforces the real direction (gameState.ts's resolveCascades), this just
// makes it visible again. Deliberately small and informational — a single
// double-headed arrow (↔ horizontal for a row sweep, ↕ vertical for a column
// sweep), not a celebratory effect — per CLAUDE.md's calm-not-frantic rule.
// Sits above the sprite and renders identically whether the sprite is
// dedicated art or the text-label placeholder, since it's layered over
// SpriteContent rather than baked into either path. pointerEvents="none" so
// it never steals the tile's tap.
function DirectionBadge({
  direction,
  tileSize,
  accentColor,
  panelColor,
}: {
  direction: StripeDirection;
  tileSize: number;
  accentColor: string;
  panelColor: string;
}) {
  // Scale with the tile so it stays a consistent, small fraction of the piece
  // across screen sizes, with a floor so it can't shrink below legibility on
  // a very small board.
  const badgeSize = Math.max(14, Math.round(tileSize * 0.32));
  const glyph = direction === 'row' ? '↔' : '↕';
  return (
    <View
      pointerEvents="none"
      testID={`direction-badge-${direction}`}
      style={[
        styles.directionBadge,
        {
          width: badgeSize,
          height: badgeSize,
          borderRadius: badgeSize / 2,
          backgroundColor: panelColor,
          borderColor: accentColor,
        },
      ]}
    >
      <Text
        style={[styles.directionGlyph, { color: accentColor, fontSize: Math.round(badgeSize * 0.7) }]}
      >
        {glyph}
      </Text>
    </View>
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
  // True when this piece is a blocker cleared by adjacent-match damage
  // (engine/matrix.ts's applyAdjacentDamage) rather than a direct match —
  // set by Board.tsx purely from diffBoards' existing `cleared` list
  // filtered by piece.type, no new engine data. See
  // BLOCKER_CLEAR_HIGHLIGHT_MS's comment for why this needs its own beat.
  isBlockerClear?: boolean;
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
  isBlockerClear,
  onExited,
}: ExitingTileProps) {
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  // Only ever animates for a blocker clear; stays at 0 (invisible) otherwise.
  const highlightOpacity = useSharedValue(0);

  useEffect(() => {
    if (isBlockerClear) {
      const halfPulse = BLOCKER_CLEAR_HIGHLIGHT_MS / 2;
      // A brief glow-and-pop draws the eye here first, then the same
      // pop-and-shrink every other cleared tile gets — so a blocker cleared
      // several cascade steps from the player's tap still reads as "this
      // just got hit" instead of vanishing with no explanation.
      highlightOpacity.value = withSequence(
        withTiming(0.35, { duration: halfPulse }),
        withTiming(0, { duration: halfPulse })
      );
      scale.value = withSequence(
        withTiming(1.18, { duration: halfPulse }),
        withTiming(1, { duration: halfPulse }),
        withTiming(0, { duration: durationMs })
      );
      opacity.value = withDelay(BLOCKER_CLEAR_HIGHLIGHT_MS, withTiming(0, { duration: durationMs }));
      const timeout = setTimeout(onExited, BLOCKER_CLEAR_HIGHLIGHT_MS + durationMs);
      return () => clearTimeout(timeout);
    }
    opacity.value = withTiming(0, { duration: durationMs });
    scale.value = withTiming(0, { duration: durationMs });
    const timeout = setTimeout(onExited, durationMs);
    return () => clearTimeout(timeout);
    // Runs once on mount — an exiting tile never changes position, duration,
    // or its blocker-clear flag.
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

  const highlightStyle = useAnimatedStyle(() => ({
    opacity: highlightOpacity.value,
  }));

  return (
    <Animated.View style={animatedStyle} pointerEvents="none" testID={`exiting-${pieceId}`}>
      <Animated.View style={[styles.tile, { backgroundColor: panelColor, borderColor: accentColor }]}>
        <SpriteContent sprite={sprite} accentColor={accentColor} />
        {isBlockerClear && (
          <Animated.View
            style={[styles.blockerHighlight, { backgroundColor: accentColor }, highlightStyle]}
            testID={`blocker-highlight-${pieceId}`}
          />
        )}
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
  // Soft color wash over the whole tile, faded in/out by highlightOpacity —
  // deliberately a plain overlay (no ring/border/particle shape) to stay
  // inside CLAUDE.md's "calm, not frantic" constraint.
  blockerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
  },
  label: {
    fontSize: 20,
    fontWeight: '600',
  },
  image: {
    width: '80%',
    height: '80%',
  },
  // Pinned to the top-right corner so it sits clear of the sprite's centered
  // artwork. A bordered pill in the same panel/accent pairing the tile itself
  // uses, so it reads as part of the established chrome rather than a new
  // visual language.
  directionBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionGlyph: {
    fontWeight: '700',
    textAlign: 'center',
  },
});
