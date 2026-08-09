import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { Objective } from '../engine/gameState';
import { Fonts } from './fonts';
import { SkinConfig } from './skinConfig';
import { getSpriteForMatchType } from './spriteMap';
import {
  CLEARANCE_OBJECTIVE_SPRITE,
  ESCORT_OBJECTIVE_SPRITE,
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
}

// The "Kitchen Tray" redesign (SPEC.md, 2026-08-08) — replaces the old flat,
// borderless panel row after real feedback that the HUD read as bland. A
// warm wood-tray surface (skinConfig.palette.tray) houses rounded pill chips
// for Target/Moves/Lives plus a character-portrait medallion — the same
// three at-a-glance stats this HUD always had, restyled with real material
// and shadow instead of flat rectangles. Deliberately NOT a second competing
// palette: only the tray's own outer surface gets a dedicated color
// (tray.background/border); the chips inside it keep reusing the game's
// existing panel/border/accent, so the warmth reads as a new material
// holding familiar surfaces, not a clashing redesign. This started as a
// comparison sketch (components/HudOptionB.tsx, since removed — its purpose
// was served once the direction was chosen; see engine/DECISIONS.md) whose
// own layout had a real regression fixed here: a multi-objective level
// keeps one row per objective (this file's original structure), not
// OptionB's joined "3/10 · 1/5" string, which crowds multiple icons ahead
// of hard-to-parse combined text.
//
// The running-score plaque that used to sit here (SPEC.md's HUD
// reward-texture-and-character spec) was removed to make room for a real
// mascot portrait once one existed — a direct architect call ("remove the
// score block to put the mascot in"). Board.tsx's runningScore state was
// removed alongside it rather than kept as dead state with nothing
// reading it. Per-move score feedback (Board.tsx's ScorePopup) was later
// removed too — score isn't surfaced to the player anywhere except a
// 'score'-type objective's own Target panel (this Hud's objectives prop),
// so a transient "+263" popup on every level was a number with nothing
// for the player to connect it to.
export function Hud({ objectives, movesRemaining, lives, config, spriteAssets }: HudProps) {
  const { palette } = config;
  // config.lives.icon is a sprite reference with the same shape as a
  // pieceTypes entry (see lalas-kitchen-build-spec.md), so it goes through
  // the exact same resolveSpriteAsset() pipeline as any board piece —
  // "flame.webp" today, swapped for a real icon the same file-drop way.
  const livesSprite = resolveSpriteAsset(config.lives.icon, spriteAssets);
  // The mascot is fixed skin art, not per-level data — a plain filename
  // reference (matching Home.tsx's own 'home-hero-500h-crop.webp'
  // convention for the hero image), not a config field, since no skin-swap
  // concern exists yet for a single-skin game.
  const mascotSprite = resolveSpriteAsset('mascot.webp', spriteAssets);

  return (
    // The level-name line that used to sit above this tray was dropped
    // (SPEC.md's bottom-toolbar/chrome-trim decision) — the name is already
    // shown on Home/LevelMap/WonOverlay before and after a level, so the
    // in-play HUD doesn't need to repeat it, and the freed ~22px goes back
    // to the board itself on the real mobile viewport where every pixel of
    // tileSize is load-bearing for tap accuracy.
    <View
      style={[
        styles.tray,
        { backgroundColor: palette.tray.background, borderColor: palette.tray.border },
      ]}
    >
      <View pointerEvents="none" style={styles.trayInset} />
        <View style={styles.chipRow}>
          <Chip config={config} label="Target">
            {/* One icon+count pair per objective, stacked — a single-
                objective level (still every hand-built level today)
                renders exactly the one row this chip always had, so this
                isn't a visual change unless a level actually has more
                than one. Kept as separate rows (not OptionB's joined
                string) specifically for the 2-objective case a generated
                level can reach — see this file's own header comment. */}
            {objectives.map((objective, index) => {
              const targetSprite =
                objective.type === 'score'
                  ? SCORE_OBJECTIVE_SPRITE
                  : objective.type === 'clearance'
                    ? CLEARANCE_OBJECTIVE_SPRITE
                    : objective.type === 'escort'
                      ? ESCORT_OBJECTIVE_SPRITE
                      : resolveSpriteAsset(getSpriteForMatchType(objective.targetMatchType, config), spriteAssets);
              return (
                <View
                  key={
                    objective.type === 'score' || objective.type === 'clearance' || objective.type === 'escort'
                      ? objective.type
                      : objective.targetMatchType
                  }
                  style={[styles.glyphRow, index > 0 && styles.glyphRowSpacing]}
                >
                  <Glyph sprite={targetSprite} color={palette.accent} />
                  <Text style={[styles.value, { color: palette.text }]}>
                    {objective.currentCount}/{objective.targetCount}
                  </Text>
                </View>
              );
            })}
          </Chip>
          <Chip config={config} label="Moves">
            <Text style={[styles.value, { color: palette.accent }]}>{movesRemaining}</Text>
          </Chip>
          <Chip config={config} label="Lives">
            <View style={styles.glyphRow}>
              <Glyph sprite={livesSprite} color={palette.accent} />
              <Text style={[styles.value, { color: palette.text }]}>{Math.max(lives, 0)}</Text>
            </View>
          </Chip>
        </View>

        <View style={styles.mascotRow}>
          <View
            style={[styles.mascotFrame, { backgroundColor: palette.panel, borderColor: palette.tray.chipBorder }]}
          >
            {/* Same "always show something, never silently vanish" fallback
                convention as Glyph above — a two-letter placeholder if the
                mascot sprite is ever missing, rather than an empty frame. */}
            {mascotSprite.kind === 'image' ? (
              <Image source={mascotSprite.source} style={styles.mascotImage} resizeMode="cover" />
            ) : (
              <Text style={[styles.mascotFallbackLabel, { color: palette.accent }]}>{mascotSprite.label}</Text>
            )}
          </View>
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

function Chip({
  label,
  config,
  children,
}: {
  label: string;
  config: SkinConfig;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: config.palette.panel, borderColor: config.palette.tray.chipBorder },
      ]}
    >
      <Text style={[styles.label, { color: config.palette.mutedText }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    position: 'relative',
    marginHorizontal: 8,
    paddingHorizontal: 10,
    // Kept deliberately tight — this HUD's total height was reasoned
    // against Board.tsx's own tileSize computation (byHeight = floor(
    // available height / rows)) at an SE-sized viewport, the same
    // worst-case CLAUDE.md's own board-sizing notes already use. A
    // first pass at this padding put the estimated new-HUD growth close
    // enough to the estimated vertical slack that shrinking tileSize on
    // a small phone was a real, not-ruled-out risk — see
    // engine/DECISIONS.md's HUD-character entry. The character this
    // redesign is going for comes from shape/color/material (pills, the
    // tray surface, the shadow), not raw size, so trimming padding here
    // doesn't undercut the actual goal.
    //
    // Re-tightened again (commercial-polish consolidation pass): a
    // consolidated set of "more character" changes — the trayInset ring,
    // bigger chip minHeight, bigger glyphs, a bigger score plaque — grew
    // this back to 145px measured live (real tileSize regression: 63→59
    // on the 8x5 reference level), undoing the earlier tightening. Retuned
    // back down with the same live-measurement discipline, not guessed.
    paddingTop: 6,
    paddingBottom: 4,
    borderWidth: 1.5,
    borderRadius: 18,
    // A soft lift off the background — real but restrained, matching the
    // calm-not-frantic register everything else in this app's motion and
    // materials already holds to (a shadow, not a glow or a bounce).
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  trayInset: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 239, 199, 0.28)',
    borderRadius: 14,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderWidth: 1.5,
    // A real pill, not the old chip's plain rounded rectangle — the
    // single biggest legibility-free shape change that reads as "tray
    // holding chips" rather than "three boxes in a row."
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  value: {
    fontFamily: Fonts.bodyBold,
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
  mascotRow: {
    alignItems: 'center',
    // Kept tight, same live-measurement discipline as the tray's own
    // padding comment above — the first pass here (40px frame, 4px
    // margin) measured out taller than the score plaque it replaced (105px
    // tray vs. 96px), costing a real tileSize pixel at the reference
    // viewport (60 -> 59). Retuned back down to match, not guessed.
    marginTop: 2,
  },
  mascotFrame: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascotImage: {
    width: '100%',
    height: '100%',
  },
  mascotFallbackLabel: {
    fontFamily: Fonts.headingBold,
    fontSize: 12,
  },
});
