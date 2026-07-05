import { Platform } from 'react-native';
import { expoHapticsService } from './expoHapticsService';
import { noopHapticsService } from './noopHapticsService';
import { selectHapticsService } from './hapticsService';

// The real, live singleton Board.tsx imports. This is the ONE file that
// imports both react-native's actual Platform.OS and the real
// expo-haptics-backed adapter — kept out of hapticsService.ts itself so
// that file (and its test) never has to load expo-haptics, which doesn't
// parse under this repo's plain ts-jest config (see hapticsService.ts's
// selectHapticsService). Mirrors services/defaultAdService.ts and
// services/defaultSoundService.ts.
export const hapticsService = selectHapticsService(Platform.OS, expoHapticsService, noopHapticsService);
