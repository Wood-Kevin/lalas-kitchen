/// <reference lib="dom" />
// This file's own loadCrazyGamesSdk references window/document (the real
// CrazyGames SDK is a browser <script> tag, not a native module) — this
// repo's tsconfig.json deliberately doesn't include the DOM lib (most
// files never touch it), so this local directive opts in just for this
// file's type-checking, the same one-line fix engine/asyncStorage.test.ts
// already uses for the identical reason. No runtime environment change is
// needed (unlike that file's `@jest-environment jsdom` docblock): every
// test in crazyGamesAdService.test.ts injects a fake loadSdk, so the real
// window/document-touching code path is never actually executed under Jest.
import { AdService } from './adService';

// CrazyGames disables all monetization during "Basic Launch" — the phase
// every game starts in — and only re-enables it once CrazyGames reviews the
// game and graduates it to "Full Launch" (see docs.crazygames.com's ads
// requirements page). Investigation confirmed there is no SDK call to check
// this proactively: `requestAd()` can report an `adsDisabledBasicLaunch`
// error code, but only *after* attempting a request that was doomed from the
// start — exactly the dead-button behavior this flag exists to avoid. So
// this is a manually flipped build-time flag, not a runtime read: false
// (today's real state) while the game sits in Basic Launch, flipped to true
// the day CrazyGames actually notifies of Full Launch graduation. See
// engine/DECISIONS.md's crazygames-basic-launch entry.
export const CRAZY_GAMES_MONETIZATION_ENABLED = false;

// The real CrazyGames SDK v3 (the current recommended version — v1/v2 are
// legacy) is a browser `<script>` tag, not a native module, unlike AdMob —
// confirmed directly against docs.crazygames.com rather than assumed. This
// is the interface actually used, a narrow slice of `window.CrazyGames.SDK`
// covering only what requestRewardedAd needs, not the whole SDK surface
// (game lifecycle reporting, user data, etc. are out of this task's scope —
// see engine/DECISIONS.md's real-crazygames-sdk entry).
export interface CrazyGamesSdk {
  ad: {
    requestAd(
      type: 'rewarded' | 'midgame',
      callbacks: {
        adStarted?: () => void;
        adFinished?: () => void;
        adError?: (error: unknown) => void;
      }
    ): void;
  };
}

const CRAZY_GAMES_SDK_SRC = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

// Loads the real SDK script tag and resolves once `window.CrazyGames.SDK` is
// actually present. Lazy (called only from a real rewarded-ad request, only
// once monetization is actually enabled) rather than loaded unconditionally
// at app boot — while Basic Launch is on, no ad is ever requested, so there's
// nothing for the script to do; loading it eagerly regardless would be
// scope this task wasn't asked to build (broader platform-lifecycle
// integration, not just ad requests). Cached on `window` itself (the SDK's
// own global), so a second call after the first successful load is instant.
function loadCrazyGamesSdk(): Promise<CrazyGamesSdk> {
  return new Promise((resolve, reject) => {
    const existing = (window as unknown as { CrazyGames?: { SDK?: CrazyGamesSdk } }).CrazyGames?.SDK;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = CRAZY_GAMES_SDK_SRC;
    script.onload = () => {
      const sdk = (window as unknown as { CrazyGames?: { SDK?: CrazyGamesSdk } }).CrazyGames?.SDK;
      if (sdk) resolve(sdk);
      else reject(new Error('CrazyGames SDK script loaded, but window.CrazyGames.SDK is missing'));
    };
    script.onerror = () => reject(new Error('Failed to load the CrazyGames SDK script'));
    document.head.appendChild(script);
  });
}

// Wraps the real callback-based requestAd('rewarded', ...) into this
// project's Promise<boolean> AdService contract: true only if adFinished
// fires (the player watched to completion), false on adError (includes
// unfilled/adblock/adCooldown/other — every failure reads the same to a
// caller that only ever grants on true, matching this project's existing
// "the engine doesn't care why, only whether it happened" convention).
// adStarted has no caller-visible effect here — pausing gameplay/muting
// sound while an ad plays (CrazyGames' own stated recommendation) is a real,
// deliberately out-of-scope follow-up: every current caller (ContinueOffer,
// OutOfLives) only ever requests an ad from an already-paused overlay, where
// no cascade animation or move is in flight to interrupt, so the practical
// gap is narrow — see DEFERRED_COMPLEXITY.md.
function requestRealRewardedAd(sdk: CrazyGamesSdk): Promise<boolean> {
  return new Promise((resolve) => {
    sdk.ad.requestAd('rewarded', {
      adFinished: () => resolve(true),
      adError: (error) => {
        console.error('[crazyGamesAdService] rewarded ad failed:', error);
        resolve(false);
      },
    });
  });
}

// A factory rather than a bare object so tests can exercise both phases
// deterministically (see crazyGamesAdService.test.ts) without mutating
// module-level state. `loadSdk` is injectable (defaulting to the real
// browser-script loader) for the exact same reason — a test can pass a fake
// CrazyGamesSdk and never touch a real `<script>` tag or network request.
// The real singleton below is just this factory called with today's actual
// flag value and the real loader.
export function createCrazyGamesAdService(
  monetizationEnabled: boolean,
  loadSdk: () => Promise<CrazyGamesSdk> = loadCrazyGamesSdk
): AdService {
  return {
    async requestRewardedAd(): Promise<boolean> {
      if (!monetizationEnabled) {
        // No ad exists to request during Basic Launch — grant the reward
        // directly rather than gating it behind a call that can only fail.
        return true;
      }
      try {
        const sdk = await loadSdk();
        return await requestRealRewardedAd(sdk);
      } catch (err) {
        // The SDK script can genuinely fail to load — a network hiccup, or
        // (today, since CRAZY_GAMES_MONETIZATION_ENABLED is false) simply
        // running somewhere other than a real crazygames.com-hosted page.
        // Granting for free here, rather than leaving the player stuck on a
        // dead button, matches this project's existing "never leave the
        // player with no way forward" precedent (e.g. the shuffle rescue).
        console.error('[crazyGamesAdService] could not load the CrazyGames SDK — granting for free rather than blocking the player:', err);
        return true;
      }
    },
    async requestBannerAd(): Promise<boolean> {
      if (!monetizationEnabled) {
        // No banner exists to show during Basic Launch either.
        return false;
      }
      return true;
    },
    isRewardedAdAvailable(): boolean {
      return monetizationEnabled;
    },
  };
}

export const crazyGamesAdService: AdService = createCrazyGamesAdService(CRAZY_GAMES_MONETIZATION_ENABLED);
