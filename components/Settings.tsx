import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from './AppText';
import { SkinConfig } from './skinConfig';
import { GinghamTrim } from './GinghamTrim';

export interface SettingsProps {
  config: SkinConfig;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  onToggleSound: (next: boolean) => void;
  onToggleHaptics: (next: boolean) => void;
  onBack: () => void;
}

// The dedicated settings screen (this session's explicit ask), replacing
// Home's own inline Sound/Haptics card. This is a real reversal of the
// build spec's original "not buried in a settings menu" note (see
// lalas-kitchen-build-spec.md) — reconciled, not ignored: the spec's actual
// concern was that muting sound should be quick and reachable, not that it
// must live directly on Home. A single tap from Home into this screen, with
// the toggle immediately visible with no further navigation, keeps that
// same "easy one-tap mute" property; only the screen it lives on changed.
// Structured exactly like RecipeBook.tsx (the other Home-reachable secondary
// screen): a back-arrow header, then plain cards below — no new navigation
// pattern invented for this one screen.
export function Settings({
  config,
  soundEnabled,
  hapticsEnabled,
  onToggleSound,
  onToggleHaptics,
  onBack,
}: SettingsProps) {
  const { accent, panel, border, text, background } = config.palette;

  return (
    <View style={[styles.container, { backgroundColor: background[0] }]}>
      <GinghamTrim accentColor={accent} panelColor={panel} height={12} />

      <View style={styles.header}>
        <Pressable
          style={[styles.backButton, { backgroundColor: panel, borderColor: border }]}
          onPress={onBack}
          accessibilityLabel="Back to home"
        >
          <Text style={[styles.backArrow, { color: text }]} allowFontScaling={false}>
            ‹
          </Text>
        </Pressable>
        <Text style={[styles.title, { color: accent }]}>Settings</Text>
      </View>

      <View style={[styles.card, { backgroundColor: panel, borderColor: border }]}>
        <View style={styles.cardPadding}>
          <View style={styles.toggleRow}>
            <Text style={[styles.rowTitle, { color: text }]}>Sound</Text>
            <Switch
              value={soundEnabled}
              onValueChange={onToggleSound}
              trackColor={{ false: border, true: accent }}
            />
          </View>
          <View style={styles.toggleRow}>
            <Text style={[styles.rowTitle, { color: text }]}>Haptics</Text>
            <Switch
              value={hapticsEnabled}
              onValueChange={onToggleHaptics}
              trackColor={{ false: border, true: accent }}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: -2,
  },
  title: {
    fontSize: 23,
    fontWeight: '700',
    lineHeight: 26,
  },
  card: {
    marginHorizontal: 20,
    marginTop: 16,
    borderWidth: 1.5,
    borderRadius: 22,
    overflow: 'hidden',
  },
  cardPadding: {
    padding: 18,
    gap: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowTitle: {
    fontSize: 19,
    fontWeight: '700',
  },
});
