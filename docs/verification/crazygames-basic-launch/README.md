# CrazyGames Basic Launch gap — live verification

Both grant flows were driven against the **real, running** Expo web app
(`expo start --web`) over CDP, using the same `?harness=paused-grant` gate
and `localStorage` save-patch technique as the original ad-service
verification (`docs/verification/ad-service/`), exercised once with
`crazyGamesAdService.ts`'s `CRAZY_GAMES_MONETIZATION_ENABLED` at its real
value (`false`, today's actual Basic Launch state) and once with it
temporarily flipped to `true` to simulate Full Launch. Both the harness gate
and the flag flip were reverted after capture.

## Ads unavailable (`CRAZY_GAMES_MONETIZATION_ENABLED = false`, today's real state)

**Moves grant.** Forced `movesRemaining: 0`, `status: 'paused_awaiting_input'` on a live Level 1 board. `PausedOverlay` came up:

```
Moves
0
...
Get 5 more moves
```

No "watch a video" wording — the free-grant copy, confirming `Board.tsx`'s `adAvailable={adService.isRewardedAdAvailable()}` correctly read `false`. Clicking it (a real DOM click via CDP) drove `handleGrant` → `await adService.requestRewardedAd()` (the disabled branch, resolving `true` immediately with no ad attempted) → `grantBonusMoves`. Read back from the live DOM afterward:

```
Moves
5
```

The overlay dismissed and the board resumed play — the full reward, granted for free, with no request that could fail.

**Lives grant.** Patched the persisted save's `lives` to `0` in `localStorage`, reloaded, and reached the real `OutOfLives` screen via "Start cooking":

```
Lives refill over time, up to 5. Come back soon, or get a full refill now.
...
Refill your lives
```

Clicking it drove `handleGrantLife` → `await adService.requestRewardedAd()` (same disabled branch) → `grantInstantLife` → `saveProgress`. The persisted save, read back from `localStorage` after the click:

```json
before: {"lives":0, ...}
after:  {"lives":5, ...}
```

## Ads available (`CRAZY_GAMES_MONETIZATION_ENABLED = true`, simulating Full Launch)

Repeating both flows with the flag flipped: `PausedOverlay` showed "Watch a video for 5 more moves" and `OutOfLives` showed "Watch a video to refill your lives" (with the subtext reverting to mention a video too) — matching `adMobAdService`'s unconditional-`true` `isRewardedAdAvailable()` exactly, confirmed against the same copy `Board.tsx`/`App.tsx` render for mobile. The grant itself still succeeds (both are still stubs, per `DEFERRED_COMPLEXITY.md` — no real SDK wired in on either platform), only the copy and the code path taken (`crazyGamesAdService.ts`'s enabled branch, structurally identical to `adMobAdService`'s real-ad-request path) differ.

## What this confirms

- The CrazyGames adapter's phase awareness is entirely internal (`createCrazyGamesAdService`'s `monetizationEnabled` branch) — no call site changed its grant logic, matching the session's explicit "build on the interface, not a parallel system" instruction.
- Flipping one build-time flag correctly and immediately switches both the button copy (via the new `isRewardedAdAvailable()`) and the underlying grant path, on both of the game's two real grant flows, with no other code change required.
- The disabled-phase grant is a genuine full reward, not a degraded one — verified against the real persisted save, not just on-screen state, the same standard `docs/verification/ad-service/` set.

`services/crazyGamesAdService.test.ts` covers both phases at the unit level directly via the factory, deterministically, without needing a live harness for every future check — this live pass is to confirm the *actual UI and persistence* wiring, not the branch logic itself.
