# Bonus-moves grant cap — the video CTA disappears after 2 grants per attempt

`paused-grant-cap.png` verifies this session's change: the "watch a video for
more moves" grant, previously **unlimited**, is now capped at 2 per level
attempt (`MOVE_GRANTS_PER_ATTEMPT` in `components/pauseActions.ts`). The cap is
per-attempt — it resets to zero on every fresh start or restart (Play Again, or
re-entering the level from Home / All Levels), never a lifetime or daily limit.

## What the image shows

Two states of the **real** `PausedOverlay` component, side by side:

- **Left — grants left (1st / 2nd out-of-moves)** — `canGrant` is true, so the
  flame "Watch a video for 5 more moves" CTA is offered, with Play Again and
  Exit as quiet secondary links, exactly as before.
- **Right — cap reached (3rd out-of-moves, same attempt)** — `canGrant` is
  false: the video CTA is gone entirely. Play Again is promoted to the primary
  slot (in the warm `secondaryAccent` green, not the reserved flame or brand
  red), Exit to Kitchen stays, and the subtext changes to the calmer "That's the
  last of the extra moves this round — start fresh whenever you're ready." No
  failure language.

## How the image was produced

A throwaway harness (deleted after capture, per the WSL screenshot-verification
note) rendered the **real** `components/PausedOverlay.tsx` through
`react-native-web`'s server-side render in both `canGrant` states — driving the
actual `canGrant` conditional this change added, not a hand-mirror of it.
`react-native-reanimated` (the decorative flame pulse only) was stubbed to
no-ops for SSR; the palette is the real `skins/lalas-kitchen/config.json`
palette. Rendered to static HTML and captured with Windows Chrome headless
(`--screenshot`).

## Where the logic and tests live

- `components/pauseActions.ts` — `MOVE_GRANTS_PER_ATTEMPT` (= 2),
  `canGrantBonusMoves(grantsUsed)`, `nextBonusGrantsUsed(grantsUsed, event)`.
- `components/pauseActions.test.ts` — first two grants land, the third is
  blocked, and a restart resets the count to zero (all 217 suite tests pass).
- `components/Board.tsx` — `bonusGrantsUsed` per-attempt state: incremented in
  `handleGrant`, reset in `handlePlayAgain`, reset for free on remount.
- `components/PausedOverlay.tsx` — the `canGrant` prop that gates the CTA.
