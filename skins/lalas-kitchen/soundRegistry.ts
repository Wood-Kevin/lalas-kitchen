import type { AudioSource } from 'expo-audio';
import type { SoundEffectId, MusicId } from '../../services/soundService';

// Static require() registry for this skin's sound effects, mirroring
// spriteRegistry.ts's shape: Metro can only resolve a require() whose
// argument is a literal string, so a real sound file needs exactly one line
// added here. All three effects this game triggers today (see
// components/soundEffects.ts's triggerPassEffects) have real, synthesized
// WAV assets — see scripts/generate-sound-assets.js for how they were
// generated and why (no audio tool/licensed library was available in the
// environment this was built in, so these are procedurally synthesized
// soft chime tones, not placeholders).
export const soundRegistry: Partial<Record<SoundEffectId, AudioSource>> = {
  match: require('./sounds/match.wav'),
  cascade: require('./sounds/cascade.wav'),
  win: require('./sounds/win.wav'),
};

// Same shape, for the one looping ambient track (see
// components/backgroundMusic.ts). A separate map from soundRegistry above
// since MusicId and SoundEffectId are different closed unions.
export const musicRegistry: Partial<Record<MusicId, AudioSource>> = {
  background: require('./sounds/background.wav'),
};
