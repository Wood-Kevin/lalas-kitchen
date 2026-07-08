# Real AdMob SDK — investigation record (no live device available)

Unlike every other feature this project verifies over CDP against a real
running web app, `react-native-google-mobile-ads` is a native module — it
only runs inside a real native build (EAS or a local `expo prebuild` + `expo
run:ios`/`run:android`) on a real device or simulator. **None of those exist
in this environment.** This doc records what WAS directly confirmed, and
draws an explicit line at what wasn't, rather than claiming a live
verification that didn't happen.

## What was confirmed by direct investigation

- **Google's demo App/ad-unit ids are real and current**, fetched directly
  from Google's own documentation rather than recalled from memory:
  - `developers.google.com/admob/android/test-ads` → rewarded test ad unit
    id `ca-app-pub-3940256099942544/5224354917`
  - `developers.google.com/admob/ios/test-ads` → rewarded test ad unit id
    `ca-app-pub-3940256099942544/1712485313`
  - Separately confirmed via targeted web search (not the same page as the
    ad-unit ids above): the test App IDs `ca-app-pub-3940256099942544~3347511713`
    (Android) and `ca-app-pub-3940256099942544~1458002511` (iOS), which go in
    `app.json`'s config plugin (`androidAppId`/`iosAppId`), a distinct field
    from the ad-unit id used in code.
  - The actual code in `services/expoGoogleMobileAdsService.ts` uses the
    library's own exported `TestIds.REWARDED` rather than a hardcoded
    literal, so the library's own platform dispatch resolves the correct
    per-platform id — the fetched values above were used to confirm that
    constant resolves to something real, not copied into the source.
- **The event-driven load/show API shape matches the library's own official
  docs and source**, fetched directly rather than assumed: `RewardedAd
  .createForAdRequest`, `.load()`/`.show()`, `RewardedAdEventType.LOADED`/
  `EARNED_REWARD`, and `AdEventType.CLOSED`/`ERROR` (the latter two confirmed
  against the library's own GitHub source, since the general docs page for
  displaying ads only showed the LOADED/EARNED_REWARD half of the pattern).
- **The module genuinely fails to parse under this repo's ts-jest config** —
  confirmed directly with a throwaway test file importing it, which threw
  the exact same Flow-syntax `SyntaxError` a bare `'react-native'` import
  does (it transitively requires `react-native`). This is what justified the
  `hapticsService.ts`-style split (`adService.ts`'s `selectAdService` now
  takes injected params; the real adapter lives in a file no test imports).
- **The rest of the test suite is unaffected**: 583 tests passing, no
  regressions in any file that doesn't touch the ad service directly.
- **`npx expo install react-native-google-mobile-ads` fails** the identical
  way `expo-haptics`/`expo-audio` did in earlier sessions (`EALLOWSCRIPTS`) —
  installed instead via a manually pinned `npm install
  react-native-google-mobile-ads@16.4.0`, matching established precedent.

## What was NOT confirmed — disclosed, not assumed

- That a real rewarded ad actually loads and displays on a real device or
  simulator.
- That the event sequence (`LOADED` → `show()` → `EARNED_REWARD` →
  `CLOSED`) fires in the order and shape expected in real practice, not just
  in the documented API.
- That the Expo config plugin (`app.json`'s `androidAppId`/`iosAppId`)
  correctly threads the App ID into a real native build's manifest/Info.plist
  — no `ios/` native project exists in this repo yet, and the existing
  `android/` project has not been rebuilt against this app.json change.

Revisit once a real device/build is available — the same standing gap this
project already discloses for the real-audio-backend, background-music-loop,
and safety-hardening entries.
