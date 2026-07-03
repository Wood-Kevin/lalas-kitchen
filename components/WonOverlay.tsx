import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Objective } from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { getWonSummary } from './wonActions';

export interface WonOverlayProps {
  objective: Objective;
  config: SkinConfig;
  onPlayAgain: () => void;
}

// Mirrors PausedOverlay.tsx's card/backdrop structure — same placeholder
// tier of polish, not a final celebration design (no confetti/animation
// yet, per this session's explicit scope). The backdrop tint is
// deliberately different from PausedOverlay's neutral dark scrim (a warm
// wash here vs. plain black there) specifically so a win doesn't read as
// visually identical to "out of moves, want to keep going" — see
// DEFERRED_COMPLEXITY.md's now-resolved "no won celebration UI" entry.
export function WonOverlay({ objective, config, onPlayAgain }: WonOverlayProps) {
  const summary = getWonSummary(objective);

  return (
    <View style={styles.backdrop}>
      <View style={[styles.card, { backgroundColor: config.palette.panel, borderColor: config.palette.accent }]}>
        <Text style={[styles.message, { color: config.palette.accent }]}>{summary.message}</Text>
        <Text style={[styles.detail, { color: config.palette.accent }]}>{summary.detail}</Text>
        <Pressable style={[styles.button, { backgroundColor: config.palette.accent }]} onPress={onPlayAgain}>
          <Text style={styles.buttonLabel}>Play again</Text>
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
    backgroundColor: 'rgba(255, 200, 60, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 32,
    alignItems: 'center',
    gap: 12,
  },
  message: {
    fontSize: 20,
    fontWeight: '700',
  },
  detail: {
    fontSize: 15,
    fontWeight: '600',
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 4,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
});
