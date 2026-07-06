import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Piece } from '../engine/matrix';
import { SkinConfig } from './skinConfig';
import { getSpriteForPiece } from './spriteMap';
import { resolveSpriteAsset, ResolvedSprite, SpriteAssetMap } from './spriteAsset';
import { spriteLabel } from './spriteLabel';

// The calm one-line explanation shown the first time each special piece comes
// to rest on the board, keyed by the same id findSpecialPieceTutorial returns
// (identical to the engine PieceType) — plus one more, `chain_reaction`
// (appPersistence.ts's CHAIN_REACTION_TUTORIAL_ID), keyed the same way even
// though it isn't a PieceType: it's the fourth tutorial, for the moment more
// than one special fires together. Copy lives here, beside the only thing
// that renders it, rather than in appPersistence.ts — the persistence layer
// owns WHICH tutorial and WHETHER it's been seen; the wording is presentation.
// That's the same split BlockerTutorialOverlay makes by hardcoding its own
// headline/subtext. Tone matches "A Covered Dish": warm, plain, one action,
// no urgency (see CLAUDE.md's calm-not-frantic brief) — chain_reaction's copy
// leans into noticing the moment rather than re-explaining any one piece's
// mechanic, since the player has already seen each piece's own card by then.
export const SPECIAL_TUTORIAL_CONTENT: Record<string, { headline: string; subtext: string }> = {
  striped: {
    headline: 'A Striped Treat',
    subtext: 'Match a striped piece to sweep its whole row or column clear.',
  },
  color_bomb: {
    headline: 'A Color Bomb',
    subtext: 'Swap the color bomb with any piece to clear every piece of that kind.',
  },
  area_bomb: {
    headline: 'An Area Blast',
    subtext: 'Swap the area blast to clear everything in the squares around it.',
  },
  chain_reaction: {
    headline: 'Everything at Once',
    subtext: 'Sometimes one move sets off more than one special together — the more you make, the more they find each other.',
  },
};

// A soft low-alpha tint of config.palette.border (#D9C79E) behind the icon —
// a translucent backgroundColor rather than the RN `opacity` prop, so the tint
// dims only the circle, not the sprite drawn on top of it. Matches
// BlockerTutorialOverlay's ICON_WASH exactly (same overlay family).
const ICON_WASH = 'rgba(217, 199, 158, 0.45)';

function SpriteIcon({ sprite, size, labelColor }: { sprite: ResolvedSprite; size: number; labelColor: string }) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={{ width: size, height: size }} resizeMode="contain" />;
  }
  return <Text style={[styles.spriteLabel, { fontSize: size * 0.4, color: labelColor }]}>{sprite.label}</Text>;
}

export interface SpecialTutorialOverlayProps {
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  // Which of the three special tutorials to show — the id findSpecialPieceTutorial
  // returned, used to pick the headline/subtext copy above.
  tutorialId: string;
  // The actual special piece that just appeared. Its sprite is resolved through
  // the exact same getSpriteForPiece path Board.tsx uses for every live tile, so
  // the icon is always the real in-play art (or the same text-label placeholder
  // an un-arted piece shows — e.g. "AR" for an area bomb with no bundled art),
  // never a hardcoded reference. A striped piece's icon therefore reflects the
  // base ingredient it was forged from.
  //
  // Null for the chain_reaction tutorial: that card celebrates a MOMENT (more
  // than one special firing together), not any single piece — by the time the
  // move settles, the specials that fired are already cleared, so there's no
  // resting piece to point getSpriteForPiece at. Falls back to the same
  // text-label placeholder convention every un-arted piece already uses (see
  // the icon fallback below), never a hardcoded sprite reference.
  piece: Piece | null;
  onDismiss: () => void;
}

// The one data-driven sibling of BlockerTutorialOverlay for all three special
// pieces — one component, not three near-identical files, since only the
// headline/subtext/icon differ (see CLAUDE.md's "collapse the duplication"
// rule). Mirrors WonOverlay/PausedOverlay/OutOfLives/BlockerTutorialOverlay's
// card/backdrop shape exactly, shown once ever per piece type (see
// appPersistence.ts's findSpecialPieceTutorial) the first time that special
// rests on the board, with input gated behind it (Board.tsx's canAcceptMove).
// A single dismiss action, not a primary/secondary pair — an explanation, not a
// decision.
export function SpecialTutorialOverlay({ config, spriteAssets, tutorialId, piece, onDismiss }: SpecialTutorialOverlayProps) {
  // No single piece to derive an icon from for chain_reaction (see the `piece`
  // prop's doc comment) — falls back to the same short-code placeholder every
  // un-arted sprite already uses (spriteLabel), rather than resolving through
  // getSpriteForPiece against a piece that doesn't exist.
  const sprite: ResolvedSprite = piece
    ? resolveSpriteAsset(getSpriteForPiece(piece, config), spriteAssets)
    : { kind: 'label', label: spriteLabel(tutorialId) };
  const content = SPECIAL_TUTORIAL_CONTENT[tutorialId];
  const { accent, mutedText, text, panel, border } = config.palette;

  return (
    <View style={styles.backdrop}>
      <View style={[styles.card, { backgroundColor: panel, borderColor: border }]}>
        <View style={[styles.iconWrap, { backgroundColor: ICON_WASH }]}>
          <SpriteIcon sprite={sprite} size={48} labelColor={accent} />
        </View>

        <Text style={[styles.headline, { color: text }]}>{content.headline}</Text>
        <Text style={[styles.subtext, { color: mutedText }]}>{content.subtext}</Text>

        <Pressable style={[styles.primaryButton, { backgroundColor: accent }]} onPress={onDismiss}>
          <Text style={styles.primaryButtonLabel}>Got it</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Warm brown wash, not black — see WonOverlay.tsx's matching scrim.
    backgroundColor: 'rgba(59, 38, 26, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 320,
    maxWidth: '88%',
    borderWidth: 2,
    borderRadius: 26,
    paddingTop: 24,
    paddingBottom: 22,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spriteLabel: {
    fontWeight: '700',
  },
  headline: {
    marginTop: 16,
    fontSize: 21,
    fontWeight: '800',
  },
  subtext: {
    marginTop: 6,
    fontSize: 13.5,
    fontWeight: '500',
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    marginTop: 18,
    paddingVertical: 13,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButtonLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
