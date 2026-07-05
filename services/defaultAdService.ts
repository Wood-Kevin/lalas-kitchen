import { Platform } from 'react-native';
import { selectAdService } from './adService';

// The real, live singleton Board.tsx/App.tsx import — the only file in
// services/ that reads react-native's actual Platform.OS. Deliberately kept
// out of adService.ts itself: a bare `import ... from 'react-native'`
// crashes under this repo's plain ts-jest config (no jest-expo/RN preset,
// and Jest never transforms node_modules, so react-native's own Flow syntax
// can't parse) the moment any test's module graph reaches it. No test
// imports this file — only real app code does — so that risk never
// materializes. See engine/DECISIONS.md's ad-service entry for the full
// investigation.
export const adService = selectAdService(Platform.OS);
