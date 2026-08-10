import { Board } from '../engine/matrix';
import { Position } from '../engine/gameState';
import { ClearedPiece } from './boardDiff';
import { sweepDelaysForClears, SweepDelay } from './sweepAnimation';

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
// Deliberately narrow to the four effects this module gives real identity
// to. The three area+special COMBOS (area swapped directly into another
// special — distinct from the solo case below) still simply fall through to
// the generic sweep rather than getting their own descriptor kind — out of
// scope for the visual-reward-language spec that added the solo case, since
// only "area bomb blast" (the solo detonation) was named in that spec's
// scope, not the combos. Giving the combos their own identity too remains a
// separate, unbuilt nicety — see DEFERRED_COMPLEXITY.md.
export type SpecialEffectDescriptor =
  | { kind: 'color_bomb'; origin: Position }
  | { kind: 'striped_cross'; origin: Position }
  | { kind: 'supercombo'; bombPieceId: string; targetMatchType: string | undefined }
  // The SOLO area-bomb-into-ordinary-piece swap (see SPEC.md's "solo area
  // bomb blast gets its own effect identity" decision). Before this, the
  // blast radius had no distinguishing animation at all beyond the bomb
  // piece's own powder-poof — its surrounding cells fell through to the
  // same generic branch an ordinary match uses, undermining the point of
  // giving this mechanism its own color with no motion to go with it.
  | { kind: 'area_bomb'; origin: Position };

export function resolveSpecialEffectDescriptor(
  board: Board,
  posA: Position,
  posB: Position
): SpecialEffectDescriptor | undefined {
  const pieceA = board[posA.row][posA.col];
  const pieceB = board[posB.row][posB.col];
  const aArea = pieceA.type === 'area_bomb';
  const bArea = pieceB.type === 'area_bomb';
  if (aArea || bArea) {
    // Mirrors applyMove's own branch order: an area bomb swapped into
    // ANOTHER special is a combo (area+color/area+striped/area+area),
    // which still falls through to undefined/generic — unchanged, out of
    // scope here. Only a swap into an ordinary piece is the solo
    // detonation this descriptor now identifies.
    const other = aArea ? pieceB : pieceA;
    if (other.type === 'striped' || other.type === 'color_bomb' || other.type === 'area_bomb') {
      return undefined;
    }
    // Unlike color_bomb below (position-independent — it never actually
    // swaps, so its pre-move cell IS its final cell), a solo area bomb is
    // one of the swap-anchor rule's LOCAL effects: applyMove stages a real
    // swap for it, and CLAUDE.md's swap-anchor entry is explicit that the
    // blast "follows the bomb to wherever it lands," not its pre-swap
    // cell — a real playtest-reported bug ("blast one cell off") when this
    // was gotten backwards elsewhere in the same effect family. The bomb's
    // post-swap cell is the OTHER position from where it started.
    return { kind: 'area_bomb', origin: aArea ? posB : posA };
  }
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
    // The combo's cross is centered on posB — the cell the player dragged into
    // (see resolveStripedCross and applyMove's anchor-rule comment). posA is
    // just its adjacent partner, which lies on one of the two swept lines.
    // This MUST track the engine's anchor — it used to read posA because the
    // engine centered there, so moving one without the other would leave the
    // sweep travelling out from a cell the cross no longer clears through.
    return { kind: 'striped_cross', origin: posB };
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
): Map<string, SweepDelay> {
  const delays = new Map<string, SweepDelay>();
  for (const { piece, from } of cleared) {
    if (piece.type === 'blocker') continue;
    // The cross's row half stretches horizontally, its column half
    // vertically — the same directional-stretch identity a real striped
    // sweep's own axis gives it (see sweepAnimation.ts's SweepDelay), just
    // computed from this combo's own direction-agnostic centre rather than
    // either swapped piece's original direction (see this function's own
    // header comment on why).
    if (from.row === origin.row) {
      delays.set(piece.id, { delayMs: Math.abs(from.col - origin.col) * perTileStaggerMs, axis: 'row' });
    } else if (from.col === origin.col) {
      delays.set(piece.id, { delayMs: Math.abs(from.row - origin.row) * perTileStaggerMs, axis: 'col' });
    }
  }
  return delays;
}

// Takes the smaller delay per piece across two maps — the same "nearest origin
// wins" rule sweepAnimation.ts already applies for two crossing beams, reused
// here to merge the cross combo's own geometry with any chained special's real
// sweep without either one silently overriding the other. Keeps the winning
// entry's OWN axis (never mixes one entry's delay with the other's axis).
function mergeMinDelays(a: Map<string, SweepDelay>, b: Map<string, SweepDelay>): Map<string, SweepDelay> {
  const merged = new Map(a);
  for (const [id, entry] of b) {
    const existing = merged.get(id);
    merged.set(id, existing === undefined || entry.delayMs < existing.delayMs ? entry : existing);
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
  // The area bomb's own, much shorter radial travel budget — a 3x3 blast's
  // real distances top out around 1.4 cells, nothing like a board-spanning
  // color bomb wave, so it gets its own constant rather than reusing
  // radialWaveMs (see cascadeTiming.ts's AREA_BOMB_WAVE_MS).
  areaBombWaveMs: number;
  supercomboConvertMs: number;
  chainLinkStaggerMs: number;
}

export interface PassAnimation {
  // Merged with the generic sweep so a chained special's own real sweep is
  // never lost — see mergeMinDelays. Each entry now carries the beam's real
  // AXIS alongside its delay (see sweepAnimation.ts's SweepDelay) so
  // Tile.tsx's ExitingTile can stretch a swept tile along the direction the
  // beam actually travelled, not a generic uniform pop.
  sweepDelays: Map<string, SweepDelay>;
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
      // Preserve whatever axis this entry already carries (or none, for a
      // cell with no prior sweep entry — the offset alone still applies,
      // same as before this field existed) — the stagger only ever shifts
      // WHEN a link starts, never which way it travels.
      const existing = animation.sweepDelays.get(id);
      animation.sweepDelays.set(id, { delayMs: (existing?.delayMs ?? 0) + offset, axis: existing?.axis });
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

  if (effect.kind === 'area_bomb') {
    // Reuses the same radial-distance geometry a color bomb's wave uses —
    // no new shape, just a far shorter travel budget appropriate to a
    // local 3x3 blast (see PassAnimationOptions.areaBombWaveMs). This is
    // what gives the solo area bomb blast the motion identity it never
    // had before (see SPEC.md's "solo area bomb blast" decision) — it's
    // distinguished from a color_bomb wave despite sharing this same
    // radialDelayMs channel via `radialKind` (Board.tsx / exitingTile.ts),
    // which today only picks the pulse-distance/particle-count magnitude
    // (see engine/DECISIONS.md's colors-removed rework entry) rather than
    // a color the way it originally did.
    return staged({
      sweepDelays: genericSweep,
      radialDelays: radialDelaysForClears(cleared, effect.origin, options.areaBombWaveMs),
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
    // No real travel direction for a synchronized "everything fires
    // together" beat — axis stays undefined, which Tile.tsx's ExitingTile
    // reads as "use the plain uniform pop, not a directional stretch."
    sweepDelays.set(id, { delayMs: options.supercomboConvertMs, axis: undefined });
  }

  return staged({ sweepDelays, radialDelays: new Map(), convertedFlashIds });
}
