import { selectSoundService } from './soundService';
import { expoAudioSoundService } from './expoAudioSoundService';

// The real, live singleton Board.tsx imports — the only file in services/
// that imports expoAudioSoundService.ts's real expo-audio-backed adapter.
// Deliberately kept out of soundService.ts itself: expo-audio's import
// crashes under this repo's plain ts-jest config the moment any test's
// module graph reaches it. Mirrors services/defaultHapticsService.ts. No
// Platform.OS read is needed here (unlike haptics) — see soundService.ts's
// selectSoundService for why.
export const soundService = selectSoundService(expoAudioSoundService);
