import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PauseReason } from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { getPauseAction } from './pauseActions';

export interface PausedOverlayProps {
  reason: PauseReason;
  config: SkinConfig;
  onGrant: (resource: 'moves' | 'lives', amount: number) => void;
}

// Placeholder pause UI — functionally correct (shows the right message and
// wires the right grant function per reason), not a final design. Recipe
// box / power-up / ad-watching presentation is out of scope for V1 per
// CLAUDE.md.
export function PausedOverlay({ reason, config, onGrant }: PausedOverlayProps) {
  const action = getPauseAction(reason);
  if (!action) return null;

  return (
    <View style={styles.backdrop}>
      <View style={[styles.card, { backgroundColor: config.palette.panel, borderColor: config.palette.accent }]}>
        <Text style={[styles.message, { color: config.palette.accent }]}>{action.message}</Text>
        <Pressable
          style={[styles.button, { backgroundColor: config.palette.accent }]}
          onPress={() => onGrant(action.resource, action.bonusAmount)}
        >
          <Text style={styles.buttonLabel}>{action.buttonLabel}</Text>
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
});
