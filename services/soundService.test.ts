import { selectSoundService, SoundService } from './soundService';
import { silentSoundService } from './silentSoundService';

// Deliberately never imports expoAudioSoundService.ts here (it imports the
// real expo-audio native module, which fails to parse under this repo's
// plain ts-jest config) — selectSoundService takes its real service as a
// plain param specifically so this factory logic is testable with a fake.
// See soundService.ts and services/defaultSoundService.ts.
function fakeService(): SoundService {
  return { play: () => {}, playMusic: () => {}, stopMusic: () => {} };
}

describe('selectSoundService', () => {
  test('always resolves to the injected real service', () => {
    const realService = fakeService();
    expect(selectSoundService(realService)).toBe(realService);
  });
});

describe('silentSoundService', () => {
  test('play() never throws for any effect id', () => {
    expect(() => silentSoundService.play('match')).not.toThrow();
    expect(() => silentSoundService.play('cascade')).not.toThrow();
    expect(() => silentSoundService.play('win')).not.toThrow();
  });

  test('playMusic()/stopMusic() never throw', () => {
    expect(() => silentSoundService.playMusic('background')).not.toThrow();
    expect(() => silentSoundService.stopMusic('background')).not.toThrow();
  });
});
