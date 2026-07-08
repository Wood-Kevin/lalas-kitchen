import { Platform } from 'react-native';
import { selectAdService } from './adService';
import { expoGoogleMobileAdsService } from './expoGoogleMobileAdsService';
import { crazyGamesAdService } from './crazyGamesAdService';

// The real, live singleton Board.tsx/App.tsx import — the only file in
// services/ that reads react-native's actual Platform.OS AND imports the
// real, native-SDK-backed mobile adapter. Deliberately kept out of
// adService.ts itself: both a bare `import ... from 'react-native'` and
// react-native-google-mobile-ads' own transitive import of it crash under
// this repo's plain ts-jest config (no jest-expo/RN preset, and Jest never
// transforms node_modules, so react-native's own Flow syntax can't parse)
// the moment any test's module graph reaches them. No test imports this
// file — only real app code does — so that risk never materializes. See
// engine/DECISIONS.md's real-admob-sdk entry for the full investigation.
export const adService = selectAdService(Platform.OS, expoGoogleMobileAdsService, crazyGamesAdService);
