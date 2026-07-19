import { Board } from '../engine/matrix';
import { Position } from '../engine/gameState';
import { ClearedPiece } from './boardDiff';
import { sweepDelaysForClears } from './sweepAnimation';

// Which swap-triggered special effect fired on this move, and the geometry a
// presentation-layer animation needs to give it its own identity — derived
// purely from the pre-move board's two swapped cells, the same piece.type
// checks engine/gameState.ts's applyMove itself branches on (see its "branch
// order is load-bearing" comment). This is NOT new engine data: it's a
// read-only classification over data Board.tsx already has (the board before
// the swap), the exact same pattern isBlockerClear/isPowderBurst already use
// (see exitingTile.ts / Board.tsx). The engine's actual clear-set computation
// is untouched and remains the single source of truth for WHAT clears; this
// only decides HOW the presentation layer animates cells that are already
// known to be clearing.
//
// Deliberately narrow to the three effects this module gives real identity to.
// An area-bomb swap (solo or the area+special deferred-combo snap-back) never
// matches here — the solo case already has its own distinct powder-burst
// animation (Tile.tsx/Board.tsx, unrelated to this module), and a deferred
// combo never reaches animateCascade at all (applyMove returns the identical
// state, so Board.tsx's attemptSwap snaps back before animateCascade runs).
export type SpecialEffectDescriptor =
  | { kind: 'color_bomb'; origin: Position }
  | { kind: 'striped_cross'; origin: Position }
  | { kind: 'supercombo'; bombPieceId: string; targetMatchType: string | undefined };

export function resolveSpecialEffectDescriptor(
  board: Board,
  posA: Position,
  posB: Position
): SpecialEffectDescriptor | undefined {
  const pieceA = board[posA.row][posA.col];
  const pieceB = board[posB.row][posB.col];
  // Mirrors applyMove's branch order exactly: the area-bomb branch is checked
  // FIRST there too, so an area+color_bomb swap is never mistaken for a solo
  // detonation — it's either the area bomb's own local 3x3 blast (area +
  // ordinary, which already has its own distinct powder-burst identity,
  // unrelated to this module) or a deferred area+special combo that snaps
  // back before animateCascade ever runs this function on it.
  if (pieceA.type === 'area_bomb' || pieceB.type === 'area_bomb') return undefined;
  const aStriped = pieceA.type === 'striped';
  const bStriped = pieceB.type === 'striped';
  const aBomb = pieceA.type === 'color_bomb';
  const bBomb = pieceB.type === 'color_bomb';

  // Mirrors applyMove's own precedence: supercombo before cross before solo
  // bomb (a striped+bomb swap must never be mistaken for either of the others).
  if ((aStriped && bBomb) || (aBomb && bStriped)) {
    const stripedPos = aStriped ? posA : posB;
    const bombPos = aBomb ? posA : posB;
    return {
      kind: 'supercombo',
      bombPieceId: board[bombPos.row][bombPos.col].id,
      targetMatchType: board[stripedPos.row][stripedPos.col].matchType,
    };
  }
  if (aStriped && bStriped) {
    // The combo's cross is centered on posA (see resolveStripedCross) — posB
    // is just its adjacent partner, which lies on one of the two swept lines.
    return { kind: 'striped_cross', origin: posA };
  }
  if (aBomb || bBomb) {
    const bombPos = aBomb ? posA : posB;
    return { kind: 'color_bomb', origin: bombPos };
  }
  return undefined;
}

function euclideanDistance(a: Position, b: Position): number {
  return Math.hypot(a.row - b.row, a.col - b.col);
}

// A color bomb detonation clears every matching piece across the WHOLE board
// (or, for a bomb+bomb swap, literally every piece on it) — a fundamentally
// different reach than a local sweep/blast, so it earns a genuinely different
// shape: a radial ripple expanding outward from the swapped bomb's position,
// timed by real distance rather than a flat simultaneous vanish (see
// sweepAnimation.ts's own rationale for why an all-at-once clear reads as
// lackluster). Normalized to a FIXED total duration (totalWaveMs) rather than a
// fixed per-tile stagger like the linear sweep uses: a color bomb's reach spans
// the board's diagonal, which varies by level (a 7x7 shaped board vs. a smaller
// hand-built one), so a fixed per-tile value would make the wave's total travel
// time balloon on a larger board. Normalizing keeps the wave inside one calm,
// bounded beat regardless of board size — the same "board-shape-agnostic"
// discipline the engine's own void/segmented-gravity work already holds to.
// Blockers keep their own beat (see sweepAnimation.ts), same exclusion.
export function radialDelaysForClears(
  cleared: ClearedPiece[],
  origin: Position,
  totalWaveMs: number
): Map<string, number> {
  const distances = new Map<string, number>();
  let maxDist = 0;
  for (const { piece, from } of cleared) {
    if (piece.type === 'blocker') continue;
    const dist = euclideanDistance(from, origin);
    distances.set(piece.id, dist);
    if (dist > maxDist) maxDist = dist;
  }
  const delays = new Map<string, number>();
  for (const [id, dist] of distances) {
    delays.set(id, maxDist > 0 ? Math.round((dist / maxDist) * totalWaveMs) : 0);
  }
  return delays;
}

// The cross combo's own geometry: a single point (origin, always posA per
// resolveStripedCross) sweeping BOTH its row and column at once, rather than
// each swapped piece sweeping whatever direction it individually happened to
// carry before the combo overrode it. This is deliberately NOT the same thing
// sweepDelaysForClears derives from a real `type: 'striped'` origin in the
// cleared list — for a cross, using the two swapped pieces' own original
// directions is wrong (a piece whose original direction was 'col' would
// contribute no delay at all to cells on the row half of the cross, since
// sweepDelaysForClears only measures a 'row' origin's distance to same-row
// cells). This function computes the true, direction-agnostic cross distance
// from one center point instead. Callers merge this with the generic
// sweepDelaysForClears map (nearest origin wins) so a genuinely different
// special caught in the cross via chaining still sweeps its own real line.
export function crossOriginDelays(
  cleared: ClearedPiece[],
  origin: Position,
  perTileStaggerMs: number
): Map<string, number> {
  const delays = new Map<string, number>();
  for (const { piece, from } of cleared) {
    if (piece.type === 'blocker') continue;
    let dist: number | undefined;
    if (from.row === origin.row) {
      dist = Math.abs(from.col - origin.col);
    } else if (from.col === origin.col) {
      dist = Math.abs(from.row - origin.row);
    }
    if (dist !== undefined) delays.set(piece.id, dist * perTileStaggerMs);
  }
  return delays;
}

// Takes the smaller delay per piece across two maps — the same "nearest origin
// wins" rule sweepAnimation.ts already applies for two crossing beams, reused
// here to merge the cross combo's own geometry with any chained special's real
// sweep without either one silently overriding the other.
function mergeMinDelays(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const merged = new Map(a);
  for (const [id, delay] of b) {
    const existing = merged.get(id);
    merged.set(id, existing === undefined ? delay : Math.min(existing, delay));
  }
  return merged;
}

// Classifies which of this pass's cleared cells are the supercombo's own
// "converted to striped and fired" pieces — every cleared cell sharing the
// originating striped piece's matchType, except the bomb cell itself (which
// has no matchType at all, so it's excluded automatically by the equality
// check whenever targetMatchType is defined). This mirrors
// resolveStripedBombCombo's own inclusion test (piece.matchType ===
// targetMatchType) but only CLASSIFIES cells the engine already decided to
// clear — it invents no new clearing decision, so it can't drift from what the
// engine actually cleared. A different-matchType special caught via chaining
// keeps its own real type/matchType and is correctly excluded here, leaving it
// to the generic sweepDelaysForClears path (its own authentic effect).
export function supercomboConvertedIds(
  cleared: ClearedPiece[],
  targetMatchType: string | undefined,
  bombPieceId: string
): Set<string> {
  const ids = new Set<string>();
  if (targetMatchType === undefined) return ids;
  for (const { piece } of cleared) {
    if (piece.id === bombPieceId) continue;
    if (piece.matchType === targetMatchType) ids.add(piece.id);
  }
  return ids;
}

export interface PassAnimationOptions {
  perTileStaggerMs: number;
  radialWaveMs: number;
  supercomboConvertMs: number;
  chainLinkStaggerMs: number;
}

export interface PassAnimation {
  // Merged with the generic sweep so a chained special's own real sweep is
  // never lost — see mergeMinDelays.
  sweepDelays: Map<string, number>;
  radialDelays: Map<string, number>;
  convertedFlashIds: Set<string>;
  // How much longer than normal this pass's clears need to finish playing,
  // because chain staging pushed its deepest wave's cells out by
  // maxWave × chainLinkStaggerMs (see applyChainStaging below). 0 for a
  // chainless pass. Board.tsx adds this to the between-pass interval (and,
  // on the final pass, the terminal-overlay hold) so the next beat never
  // starts while a late chain link is still firing.
  chainHoldMs: number;
}

// The per-link chain staging (the long-deferred nicety, now built — see
// engine/DECISIONS.md's chain-staging entry): every cleared cell the engine
// tagged with a chain wave (see ApplyMoveResult.chainWaveByPieceId — wave 1
// is the first caught special's own effect, wave 2 the next, ...) has
// wave × chainLinkStaggerMs added to whichever delay channel it already
// uses, so each link's cells begin clearing one calm beat after the link
// that caught them — the chain visibly PROPAGATES instead of all its links
// firing at once. Added to the existing channel rather than replacing it, so
// within a link the effect's own travel identity (a chained striped's beam,
// distance staggering) is preserved — the wave offset only shifts WHEN that
// link starts, never how it moves. The channel choice MUST mirror Tile.tsx's
// ExitingTile playback priority (sweep first, then radial): in a color-bomb
// pass a chained striped's swept cells genuinely carry BOTH delays (the
// generic sweep from the caught striped origin AND the ripple's
// every-cleared-cell radial), and ExitingTile plays the sweep one — so the
// offset goes to sweep whenever a sweep entry exists (or neither channel
// does), and to radial only when radial is the sole channel. Caught live
// during this feature's own verification, not hypothetically: the first cut
// staged the radial entry for those dual-channel cells, which ExitingTile
// then ignored — the staging silently didn't play.
// Wave-0 cells (the triggering effect's own seed) have no entry, so a
// chainless pass is byte-identical to pre-staging behavior. Blockers never
// appear in the wave map (the engine's chain expansion excludes them), so
// their own highlight beat is untouched, same as every other exclusion.
function applyChainStaging(
  animation: PassAnimation,
  chainWaveByPieceId: Record<string, number>,
  chainLinkStaggerMs: number
): PassAnimation {
  let maxWave = 0;
  for (const [id, wave] of Object.entries(chainWaveByPieceId)) {
    if (wave < 1) continue;
    const offset = wave * chainLinkStaggerMs;
    if (animation.sweepDelays.has(id) || !animation.radialDelays.has(id)) {
      animation.sweepDelays.set(id, (animation.sweepDelays.get(id) ?? 0) + offset);
    } else {
      animation.radialDelays.set(id, (animation.radialDelays.get(id) ?? 0) + offset);
    }
    if (wave > maxWave) maxWave = wave;
  }
  return { ...animation, chainHoldMs: maxWave * chainLinkStaggerMs };
}

// The one call site Board.tsx uses per cascade pass. Only pass 0 ever carries
// a swap-triggered effect (every combo/bomb activates on the swap itself, and
// resolveClearSet's chain-cascade refill lands in later passes as ordinary
// matches — see engine/DECISIONS.md), so `passIndex` gates all of the
// descriptor-driven logic below; every later pass falls back to exactly the
// pre-existing generic sweep behavior, untouched. `chainWaveByPieceId` is the
// whole MOVE's wave map (piece ids are unique per move) — each pass simply
// finds its own cleared ids in it, so no per-pass split is needed; chain
// staging applies to every branch below via applyChainStaging, including
// later cascade passes whose own in-match striped sweep chained.
export function buildPassAnimation(
  cleared: ClearedPiece[],
  passIndex: number,
  effect: SpecialEffectDescriptor | undefined,
  options: PassAnimationOptions,
  chainWaveByPieceId: Record<string, number> = {}
): PassAnimation {
  const genericSweep = sweepDelaysForClears(cleared, options.perTileStaggerMs);
  // Only this pass's own cleared ids stage here — the move-level map can
  // carry entries for other passes' cells too.
  const clearedIds = new Set(cleared.map((c) => c.piece.id));
  const passWaves: Record<string, number> = {};
  for (const [id, wave] of Object.entries(chainWaveByPieceId)) {
    if (clearedIds.has(id)) passWaves[id] = wave;
  }
  const staged = (animation: Omit<PassAnimation, 'chainHoldMs'>): PassAnimation =>
    applyChainStaging({ ...animation, chainHoldMs: 0 }, passWaves, options.chainLinkStaggerMs);

  if (passIndex !== 0 || !effect) {
    return staged({ sweepDelays: genericSweep, radialDelays: new Map(), convertedFlashIds: new Set() });
  }

  if (effect.kind === 'striped_cross') {
    const crossDelays = crossOriginDelays(cleared, effect.origin, options.perTileStaggerMs);
    return staged({
      sweepDelays: mergeMinDelays(genericSweep, crossDelays),
      radialDelays: new Map(),
      convertedFlashIds: new Set(),
    });
  }

  if (effect.kind === 'color_bomb') {
    return staged({
      sweepDelays: genericSweep,
      radialDelays: radialDelaysForClears(cleared, effect.origin, options.radialWaveMs),
      convertedFlashIds: new Set(),
    });
  }

  // Supercombo: every converted piece (plus the bomb cell) pops together in
  // one synchronized beat AFTER the conversion flash, rather than travelling
  // tile-by-tile — so these ids are pulled OUT of the generic sweep map
  // entirely and given the same fixed delay instead. A genuinely different
  // special the sweeps caught via chaining is not in this set, so it still
  // gets its own real sweep delay from genericSweep, untouched.
  const convertedFlashIds = supercomboConvertedIds(cleared, effect.targetMatchType, effect.bombPieceId);
  const supercomboIds = new Set(convertedFlashIds);
  supercomboIds.add(effect.bombPieceId);

  const sweepDelays = new Map(genericSweep);
  for (const id of supercomboIds) {
    sweepDelays.set(id, options.supercomboConvertMs);
  }

  return staged({ sweepDelays, radialDelays: new Map(), convertedFlashIds });
}
