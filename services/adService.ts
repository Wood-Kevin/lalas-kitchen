// The one interface the rest of the game calls, never knowing or caring
// which real ad provider (or stub) answers it. Both methods resolve a plain
// boolean — "did the player actually earn/see this" — so a caller's own
// grant logic (engine/gameState.ts's grantBonusMoves, appPersistence.ts's
// grantInstantLife) stays exactly as simple as it is today; this interface
// doesn't presume anything about reward amount or ad-unit ids, keeping the
// real per-provider ad-unit configuration inside each adapter, not here.
export interface AdService {
  // true = the player watched to completion and earned the reward; false =
  // dismissed early / failed to load. Every current caller only ever grants
  // on true.
  requestRewardedAd(): Promise<boolean>;
  // true = a banner was shown. Stubbed and unwired today — no banner-ad UI
  // exists in the game yet — kept alongside requestRewardedAd so the
  // interface is ready the moment one is built, not bolted on later.
  requestBannerAd(): Promise<boolean>;
  // Synchronous, UI-facing: will requestRewardedAd() actually gate on a real
  // ad right now, or will it grant for free because no ad exists to show
  // this phase (see crazyGamesAdService.ts's CrazyGames Basic Launch gap)?
  // A plain getter, not async, since callers need it to choose button copy
  // before the player taps anything — awaiting a promise just to render a
  // label would mean a loading flicker for no reason. The real mobile
  // adapter is always true (mobile ads work from day one); crazyGamesAdService
  // reflects its own build-time monetization flag.
  isRewardedAdAvailable(): boolean;
}

// Picks between two already-constructed services for a given platform.
// Takes them as plain params rather than importing the real adapters
// directly (services/defaultAdService.ts's job) — the real mobile adapter
// (services/expoGoogleMobileAdsService.ts) transitively imports
// 'react-native' via react-native-google-mobile-ads, which fails to parse
// under this repo's plain ts-jest config, the same limitation
// services/hapticsService.ts's selectHapticsService already documents for
// expo-haptics. Keeping the real import out of this file (and out of any
// test) means this factory function stays safely testable with fakes.
export function selectAdService(platformOS: string, mobileService: AdService, webService: AdService): AdService {
  return platformOS === 'web' ? webService : mobileService;
}
