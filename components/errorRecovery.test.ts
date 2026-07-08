import {
  describeCaughtError,
  describeCrashRecord,
  erroredRecoveryState,
  INITIAL_ERROR_RECOVERY_STATE,
  nextResetState,
} from './errorRecovery';

describe('errorRecovery — the logic backing ErrorBoundary.tsx', () => {
  test('the initial state has no error and a resetKey of 0', () => {
    expect(INITIAL_ERROR_RECOVERY_STATE).toEqual({ hasError: false, resetKey: 0 });
  });

  test('erroredRecoveryState (getDerivedStateFromError) flips hasError, regardless of the error itself', () => {
    expect(erroredRecoveryState()).toEqual({ hasError: true });
  });

  test('nextResetState (Start Fresh) clears hasError and bumps resetKey by exactly one', () => {
    expect(nextResetState({ hasError: true, resetKey: 0 })).toEqual({ hasError: false, resetKey: 1 });
    expect(nextResetState({ hasError: true, resetKey: 4 })).toEqual({ hasError: false, resetKey: 5 });
  });

  // The resetKey must keep climbing across repeated crash/reset cycles —
  // otherwise a second crash after a first successful reset could reuse an
  // already-seen key and fail to force a genuinely fresh remount.
  test('nextResetState keeps advancing across repeated crash/reset cycles', () => {
    // Crash 1: getDerivedStateFromError flips hasError, resetKey untouched.
    let state = { ...INITIAL_ERROR_RECOVERY_STATE, ...erroredRecoveryState() };
    // Reset 1: "Start Fresh" clears hasError, bumps resetKey.
    state = nextResetState(state);
    expect(state).toEqual({ hasError: false, resetKey: 1 });

    // Crash 2, from this new resetKey — confirms the counter isn't reset by
    // a fresh crash, only ever advanced by a reset.
    state = { ...state, ...erroredRecoveryState() };
    state = nextResetState(state);
    expect(state).toEqual({ hasError: false, resetKey: 2 });
  });

  test('describeCaughtError surfaces the real error and component stack, not a swallowed/generic message', () => {
    const error = new Error('boom');
    const stack = 'in <Board> at App.tsx:227';

    const logged = describeCaughtError(error, stack);

    expect(logged[0]).toMatch(/ErrorBoundary/);
    expect(logged).toContain(error);
    expect(logged).toContain(stack);
  });

  test('describeCaughtError tolerates a missing component stack rather than throwing', () => {
    const error = new Error('boom');
    expect(() => describeCaughtError(error, undefined)).not.toThrow();
    expect(() => describeCaughtError(error, null)).not.toThrow();
  });

  test('describeCrashRecord captures the real message, folds in the component stack, and stamps the given timestamp', () => {
    const error = new Error('Cannot read properties of undefined');
    error.stack = 'Error: Cannot read properties of undefined\n    at foo (bar.ts:1:1)';
    const componentStack = '\n    in Board\n    in AppRoot';

    const record = describeCrashRecord(error, componentStack, 1700000000000);

    expect(record.message).toBe('Cannot read properties of undefined');
    expect(record.timestamp).toBe(1700000000000);
    expect(record.stack).toContain('at foo (bar.ts:1:1)');
    expect(record.stack).toContain('in Board');
  });

  test('describeCrashRecord tolerates a missing component stack and a missing error.stack', () => {
    const error = new Error('boom');
    delete (error as { stack?: string }).stack;

    const record = describeCrashRecord(error, undefined, 5);

    expect(record).toEqual({ message: 'boom', stack: undefined, timestamp: 5 });
  });

  test('describeCrashRecord falls back to a generic message rather than an empty string', () => {
    const error = new Error('');
    const record = describeCrashRecord(error, null, 1);
    expect(record.message).toBe('Unknown error');
  });
});
