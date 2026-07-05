import { selectHapticsService, HapticsService } from './hapticsService';
import { noopHapticsService } from './noopHapticsService';

// Deliberately never imports expoHapticsService.ts here (it imports the
// real expo-haptics native module, which fails to parse under this repo's
// plain ts-jest config) — selectHapticsService takes its native/web
// services as plain params specifically so this factory logic is testable
// with fakes. See hapticsService.ts and services/defaultHapticsService.ts.
function fakeService(): HapticsService {
  return { fire: () => {} };
}

describe('selectHapticsService', () => {
  test('resolves to the web service on web', () => {
    const nativeService = fakeService();
    const webService = fakeService();
    expect(selectHapticsService('web', nativeService, webService)).toBe(webService);
  });

  test('resolves to the native service on every non-web platform', () => {
    const nativeService = fakeService();
    const webService = fakeService();
    expect(selectHapticsService('ios', nativeService, webService)).toBe(nativeService);
    expect(selectHapticsService('android', nativeService, webService)).toBe(nativeService);
  });
});

describe('noopHapticsService', () => {
  test('fire() never throws', () => {
    expect(() => noopHapticsService.fire('light')).not.toThrow();
  });
});
