import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Objective } from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { getWonSummary } from './wonActions';

export interface WonOverlayProps {
  objective: Objective;
  config: SkinConfig;
  // Replays this same level with a new seed — see Board.tsx's
  // handlePlayAgain, unchanged by the level-queue work below.
  onPlayAgain: () => void;
  // Advances to the next level — hand-built while the queue lasts, then
  // generator-driven indefinitely (see appPersistence.ts's
  // buildGeneratedLevelConfig), so this always has somewhere to go and the
  // label is always "Next Level" — no more "View Dashboard" fallback state.
  onNext: () => void;
  // Routes to the level-select dashboard instead of continuing — the
  // dashboard's own escape hatch back into a board (see
  // components/Dashboard.tsx's onPlayLevel) is what makes this a real
  // detour rather than a dead end.
  onOpenDashboard: () => void;
}

// Mirrors PausedOverlay.tsx's card/backdrop structure — same placeholder
// tier of polish, not a final celebration design (no confetti/animation
// yet, per this session's explicit scope). The backdrop tint is
// deliberately different from PausedOverlay's neutral dark scrim (a warm
// wash here vs. plain black there) specifically so a win doesn't read as
// visually identical to "out of moves, want to keep going" — see
// DEFERRED_COMPLEXITY.md's now-resolved "no won celebration UI" entry.
//
// Three distinct actions: "Next Level" moves the player forward
// (indefinitely, past the hand-built queue); "Play again" replays the
// level just won; "Levels" is a deliberate detour to the dashboard, not an
// end state — that's what used to leave players stuck once the hand-built
// queue ran out. Deliberately not merged into one action — see this
// session's win-flow design decision.
export function WonOverlay({ objective, config, onPlayAgain, onNext, onOpenDashboard }: WonOverlayProps) {
  const summary = getWonSummary(objective);

  return (
    <View style={styles.backdrop}>
      <View style={[styles.card, { backgroundColor: config.palette.panel, borderColor: config.palette.accent }]}>
        <Text style={[styles.message, { color: config.palette.accent }]}>{summary.message}</Text>
        <Text style={[styles.detail, { color: config.palette.accent }]}>{summary.detail}</Text>
        <Pressable style={[styles.button, { backgroundColor: config.palette.accent }]} onPress={onNext}>
          <Text style={styles.buttonLabel}>Next Level</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, { borderColor: config.palette.accent }]}
          onPress={onPlayAgain}
        >
          <Text style={[styles.secondaryButtonLabel, { color: config.palette.accent }]}>Play again</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, { borderColor: config.palette.accent }]}
          onPress={onOpenDashboard}
        >
          <Text style={[styles.secondaryButtonLabel, { color: config.palette.accent }]}>Levels</Text>
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
