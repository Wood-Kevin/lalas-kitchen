import type { AudioSource } from 'expo-audio';
import type { SoundEffectId } from '../../services/soundService';

// Static require() registry for this skin's sound effects, mirroring
// spriteRegistry.ts's shape: Metro can only resolve a require() whose
// argument is a literal string, so a real sound file needs exactly one line
// added here. The three real-gameplay effects (see
// components/soundEffects.ts's triggerPassEffects) have real, synthesized
// WAV assets — see scripts/generate-sound-assets.js for how they were
// generated and why (no audio tool/licensed library was available in the
// environment this was built in, so these are procedurally synthesized
// soft chime tones, not placeholders).
//
// The three `_juice`/`special_trigger` entries are the dev-only,
// game-feel-comparison-harness counterparts (see services/soundService.ts's
// SoundEffectId doc comment and scripts/generate-game-feel-comparison-audio.js)
// — real assets too, just never played outside the opt-in harness.
export const soundRegistry: Partial<Record<SoundEffectId, AudioSource>> = {
  match: require('./sounds/match.wav'),
  cascade: require('./sounds/cascade.wav'),
  win: require('./sounds/win.wav'),
  match_juice: require('./sounds/match_juice.wav'),
  cascade_juice: require('./sounds/cascade_juice.wav'),
  special_trigger: require('./sounds/special_trigger.wav'),
};
