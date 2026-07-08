# Real CrazyGames SDK — verification (with one deliberate stopping point)

Verifies `engine/DECISIONS.md`'s "Real CrazyGames SDK" entry, and documents
a real web-bundle-breaking bug this work caught in the same session's
earlier AdMob change, plus the one point where live verification correctly
stopped rather than being worked around.

## What was confirmed by direct investigation

- **CrazyGames' local testing mode is real**, confirmed against
  `docs.crazygames.com` directly: on `localhost`/`127.0.0.1` (or via
  `?useLocalSdk=true`), the SDK runs in a `'local'` environment
  (`getEnvironment()`), showing a placeholder overlay for ad requests
  instead of a real ad — genuinely usable without a registered game
  listing.
- **SDK v3 is current** (v1/v2 are legacy), loaded via
  `https://sdk.crazygames.com/crazygames-sdk-v3.js`. Confirmed reachable
  directly from this environment: a plain page navigation to that URL
  returned real, minified SDK JavaScript (not blocked, not a 404).
- **The `requestAd('rewarded', { adStarted, adFinished, adError })` API
  shape and its documented error codes** (`adsDisabledBasicLaunch`,
  `unfilled`, `adblock`, `adCooldown`, `other`) were confirmed against the
  library's own docs, matching this project's pre-existing Basic Launch
  investigation.

## A real bug found live, not hypothetical

Attempting to reach the OutOfLives screen in the real running app (to test
this feature) returned a **blank white page**. Fetching the real Metro dev
server's own bundle URL directly showed the actual cause: a `500` response,
`{"message":"Metro has encountered an error: Importing native-only module
\"react-native/Libraries/Utilities/codegenNativeComponent\" on web from:
.../GoogleMobileAdsBannerViewNativeComponent.ts"}`. This session's own
earlier AdMob work (`services/defaultAdService.ts`) statically imported the
real `react-native-google-mobile-ads`-backed adapter unconditionally, and
Metro bundles that eagerly for every platform including web, regardless of
the runtime `Platform.OS` branch inside `selectAdService`.

**Fixed** by splitting `defaultAdService.ts` into `defaultAdService.native.ts`
(imports the real AdMob adapter) and `defaultAdService.web.ts` (imports only
`crazyGamesAdService`, with a defensive throwing stub in the unreachable
"mobile" slot) — Metro's own platform-extension resolution now picks the
right file per bundle, so the AdMob package's module graph never reaches a
web build. **Confirmed fixed**: re-fetching the identical bundle URL
afterward returned `200` and a real 5.4MB bundle, not the error blob.

## Live verification, and where it correctly stopped

With `CRAZY_GAMES_MONETIZATION_ENABLED` temporarily flipped to `true` (Board
web bundle rebuilt and reloaded first, to confirm the fix above), a crafted
`lives: 0` save routed to the real OutOfLives screen. `outoflives-ad-button.png`
— the real "Watch a video to refill your lives" button appears, confirming
`isRewardedAdAvailable()` correctly reads `true` once monetization is
enabled.

**The next step — tapping that button — was blocked by this environment's
own permission system**: the action would have the running app dynamically
inject and *execute* the live third-party CrazyGames SDK script inside the
page, an external code-execution action not pre-authorized for this
session. That block was respected, not worked around. This is a narrower,
different gap than AdMob's "no native device exists" limitation: the code
path, the API shape, and the script's real reachability are all confirmed;
only the single final in-app execution step is unconfirmed, and only
because a safety boundary correctly stopped it.

The temporary `CRAZY_GAMES_MONETIZATION_ENABLED = true` flip was reverted
immediately after this capture; the test save was cleared from
`localStorage`.

## Where the logic and tests live

- `services/crazyGamesAdService.ts` — `CrazyGamesSdk` interface,
  `loadCrazyGamesSdk` (the real script injector), `requestRealRewardedAd`,
  and `createCrazyGamesAdService`'s new injectable `loadSdk` param.
- `services/crazyGamesAdService.test.ts` — rewritten with a fake SDK
  (`fakeSdk`) and injected `loadSdk`: resolves true on `adFinished`,
  resolves false and logs on `adError`, gracefully grants for free if the
  SDK script itself fails to load, and confirms `loadSdk` is never called
  during Basic Launch.
- `services/defaultAdService.native.ts`/`defaultAdService.web.ts` — the
  Metro platform split fixing the web-bundle break.

Full suite: 585 tests passing.
