import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import type { SoundService, SoundEffectId, MusicId } from './soundService';
import { soundRegistry, musicRegistry } from '../skins/lalas-kitchen/soundRegistry';

// The real device-audio adapter. Never imported by a test — expo-audio's
// raw import fails to parse under this repo's plain ts-jest config the same
// way expo-haptics's does (see hapticsService.ts's selectHapticsService and
// services/defaultHapticsService.ts), so this file is kept out of the
// module graph any test reaches, mirroring expoHapticsService.ts exactly.
//
// One player per registered effect, created lazily on first play() and then
// kept alive for the app's lifetime (never released) — this is a fixed pool
// of at most three players, not the create-and-discard case expo-audio's
// docs warn needs manual release(), so there's nothing to leak.
const players: Partial<Record<SoundEffectId, AudioPlayer>> = {};

function playerFor(effect: SoundEffectId): AudioPlayer | undefined {
  const existing = players[effect];
  if (existing) return existing;

  const source = soundRegistry[effect];
  if (!source) return undefined;

  try {
    const player = createAudioPlayer(source);
    players[effect] = player;
    return player;
  } catch {
    // A failed load (missing/corrupt asset, unsupported platform) should
    // never surface as a crash or an audible error — matches
    // silentSoundService's own never-throws contract.
    return undefined;
  }
}

// A second, separate pool for looping music, mirroring `players` above —
// kept apart rather than sharing one map since a SoundEffectId and a
// MusicId are different closed unions with different players.length (one
// vs. three) and different playback shape (fire-once vs. looped).
const musicPlayers: Partial<Record<MusicId, AudioPlayer>> = {};

function musicPlayerFor(id: MusicId): AudioPlayer | undefined {
  const existing = musicPlayers[id];
  if (existing) return existing;

  const source = musicRegistry[id];
  if (!source) return undefined;

  try {
    const player = createAudioPlayer(source);
    player.loop = true;
    musicPlayers[id] = player;
    return player;
  } catch {
    // Matches playerFor's own never-throws contract.
    return undefined;
  }
}

export const expoAudioSoundService: SoundService = {
  play(effect: SoundEffectId): void {
    const player = playerFor(effect);
    if (!player) return;

    // expo-audio (unlike expo-av) leaves a finished player paused at its
    // final position rather than resetting it, so a second play() would
    // otherwise silently do nothing — seekTo(0) first makes every call
    // replay from the start, which matters here since match/cascade can
    // fire repeatedly within one cascade. seekTo is async; chaining play()
    // off its resolution (rather than awaiting) keeps this call fire-and-
    // forget, matching the SoundService contract.
    player
      .seekTo(0)
      .then(() => player.play())
      .catch(() => {
        // Swallow — a playback failure must never interrupt gameplay.
        // .catch (not a .then rejection handler) so this also covers
        // player.play() itself throwing synchronously inside the .then.
      });
  },

  playMusic(id: MusicId): void {
    const player = musicPlayerFor(id);
    // No seekTo(0) here — stopMusic already rewinds on its way out, so a
    // fresh player (position 0) or a just-stopped one (rewound) is always
    // ready to play from the top without an extra async hop.
    player?.play();
  },

  stopMusic(id: MusicId): void {
    const player = musicPlayers[id];
    if (!player) return;

    player.pause();
    player.seekTo(0).catch(() => {
      // Swallow — a failed rewind must never interrupt gameplay, matching
      // play()'s own never-throws contract. Worst case, the next
      // playMusic() resumes mid-loop instead of from the top.
    });
  },
};
