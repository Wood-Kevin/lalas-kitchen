import type { SoundEffectId } from '../../services/soundService';

// Static require() registry for this skin's sound effects, mirroring
// spriteRegistry.ts's shape: Metro can only resolve a require() whose
// argument is a literal string, so a real sound file needs exactly one line
// added here once it exists. Empty today — no sound assets are bundled yet
// (see services/silentSoundService.ts, the only concrete SoundService) —
// built now so dropping in real audio later is a one-line addition per
// effect, not a new pattern. The value type is left unresolved (`unknown`)
// until a real audio package is chosen; the concrete adapter that consumes
// this map will narrow it to that package's real source type.
export const soundRegistry: Partial<Record<SoundEffectId, unknown>> = {};
