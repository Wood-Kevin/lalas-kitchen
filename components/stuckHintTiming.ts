// Pure timer-reset logic for the calm stuck-player hint (see Board.tsx): a
// gentle glow on a real legal move, shown only after roughly 8 seconds of
// genuine player inactivity — not a tutorial, not a nudge to keep someone
// engaged, just removing friction for a player who plays to relax and might
// get stuck scanning the board (see CLAUDE.md's calm-not-frantic constraint).
//
// This project has no React component-rendering test harness (see CLAUDE.md's
// Testing Philosophy — everything testable is a pure function). Board.tsx's
// OTHER timers (snap-back, cascade steps) are wired directly with
// setTimeout/useEffect and verified only via live capture. The one piece of
// this feature genuinely worth pinning down in a test file is the reset
// SEMANTICS themselves — "the moment a player actually makes a move, does the
// old countdown really get cancelled, and does a fresh one really get armed"
// — so that's extracted here as a schedule/cancel-injected pure function,
// the same injected-primitive pattern engine/gameState.ts's spawnPiece/now
// already use for the same reason.

// Cancels whatever timer handle is currently pending (if any) via `cancel`,
// then — only if `shouldArm` — starts a fresh one via `schedule`, returning
// its handle (or null if not armed). Called by Board.tsx every time a real
// player move commits (or is rejected), and every time the "can a move even
// be made right now" gate changes (an overlay opens/closes, a tutorial
// dismisses, the level ends) — so a fresh idle window always starts from
// genuine quiet, never from whatever was left over before the last swap.
export function resetIdleHintTimer<T>(
  previousHandle: T | null,
  shouldArm: boolean,
  schedule: () => T,
  cancel: (handle: T) => void
): T | null {
  if (previousHandle !== null) cancel(previousHandle);
  return shouldArm ? schedule() : null;
}
