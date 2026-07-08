import { syncBackgroundMusic } from './backgroundMusic';
import { SoundService } from '../services/soundService';

function fakeSoundService(): { calls: string[]; soundService: SoundService } {
  const calls: string[] = [];
  return {
    calls,
    soundService: {
      play: (effect) => calls.push(`play:${effect}`),
      playMusic: (id) => calls.push(`playMusic:${id}`),
      stopMusic: (id) => calls.push(`stopMusic:${id}`),
    },
  };
}

describe('syncBackgroundMusic', () => {
  test('soundEnabled: true starts the background loop, never stops it', () => {
    const { calls, soundService } = fakeSoundService();
    syncBackgroundMusic(true, soundService);
    expect(calls).toEqual(['playMusic:background']);
  });

  test('soundEnabled: false stops the background loop, never starts it', () => {
    const { calls, soundService } = fakeSoundService();
    syncBackgroundMusic(false, soundService);
    expect(calls).toEqual(['stopMusic:background']);
  });
});
