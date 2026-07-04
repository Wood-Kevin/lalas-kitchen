// Mirrors the schema in skins/<skinId>/config.json (see lalas-kitchen-build-spec.md
// Phase 4). Defined here rather than in skins/ since this is "what shape does a
// skin config have to be for components/ to render it" — a presentation-layer
// contract, not skin data itself.
export interface SkinPieceType {
  id: string;
  sprite: string;
}

export interface SkinBlocker {
  id: string;
  sprite: string;
  hitsToClear: number;
}

export type CascadeFallSpeed = 'slow' | 'medium' | 'fast';

export interface SkinAnimationProfile {
  matchStyle: string;
  matchDurationMs: number;
  cascadeFallSpeed: CascadeFallSpeed;
  swapDurationMs: number;
}

export interface SkinPalette {
  background: string[];
  panel: string;
  accent: string;
  // Added for the Home/All Levels screens (components/Home.tsx,
  // components/AllLevels.tsx) — the HUD/Board/overlays only ever needed
  // accent-vs-default-text, but the dashboard design calls for a richer
  // three-tier text/border scheme (sage green, warm brown, muted tan) on
  // top of that, so these are real palette data rather than hardcoded in
  // the new screens themselves.
  secondaryAccent: string;
  mutedText: string;
  border: string;
  text: string;
}

export interface SkinConfig {
  skinId: string;
  pieceTypes: SkinPieceType[];
  blockers: SkinBlocker[];
  lives: { max: number; regenMinutes: number; icon: string };
  animationProfile: SkinAnimationProfile;
  palette: SkinPalette;
}
