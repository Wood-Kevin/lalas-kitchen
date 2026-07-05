import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { PauseReason } from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { getPauseAction } from './pauseActions';
import { SteamWisp } from './SteamWisp';

export interface PausedOverlayProps {
  reason: PauseReason;
  // Real remaining count for the depleted resource — always 0 when
  // status is 'paused_awaiting_input', but read from GameState rather than
  // hardcoded so the status pill stays honest if that ever changes. Only
  // 'moves' is a reachable reason today (see PauseReason's comment in
  // engine/gameState.ts on why 'lives' was removed), so this always
  // reflects movesRemaining.
  movesRemaining: number;
  // Display-only "LEVEL N" label — see Board.tsx's levelIndex prop comment.
  levelIndex: number;
  config: SkinConfig;
  // Whether the "watch a video for more moves" grant should still be offered.
  // False once this attempt has hit its per-attempt grant cap (see
  // Board.tsx's bonusGrantsUsed + pauseActions.ts's canGrantBonusMoves). When
  // false the video CTA is dropped entirely and Play Again becomes the primary
  // action — running out of grants stays a calm "start fresh" moment, never a
  // failure screen.
  canGrant: boolean;
  // Whether tapping the grant button will actually show a real rewarded ad
  // right now (services/adService.ts's isRewardedAdAvailable()) — false
  // during CrazyGames' Basic Launch gap, when no ad exists to show and the
  // grant is given for free instead. Only changes the CTA's copy; the tap
  // handler and the grant itself are identical either way.
  adAvailable: boolean;
  // Only 'moves' is grantable now — see pauseActions.ts's comment on why
  // the 'lives' branch was removed. Only called while canGrant is true.
  onGrant: (amount: number) => void;
  // The exact same function Board.tsx passes to WonOverlay's onPlayAgain —
  // not a second implementation. Restarts this level fresh (new seed) so a
  // stuck player has a real way out that isn't the ad path.
  onPlayAgain: () => void;
  // Returns to Home. A stuck player shouldn't be forced to either watch an
  // ad or restart — leaving entirely is a third, equally real option.
  onExit: () => void;
}

// Same fixed brand accent WonOverlay.tsx uses for its sparkles — the
// bonus-video CTA deliberately uses this warm flame orange rather than
// config.palette.accent (brand red), so the ad-path action reads as its
// own distinct, calm-toned choice rather than borrowing the level's
// primary-flow red. Not skin-configurable; see WonOverlay.tsx's same note.
const FLAME = '#F2793A';

// Mirrors WonOverlay.tsx's card/backdrop shape and its
// one-primary-plus-two-quiet-secondary-links structure. Deliberately no red
// anywhere on this screen (not even a red-outlined "0 moves left" pill) —
// running out is a status, not an error, per CLAUDE.md's "calm, not
// frantic" constraint and this session's explicit "avoid harsh failure
// language" requirement.
export function PausedOverlay({ reason, movesRemaining, levelIndex, config, canGrant, adAvailable, onGrant, onPlayAgain, onExit }: PausedOverlayProps) {
  const action = getPauseAction(reason);
  const flameScale = useSharedValue(1);

  useEffect(() => {
    flameScale.value = withRepeat(withSequence(withTiming(1.1, { duration: 1100 }), withTiming(1, { duration: 1100 })), -1, false);
  }, [flameScale]);

  const flameAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + (flameScale.value - 1) * 4.5,
    transform: [{ scale: flameScale.value }],
  }));

  if (!action) return null;

  const { accent, secondaryAccent, mutedText, text, panel, border } = config.palette;

  return (
    <View style={styles.backdrop}>
      <View style={[styles.card, { backgroundColor: panel, borderColor: border }]}>
        <View style={styles.illustration}>
          <SteamWisp left="50%" delayMs={0} />

          <View style={styles.potWrap}>
            <View style={[styles.potHandle, styles.potHandleLeft, { backgroundColor: secondaryAccent }]} />
            <View style={[styles.potHandle, styles.potHandleRight, { backgroundColor: secondaryAccent }]} />
            <View style={[styles.potLid, { backgroundColor: secondaryAccent }]} />
            <View style={[styles.potBody, { backgroundColor: secondaryAccent }]} />
            <Animated.View style={[styles.potGlow, { backgroundColor: FLAME }, flameAnimatedStyle]} />
          </View>
        </View>

        <View style={styles.badgeRow}>
          <Text style={[styles.levelLabel, { color: accent }]}>LEVEL {levelIndex}</Text>
          {/* Non-interactive status display — the pause reason is a fact
              determined by which resource actually hit zero, not a player
              choice, so this is a plain View/Text pill with no onPress. */}
          <View style={[styles.statusPill, { borderColor: secondaryAccent }]}>
            <Text style={[styles.statusPillText, { color: secondaryAccent }]}>{movesRemaining} moves left</Text>
          </View>
        </View>

        <Text style={[styles.headline, { color: text }]}>The Pot&apos;s Still Warming</Text>
        {/* Calm copy either way — once the grant cap is reached the subtext
            gently closes the ad path rather than announcing a limit, keeping
            with this screen's "running out is a status, not an error" tone. */}
        <Text style={[styles.subtext, { color: mutedText }]}>
          {canGrant
            ? 'Out of moves for this round — no rush, it happens.'
            : 'That’s the last of the extra moves this round — start fresh whenever you’re ready.'}
        </Text>

        {canGrant ? (
          // The reserved warm-flame CTA — only shown while a grant is still on
          // offer. When it's gone, Play Again takes over as the primary action
          // below so the screen always has one clear way forward.
          <Pressable style={[styles.primaryButton, { backgroundColor: FLAME }]} onPress={() => onGrant(action.bonusAmount)}>
            <Text style={styles.primaryButtonLabel}>
              {adAvailable ? `Watch a video for ${action.bonusAmount} more moves` : `Get ${action.bonusAmount} more moves`}
            </Text>
          </Pressable>
        ) : (
          // Play Again promoted to the primary slot. Uses secondaryAccent (the
          // warm pot brown), not FLAME (reserved for the ad path) and not the
          // brand-red accent (no red anywhere on this screen, per above).
          <Pressable style={[styles.primaryButton, { backgroundColor: secondaryAccent }]} onPress={onPlayAgain}>
            <Text style={styles.primaryButtonLabel}>Play Again</Text>
          </Pressable>
        )}
        {/* Play Again stays a quiet secondary link only while the video CTA
            owns the primary slot; once it's promoted above, this row drops. */}
        {canGrant && (
          <Pressable style={styles.secondaryLink} onPress={onPlayAgain}>
            <Text style={[styles.secondaryLinkLabel, { color: text }]}>Play Again</Text>
          </Pressable>
        )}
        <Pressable style={styles.secondaryLink} onPress={onExit}>
          <Text style={[styles.secondaryLinkLabel, { color: text }]}>Exit to Kitchen</Text>
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
    paddingTop: 8,
    paddingBottom: 22,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  illustration: {
    width: '100%',
    height: 116,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  // A self-contained coordinate space for the pot (handles positioned
  // absolutely against this, not the whole 116px illustration box) — so
  // the handle/body/lid seam lines up exactly regardless of the
  // illustration container's own height.
  potWrap: {
    width: 140,
    height: 74,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  potHandle: {
    position: 'absolute',
    bottom: 30,
    width: 16,
    height: 10,
    borderRadius: 5,
  },
  potHandleLeft: {
    left: 8,
  },
  potHandleRight: {
    right: 8,
  },
  potLid: {
    width: 92,
    height: 10,
    borderRadius: 5,
    marginBottom: -3,
  },
  potBody: {
    width: 108,
    height: 46,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  // A soft warm glow beneath the pot standing in for the stove's flame —
  // reads as gentle warmth rather than a literal fire icon, matching
  // CLAUDE.md's calm-not-frantic constraint.
  potGlow: {
    width: 64,
    height: 12,
    borderRadius: 6,
    marginTop: -5,
    opacity: 0.55,
  },
  badgeRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  levelLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  statusPill: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  headline: {
    marginTop: 10,
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
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
    paddingHorizontal: 10,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButtonLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14.5,
    textAlign: 'center',
  },
  secondaryLink: {
    marginTop: 10,
    paddingVertical: 4,
  },
  secondaryLinkLabel: {
    fontWeight: '600',
    fontSize: 14,
    opacity: 0.85,
  },
});
