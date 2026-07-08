// Pure logic backing components/ErrorBoundary.tsx, kept in its own
// react-native-free file so it's directly testable — see
// components/errorRecovery.test.ts. Confirmed directly (not assumed):
// importing 'react-native' fails to parse under this repo's plain ts-jest
// config, the same limitation services/hapticsService.ts's own comment
// documents for expo-haptics — so ErrorBoundary.tsx itself (which imports
// Pressable/StyleSheet/Text/View) can only ever be verified live, matching
// this project's standing "this project has no React component-test infra"
// convention (see stuckHintTiming.ts/pauseActions.ts/wonActions.ts for the
// same pattern elsewhere).

export interface ErrorRecoveryState {
  hasError: boolean;
  // Bumped on "Start Fresh" and used as the wrapped tree's own `key` prop —
  // see nextResetState's own comment for why this, not just clearing
  // hasError, is what actually recovers the app.
  resetKey: number;
}

export const INITIAL_ERROR_RECOVERY_STATE: ErrorRecoveryState = { hasError: false, resetKey: 0 };

// getDerivedStateFromError's real return value — a crash always flips
// hasError, never touches resetKey (only "Start Fresh" advances that).
export function erroredRecoveryState(): Pick<ErrorRecoveryState, 'hasError'> {
  return { hasError: true };
}

// handleReset's real computation. Bumping resetKey (rather than just
// clearing hasError) forces a genuinely fresh mount of the entire wrapped
// tree on "Start Fresh" — merely clearing hasError would hand the SAME
// props/state that caused the crash straight back to the same component
// instances, which would likely throw again immediately. A fresh mount
// re-runs App's own loadSave from scratch, the same real path a cold app
// launch already takes (now itself hardened against a corrupted save — see
// engine/gameState.ts's loadSave).
export function nextResetState(current: ErrorRecoveryState): ErrorRecoveryState {
  return { hasError: false, resetKey: current.resetKey + 1 };
}

// componentDidCatch's real log line, as a plain function so the exact
// message/args are testable without needing to spy through a react-native
// import. No crash-reporting service is wired into this project yet (see
// DEFERRED_COMPLEXITY.md) — console.error is the one real signal that
// reaches a developer connected to this device/simulator, matching
// CLAUDE.md's "no silent failures" rule for this stack. This is the
// opposite of a silent catch: the error is genuinely surfaced, just not yet
// to a remote service that doesn't exist.
export function describeCaughtError(error: Error, componentStack: string | null | undefined): unknown[] {
  return ['[ErrorBoundary] Unexpected crash, recovering to a fresh app state:', error, componentStack];
}
