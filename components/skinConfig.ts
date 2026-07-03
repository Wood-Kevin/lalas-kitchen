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
}

export interface SkinConfig {
  skinId: string;
  pieceTypes: SkinPieceType[];
  blockers: SkinBlocker[];
  lives: { max: number; regenMinutes: number; icon: string };
  animationProfile: SkinAnimationProfile;
  palette: SkinPalette;
}
