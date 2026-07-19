import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from './AppText';
import { CrashRecord } from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { GinghamTrim } from './GinghamTrim';

const PRIVACY_POLICY_URL = 'https://lalas-kitchen.vercel.app/';

// The single source of truth for the app version is app.json's expo.version
// (what EAS stamps into every store build) — read directly rather than
// duplicated as a string literal here, so a release's version bump can never
// drift from what this screen reports. This label exists for field support:
// the one real player's phone is remote, and "what version is she on?" needs
// to be answerable by glancing at Settings, not by connecting a debugger.
const APP_VERSION: string = require('../app.json').expo.version;

// Opens in the device's default browser, never an in-app webview — matches
// this project's existing "leave the app to do platform things" convention
// (e.g. the AdMob rewarded-ad flow hands off to the OS/SDK rather than
// rendering its own player chrome). A failed open is a real, if rare,
// system-boundary error (no browser available, malformed URL) worth
// surfacing per CLAUDE.md's no-silent-failures rule, not something that
// can be validated away in advance.
function openPrivacyPolicy() {
  Linking.openURL(PRIVACY_POLICY_URL).catch((error) => {
    console.error('[Settings] failed to open the privacy policy URL:', error);
  });
}

export interface SettingsProps {
  config: SkinConfig;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  onToggleSound: (next: boolean) => void;
  onToggleHaptics: (next: boolean) => void;
  // The last uncaught crash ErrorBoundary recorded, if any (see
  // engine/gameState.ts's recordCrash) — undefined for the common case
  // where nothing has ever crashed. This is the lightest real telemetry
  // signal this project has: no remote crash-reporting service exists (see
  // DEFERRED_COMPLEXITY.md), so this is only ever seen by someone who
  // physically opens this screen on the actual device.
  lastCrash?: CrashRecord;
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
  lastCrash,
  onBack,
}: SettingsProps) {
  const { accent, panel, border, text, mutedText, background } = config.palette;

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

      {/* Scrollable below the fixed header, same reasoning and same
          ScrollView convention as Home.tsx's own fix (see that file's
          comment): a plain, non-scrolling column of cards can't be reached
          past whatever a genuinely short viewport cuts off — an iPadOS
          compatibility/windowed instance of this iPhone-only app can be far
          shorter than any real iPhone this was tested against (see
          CLAUDE.md's iOS-device-family entry). Settings isn't the
          guaranteed first screen the way Home is, but the same structural
          gap existed here, so it gets the same fix for the same reason. */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
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

        <View style={[styles.card, { backgroundColor: panel, borderColor: border }]}>
          <Pressable
            style={styles.cardPadding}
            onPress={openPrivacyPolicy}
            accessibilityRole="link"
            accessibilityLabel="Privacy Policy — opens in your browser"
          >
            <View style={styles.toggleRow}>
              <Text style={[styles.rowTitle, { color: text }]}>Privacy Policy</Text>
              <Text style={[styles.linkArrow, { color: mutedText }]} allowFontScaling={false}>
                ›
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Only ever rendered if a crash actually happened — the common case
            is this section simply doesn't exist. Worded calmly (per CLAUDE.md's
            Design Constraints) rather than as an alarming error dialog, since
            the one real player this screen is for isn't a developer; the raw
            message/timestamp is still shown, in muted small text, so whoever
            built this game can actually use it as a real signal if they check. */}
        {lastCrash && (
          <View style={[styles.card, { backgroundColor: panel, borderColor: border }]}>
            <View style={styles.cardPadding}>
              <Text style={[styles.rowTitle, { color: text }]}>A technical hiccup</Text>
              <Text style={[styles.crashNote, { color: mutedText }]}>
                Safe to ignore — this just helps with fixing things later.
              </Text>
              <Text style={[styles.crashDetail, { color: mutedText }]}>
                {new Date(lastCrash.timestamp).toLocaleString()} — {lastCrash.message}
              </Text>
            </View>
          </View>
        )}

        <Text style={[styles.versionLabel, { color: mutedText }]}>Version {APP_VERSION}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
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
  linkArrow: {
    fontSize: 22,
    fontWeight: '700',
  },
  crashNote: {
    fontSize: 13,
    marginTop: 4,
  },
  crashDetail: {
    // 12pt legibility floor (1.0.1 pass) — see LevelMap.tsx's captionText.
    fontSize: 12,
    marginTop: 8,
  },
  versionLabel: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
