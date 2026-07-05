import { selectSoundService } from './soundService';
import { silentSoundService } from './silentSoundService';

describe('selectSoundService', () => {
  test('resolves to the silent stub on every platform today', () => {
    expect(selectSoundService('ios')).toBe(silentSoundService);
    expect(selectSoundService('android')).toBe(silentSoundService);
    expect(selectSoundService('web')).toBe(silentSoundService);
  });
});

describe('silentSoundService', () => {
  test('play() never throws for any effect id', () => {
    expect(() => silentSoundService.play('match')).not.toThrow();
    expect(() => silentSoundService.play('cascade')).not.toThrow();
    expect(() => silentSoundService.play('win')).not.toThrow();
  });
});
