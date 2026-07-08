import { createCrazyGamesAdService, CrazyGamesSdk } from './crazyGamesAdService';

// A fake SDK + loader, injected via createCrazyGamesAdService's own loadSdk
// param — never touches a real `<script>` tag or network request. Mirrors
// the same injection pattern engine/gameState.ts's AsyncStorageLike uses.
function fakeSdk(onRequestAd: CrazyGamesSdk['ad']['requestAd']): CrazyGamesSdk {
  return { ad: { requestAd: onRequestAd } };
}

describe('CrazyGames Basic Launch (monetization disabled)', () => {
  test('grants the rewarded-ad reward for free instead of gating on a request that cannot succeed', async () => {
    const loadSdk = jest.fn();
    const service = createCrazyGamesAdService(false, loadSdk);
    await expect(service.requestRewardedAd()).resolves.toBe(true);
    // The whole point of the Basic Launch gate: never even attempt to load
    // the real SDK for a request that's doomed to fail.
    expect(loadSdk).not.toHaveBeenCalled();
  });

  test('reports no banner to show', async () => {
    const service = createCrazyGamesAdService(false);
    await expect(service.requestBannerAd()).resolves.toBe(false);
  });

  test('reports the rewarded ad as unavailable, so callers can adjust their copy', () => {
    const service = createCrazyGamesAdService(false);
    expect(service.isRewardedAdAvailable()).toBe(false);
  });
});

describe('CrazyGames Full Launch (monetization enabled) — real SDK request/response wrapping', () => {
  test('resolves true when the real SDK reports adFinished', async () => {
    const sdk = fakeSdk((type, callbacks) => {
      expect(type).toBe('rewarded');
      callbacks.adFinished?.();
    });
    const service = createCrazyGamesAdService(true, async () => sdk);
    await expect(service.requestRewardedAd()).resolves.toBe(true);
  });

  test('resolves false when the real SDK reports adError (unfilled, adblock, cooldown, or any other failure)', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const sdk = fakeSdk((_type, callbacks) => {
      callbacks.adError?.({ code: 'unfilled', message: 'no ad inventory' });
    });
    const service = createCrazyGamesAdService(true, async () => sdk);
    await expect(service.requestRewardedAd()).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  test('gracefully grants for free if the SDK script itself fails to load, rather than leaving the player stuck', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = createCrazyGamesAdService(true, async () => {
      throw new Error('script failed to load');
    });
    await expect(service.requestRewardedAd()).resolves.toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  test('shows a banner once monetization is enabled', async () => {
    const service = createCrazyGamesAdService(true);
    await expect(service.requestBannerAd()).resolves.toBe(true);
  });

  test('reports the rewarded ad as available', () => {
    const service = createCrazyGamesAdService(true);
    expect(service.isRewardedAdAvailable()).toBe(true);
  });
});
