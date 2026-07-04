import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SkinConfig } from './skinConfig';

export interface OutOfLivesProps {
  config: SkinConfig;
  onBack: () => void;
}

// Minimal, honest placeholder — shown whenever a level-start attempt (Home's
// "Start cooking", an All Levels row, or either overlay's "Play again",
// reused via Board's own handlePlayAgain) is blocked at zero lives. No
// design polish, no regen countdown, no ad/IAP refill offer — those are
// real monetization surfaces out of scope for V1 per CLAUDE.md. The point
// this session is that the block is real and visible, not silently
// swallowed, not that it's polished.
export function OutOfLives({ config, onBack }: OutOfLivesProps) {
  return (
    <View style={[styles.container, { backgroundColor: config.palette.background[0] }]}>
      <View style={[styles.card, { backgroundColor: config.palette.panel, borderColor: config.palette.accent }]}>
        <Text style={[styles.message, { color: config.palette.accent }]}>Out of lives!</Text>
        <Text style={[styles.detail, { color: config.palette.mutedText }]}>
          Lives refill on their own over time. Come back soon.
        </Text>
        <Pressable style={[styles.button, { backgroundColor: config.palette.accent }]} onPress={onBack}>
          <Text style={styles.buttonLabel}>Back to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 28,
    alignItems: 'center',
    gap: 14,
  },
  message: {
    fontSize: 20,
    fontWeight: '700',
  },
  detail: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 10,
    marginTop: 4,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
});
