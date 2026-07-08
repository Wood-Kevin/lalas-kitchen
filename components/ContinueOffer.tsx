import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { SkinConfig } from './skinConfig';
import { getPauseAction } from './pauseActions';
import { SteamWisp } from './SteamWisp';

export interface ContinueOfferProps {
  // Always the moves-exhausted count (0) — read from GameState rather than
  // hardcoded so the status pill stays honest, same reasoning as
  // PausedOverlay.tsx's own movesRemaining prop.
  movesRemaining: number;
  levelIndex: number;
  config: SkinConfig;
  // Whether tapping the continue button will actually show a real rewarded ad
  // right now (services/adService.ts's isRewardedAdAvailable()) — false
  // during CrazyGames' Basic Launch gap, when the grant is given for free
  // instead. Only changes the CTA's copy; the tap handler is identical.
  adAvailable: boolean;
  // Accepting the rescue: Board.tsx's handleGrant (ad, then +5 moves via
  // grantBonusMoves). Never spends a life — that's the entire point of this
  // screen existing separately from PausedOverlay.
  onContinue: (amount: number) => void;
  // Declining by restarting fresh. Distinct from PausedOverlay's own
  // onPlayAgain: Board.tsx wraps handlePlayAgain here so the life this
  // attempt owes is spent first (see Board.tsx's handleContinueDeclinePlayAgain).
  onPlayAgain: () => void;
  // Declining by leaving. Same wrapping reasoning as onPlayAgain above (see
  // Board.tsx's handleContinueDeclineExit).
  onExit: () => void;
}

// Same fixed brand accent PausedOverlay.tsx's old grant CTA used — kept
// here too so the "this is the ad-path rescue" visual language stays
// consistent between the two screens a player might see across an attempt.
const FLAME = '#F2793A';

// The fourth sibling in the WonOverlay/PausedOverlay/OutOfLives card family
// (see those files' own "mirrors" comments) — deliberately its own file
// rather than a mode of PausedOverlay, since the two screens now represent
// genuinely different moments: this one still has a life to save, PausedOverlay
// no longer does. Shown instead of PausedOverlay while
// pauseActions.ts's shouldOfferContinue is true; PausedOverlay takes over
// once it's false (grants exhausted, or this offer was just declined).
export function ContinueOffer({ movesRemaining, levelIndex, config, adAvailable, onContinue, onPlayAgain, onExit }: ContinueOfferProps) {
  const action = getPauseAction('moves')!;
  const flameScale = useSharedValue(1);

  useEffect(() => {
    flameScale.value = withRepeat(withSequence(withTiming(1.1, { duration: 1100 }), withTiming(1, { duration: 1100 })), -1, false);
  }, [flameScale]);

  const flameAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + (flameScale.value - 1) * 4.5,
    transform: [{ scale: flameScale.value }],
  }));

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
          <View style={[styles.statusPill, { borderColor: secondaryAccent }]}>
            <Text style={[styles.statusPillText, { color: secondaryAccent }]}>{movesRemaining} moves left</Text>
          </View>
        </View>

        <Text style={[styles.headline, { color: text }]}>One More Try?</Text>
        <Text style={[styles.subtext, { color: mutedText }]}>
          Out of moves for this round — keep it going with a few more, no life spent.
        </Text>

        <Pressable style={[styles.primaryButton, { backgroundColor: FLAME }]} onPress={() => onContinue(action.bonusAmount)}>
          <Text style={styles.primaryButtonLabel}>
            {adAvailable ? `Watch a video for ${action.bonusAmount} more moves` : `Get ${action.bonusAmount} more moves`}
          </Text>
        </Pressable>
        <Pressable style={styles.secondaryLink} onPress={onPlayAgain}>
          <Text style={[styles.secondaryLinkLabel, { color: text }]}>Play Again</Text>
        </Pressable>
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
