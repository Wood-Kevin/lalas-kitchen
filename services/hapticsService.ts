// Only 'light' exists today — see components/soundEffects.ts's decision to
// use a single soft impact style everywhere haptics fire at all (a match,
// never a cascade pass), so a stronger/medium style never comes up. Kept as
// a union (not a bare no-arg fire()) so a future distinct style has an
// obvious slot, mirroring SoundEffectId's shape.
export type HapticEffectId = 'light';

export interface HapticsService {
  // Fire-and-forget: never throws, regardless of platform support or
  // hardware permission state — see expoHapticsService.ts's swallowed
  // rejection.
  fire(effect: HapticEffectId): void;
}

// Picks between two already-constructed services for a given platform.
// Unlike adService.ts's selectAdService (which imports both concrete
// adapters directly, since neither touches a real native SDK yet), this
// takes the native/web services as plain params instead of importing
// expoHapticsService itself: expo-haptics is a real, already-active native
// module, and its raw ESM `import` syntax fails to parse under this repo's
// plain ts-jest config (testEnvironment: "node", no Expo/RN preset) the
// same way react-native's own Flow syntax does — confirmed empirically
// while building this file. Keeping the real import out of here (it lives
// only in services/defaultHapticsService.ts, never imported by a test)
// means this factory function stays safely testable with fake services.
export function selectHapticsService(
  platformOS: string,
  nativeService: HapticsService,
  webService: HapticsService
): HapticsService {
  // expo-haptics' impactAsync resolves as a safe no-op on web through
  // Expo's own shim, so this could plausibly always resolve to
  // nativeService. Routing web to an explicit separate service instead
  // keeps this decision visible here rather than relying on a dependency's
  // implicit behavior, mirroring adService.ts's own explicit platform
  // branch.
  return platformOS === 'web' ? webService : nativeService;
}
