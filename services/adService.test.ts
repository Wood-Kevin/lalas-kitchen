import { AdService, selectAdService } from './adService';
import { crazyGamesAdService } from './crazyGamesAdService';

// Deliberately never imports services/expoGoogleMobileAdsService.ts here
// (it transitively imports 'react-native' via react-native-google-mobile-
// ads, which fails to parse under this repo's plain ts-jest config) —
// selectAdService takes its mobile/web services as plain params
// specifically so this factory logic is testable with fakes. See
// adService.ts and services/defaultAdService.ts, mirroring
// hapticsService.test.ts's own fakeService() pattern.
function fakeService(): AdService {
  return {
    requestRewardedAd: async () => true,
    requestBannerAd: async () => true,
    isRewardedAdAvailable: () => true,
  };
}

describe('selectAdService', () => {
  test('resolves to the web service on web', () => {
    const mobileService = fakeService();
    const webService = fakeService();
    expect(selectAdService('web', mobileService, webService)).toBe(webService);
  });

  test('resolves to the mobile service on every non-web platform', () => {
    const mobileService = fakeService();
    const webService = fakeService();
    expect(selectAdService('ios', mobileService, webService)).toBe(mobileService);
    expect(selectAdService('android', mobileService, webService)).toBe(mobileService);
  });
});

describe("CrazyGames' stub behavior (the real mobile adapter is verified live only — see docs/verification/real-admob-sdk/)", () => {
  test("banner reflects today's real Basic Launch state (no banner to show)", async () => {
    // See crazyGamesAdService.test.ts for both phases exercised directly.
    await expect(crazyGamesAdService.requestBannerAd()).resolves.toBe(false);
  });

  test("isRewardedAdAvailable reflects today's real Basic Launch state (disabled)", () => {
    // See crazyGamesAdService.test.ts for both phases exercised directly via
    // the factory — this just confirms the exported singleton matches
    // today's actual CRAZY_GAMES_MONETIZATION_ENABLED flag.
    expect(crazyGamesAdService.isRewardedAdAvailable()).toBe(false);
  });
});
