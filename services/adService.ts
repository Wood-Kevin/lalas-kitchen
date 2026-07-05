import { adMobAdService } from './adMobAdService';
import { crazyGamesAdService } from './crazyGamesAdService';

// The one interface the rest of the game calls, never knowing or caring
// which real ad provider (or stub) answers it. Both methods resolve a plain
// boolean — "did the player actually earn/see this" — so a caller's own
// grant logic (engine/gameState.ts's grantBonusMoves, appPersistence.ts's
// grantInstantLife) stays exactly as simple as it is today; this interface
// doesn't presume anything about reward amount or ad-unit ids, since no real
// SDK is wired in yet to say what shape that data should take.
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
  // label would mean a loading flicker for no reason. adMobAdService is
  // always true (mobile ads work from day one); crazyGamesAdService reflects
  // its own build-time monetization flag.
  isRewardedAdAvailable(): boolean;
}

// Picks the real implementation for a given platform. Takes the platform as
// a plain string rather than reading react-native's Platform.OS itself, so
// this whole file (and everything it imports) stays safely importable from
// a test — see services/defaultAdService.ts for why the real Platform.OS
// read is deliberately kept out of here.
export function selectAdService(platformOS: string): AdService {
  return platformOS === 'web' ? crazyGamesAdService : adMobAdService;
}
