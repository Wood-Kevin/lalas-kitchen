import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  describeCaughtError,
  ErrorRecoveryState,
  erroredRecoveryState,
  INITIAL_ERROR_RECOVERY_STATE,
  nextResetState,
} from './errorRecovery';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

// The one place in the whole app that turns an otherwise-uncaught render
// error into a calm, recoverable screen instead of a silent, permanent blank
// one — see engine/DECISIONS.md's error-boundary entry. Before this, ANY
// unexpected crash (this session's own hardening work included, if it had a
// bug) had no catch anywhere above it: React would unmount the whole tree
// and the player would be left looking at nothing, with no signal to
// anyone — including the developer — that anything had gone wrong at all.
//
// React only exposes this mechanism via a class component's
// getDerivedStateFromError/componentDidCatch — there is no hook equivalent —
// so this is deliberately the one class component in an otherwise
// all-function-component tree. The actual recovery logic lives in
// components/errorRecovery.ts (a plain, react-native-free module) rather
// than inline here, since importing 'react-native' fails to parse under
// this project's ts-jest config (confirmed directly, the same limitation
// services/hapticsService.ts documents for expo-haptics) — this class
// itself can only ever be verified live, but its actual logic is unit
// tested via that module.
//
// Deliberately does NOT import SkinConfig or anything from skins/: this
// component's entire job is to still work when something ELSE in the app is
// broken, which could plausibly include the skin config itself (a bad
// config.json, a missing sprite registry entry that throws instead of
// falling back). Reading from the very config that might be the thing
// that's crashing would defeat the point, so its palette is a small, fixed
// set of colors matching lalas-kitchen's own today (see config.json) rather
// than a prop or an import — a deliberate, narrow exception to this
// project's usual "components read from skin config" rule, not an oversight.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorRecoveryState> {
  state: ErrorRecoveryState = INITIAL_ERROR_RECOVERY_STATE;

  static getDerivedStateFromError(): Partial<ErrorRecoveryState> {
    return erroredRecoveryState();
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(...describeCaughtError(error, info.componentStack));
  }

  handleReset = (): void => {
    this.setState((current) => nextResetState(current));
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.headline}>Something went wrong</Text>
          <Text style={styles.subtext}>No progress has been lost. Let&apos;s start fresh.</Text>
          <Pressable onPress={this.handleReset} style={styles.button} testID="error-boundary-reset">
            <Text style={styles.buttonLabel}>Start Fresh</Text>
          </Pressable>
        </View>
      );
    }
    // eslint-disable-next-line react/jsx-key -- resetKey is applied to the
    // Fragment itself via the `key` prop below, not a list item.
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#F6D9A8',
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2B211A',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtext: {
    fontSize: 15,
    color: '#6E5C49',
    marginBottom: 24,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#A83A2E',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 24,
  },
  buttonLabel: {
    color: '#FBF3E1',
    fontSize: 16,
    fontWeight: '700',
  },
});
