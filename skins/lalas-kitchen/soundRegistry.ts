import type { AudioSource } from 'expo-audio';
import type { SoundEffectId } from '../../services/soundService';

// Static require() registry for this skin's sound effects, mirroring
// spriteRegistry.ts's shape: Metro can only resolve a require() whose
// argument is a literal string, so a real sound file needs exactly one line
// added here.
//
// The three real-gameplay effects (see components/soundEffects.ts's
// triggerPassEffects) now point at real, human-made recordings from
// Chequered Ink's "400 Sounds Pack" (itch.io, ci.itch.io/400-sounds-pack) —
// match_chime.wav/cascade_chime.wav are match_xylophone_2/5 from the pack's
// own "Match Three" category (a soft-to-bright 10-step chime ladder;
// _2/_5 were picked as a calm base with a modest step up, not the loudest
// end), win_chime.wav is xylophone_level_complete from "Musical Effects"
// (same instrument voice as the match/cascade pair, for timbral
// consistency). License (confirmed on the pack's own page before use): any
// use including commercial, no attribution required, only restriction is
// reselling the unaltered assets as a standalone pack — see SPEC.md's
// "real gameplay audio now sourced from a licensed pack" decision for the
// full reasoning and DEFERRED_COMPLEXITY.md for the one disclosed,
// unconfirmed risk (win_chime hasn't had a real listen yet).
//
// The original procedurally-synthesized match.wav/cascade.wav/win.wav (see
// scripts/generate-sound-assets.js) are left on disk, unreferenced, in case
// this decision ever reverses — same convention background.wav's removal
// already established.
//
// The three `_juice`/`special_trigger` entries are NOT reachable from real
// gameplay (see services/soundService.ts's SoundEffectId doc comment for
// why) — real, working assets, left registered for the dev-only game-feel-
// comparison harness rather than deleted, same as that harness's own code.
export const soundRegistry: Partial<Record<SoundEffectId, AudioSource>> = {
  match: require('./sounds/match_chime.wav'),
  cascade: require('./sounds/cascade_chime.wav'),
  win: require('./sounds/win_chime.wav'),
  match_juice: require('./sounds/match_juice.wav'),
  cascade_juice: require('./sounds/cascade_juice.wav'),
  special_trigger: require('./sounds/special_trigger.wav'),
};
