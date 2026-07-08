import { createCrazyGamesAdService } from './crazyGamesAdService';

describe('CrazyGames Basic Launch (monetization disabled)', () => {
  const service = createCrazyGamesAdService(false);

  test('grants the rewarded-ad reward for free instead of gating on a request that cannot succeed', async () => {
    await expect(service.requestRewardedAd()).resolves.toBe(true);
  });

  test('reports no banner to show', async () => {
    await expect(service.requestBannerAd()).resolves.toBe(false);
  });

  test('reports the rewarded ad as unavailable, so callers can adjust their copy', () => {
    expect(service.isRewardedAdAvailable()).toBe(false);
  });
});

describe('CrazyGames Full Launch (monetization enabled)', () => {
  const service = createCrazyGamesAdService(true);

  // This stub's own Full Launch path just resolves true/true, unconditionally
  // — the same shape the real mobile adapter's requestRewardedAd/
  // requestBannerAd resolve on success (see services/
  // expoGoogleMobileAdsService.ts, not importable here since it transitively
  // pulls in 'react-native' — see adService.test.ts's own fakeService()
  // comment for why).
  test('requires the real ad request once monetization is enabled', async () => {
    await expect(service.requestRewardedAd()).resolves.toBe(true);
  });

  test('shows a banner once monetization is enabled', async () => {
    await expect(service.requestBannerAd()).resolves.toBe(true);
  });

  test('reports the rewarded ad as available', () => {
    expect(service.isRewardedAdAvailable()).toBe(true);
  });
});
