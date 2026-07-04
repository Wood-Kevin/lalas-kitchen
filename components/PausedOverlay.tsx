import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PauseReason } from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { getPauseAction } from './pauseActions';

export interface PausedOverlayProps {
  reason: PauseReason;
  config: SkinConfig;
  // Only 'moves' is grantable now — see pauseActions.ts's comment on why
  // the 'lives' branch was removed.
  onGrant: (amount: number) => void;
  // The exact same function Board.tsx passes to WonOverlay's onPlayAgain —
  // not a second implementation. Restarts this level fresh (new seed) so a
  // stuck player has a real way out that isn't the ad path.
  onPlayAgain: () => void;
  // Returns to Home. A stuck player shouldn't be forced to either watch an
  // ad or restart — leaving entirely is a third, equally real option.
  onExit: () => void;
}

// Placeholder pause UI — functionally correct (shows the right message and
// wires the right grant function per reason), not a final design. Recipe
// box / power-up / ad-watching presentation is out of scope for V1 per
// CLAUDE.md.
//
// Three actions, not one: the bonus grant button stays primary (existing
// ad-for-resource behavior, unchanged), with "Play again" and "Exit" added
// as equally-visible secondary options — mirrors WonOverlay's own
// primary/secondary button split so a stuck player is never funneled into
// the ad path just to get unstuck.
export function PausedOverlay({ reason, config, onGrant, onPlayAgain, onExit }: PausedOverlayProps) {
  const action = getPauseAction(reason);
  if (!action) return null;

  return (
    <View style={styles.backdrop}>
      <View style={[styles.card, { backgroundColor: config.palette.panel, borderColor: config.palette.accent }]}>
        <Text style={[styles.message, { color: config.palette.accent }]}>{action.message}</Text>
        <Pressable
          style={[styles.button, { backgroundColor: config.palette.accent }]}
          onPress={() => onGrant(action.bonusAmount)}
        >
          <Text style={styles.buttonLabel}>{action.buttonLabel}</Text>
        </Pressable>
        <Pressable style={[styles.secondaryButton, { borderColor: config.palette.accent }]} onPress={onPlayAgain}>
          <Text style={[styles.secondaryButtonLabel, { color: config.palette.accent }]}>Play again</Text>
        </Pressable>
        <Pressable style={[styles.secondaryButton, { borderColor: config.palette.accent }]} onPress={onExit}>
          <Text style={[styles.secondaryButtonLabel, { color: config.palette.accent }]}>Exit</Text>
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
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 32,
    alignItems: 'center',
    gap: 16,
  },
  message: {
    fontSize: 18,
    fontWeight: '700',
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  secondaryButton: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 2,
  },
  secondaryButtonLabel: {
    fontWeight: '700',
    fontSize: 14,
  },
});
