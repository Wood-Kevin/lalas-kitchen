import { Platform } from 'react-native';
import { selectSoundService } from './soundService';

// The real, live singleton Board.tsx imports — the only file in services/
// that reads react-native's actual Platform.OS for sound. Deliberately kept
// out of soundService.ts itself: a bare `import ... from 'react-native'`
// crashes under this repo's plain ts-jest config the moment any test's
// module graph reaches it. Mirrors services/defaultAdService.ts exactly.
export const soundService = selectSoundService(Platform.OS);
