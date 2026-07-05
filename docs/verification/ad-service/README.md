# Ad/monetization abstraction — live verification

Both existing "watch a video" flows were driven against the **real, running**
Expo web app (`expo start --web`) over CDP, using a temporary harness gate in
`Board.tsx` (`?harness=paused-grant`, reverted immediately after capture — the
same "temporary `?harness=…` gate, reverted after" technique this repo's
denial-spread/dev-reset/powder-animation verifications already used) to reach
the moves-grant overlay without grinding through a real level's moves. The
lives-grant flow needed no harness — it's reachable by the real persisted
`lives` value alone.

## Moves-grant (`Board.tsx`'s `handleGrant` → `services/defaultAdService.ts`'s `adService` → `engine/gameState.ts`'s `grantBonusMoves`)

Forced `movesRemaining: 0`, `status: 'paused_awaiting_input'`, `pauseReason: 'moves'` on a live Level 1 board. The real `PausedOverlay` came up:

```
Moves
0
...
Watch a video for 5 more moves
```

Clicking it (a real DOM click dispatched through CDP, not a simulated function call) drove the actual `handleGrant` → `await adService.requestRewardedAd()` (the real `Platform.OS === 'web'`-selected CrazyGames stub, resolving `true`) → `grantBonusMoves` path. Result, read back from the live DOM:

```
Moves
5
```

The pause overlay dismissed and the board became interactive again — exactly the pre-abstraction behavior, now routed through the real interface.

## Lives-grant (`App.tsx`'s `handleGrantLife` → `services/defaultAdService.ts`'s `adService` → `appPersistence.ts`'s `grantInstantLife`)

Patched the real persisted save directly in `localStorage` (`lalas-kitchen:save:cooking-lalas-kitchen`) to `lives: 0`, reloaded the app, and clicked "Start cooking" — routing to the real `OutOfLives` screen (`canStartLevel` gating):

```
Next life in 27:20
Watch a video to refill your lives
```

Clicking it drove `handleGrantLife` → `await adService.requestRewardedAd()` (same real CrazyGames stub) → `grantInstantLife` → `saveProgress`. Read back the actual persisted save from `localStorage` after the click:

```json
before: {"lives":0, ...}
after:  {"lives":5, ...}
```

The screen updated to "Lives are full" and the save file itself — not just the UI — shows the full refill, confirming the persistence path (not just the on-screen state) went through correctly.

## What this confirms

- Both flows still instantly grant, unchanged from their pre-abstraction behavior — the refactor moved *where* the grant decision is made (behind `adService.requestRewardedAd()`), not *what* it does today.
- The real singleton (`services/defaultAdService.ts`'s `adService = selectAdService(Platform.OS)`) correctly resolved to the CrazyGames stub in an actual browser (`Platform.OS === 'web'`), not just in the unit test's parameterized `selectAdService('web')` check.
- Both handlers' `async`/`await` conversion doesn't introduce any visible delay or broken state — the stub resolves on the same tick for all practical purposes.

The AdMob/native path (`Platform.OS !== 'web'`) has no simulator available in this sandbox to drive live the same way; it's covered by `services/adService.test.ts`'s `selectAdService('ios'|'android')` case and direct code reading only.
