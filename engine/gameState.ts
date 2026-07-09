import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Board,
  Piece,
  Position,
  Match,
  Square,
  CrossShape,
  StripeDirection,
  checkMatches,
  checkSquares,
  checkCrossShapes,
  swapPieces,
  calculateCascades,
  hasLegalMoves,
  shuffle,
  applyAdjacentDamage,
  findSpreadTarget,
  dropdownArrivals,
} from './matrix';
import { generateLevel } from './generator';

// Re-exported so components/ (and appPersistence.ts) can depend on
// gameState.ts alone for the engine-facing types they need, instead of
// also reaching into matrix.ts directly — gameState.ts is already the
// presentation layer's boundary for GameState, LevelConfig, etc., so
// Position/Board belong on that same seam.
export type { Position, Board };

// 'score' is the second objective type (see the scoring-system entry in
// engine/DECISIONS.md and CLAUDE.md's Data Model Notes): instead of counting
// cleared pieces of one matchType, it tracks cumulative move-score earned
// during the level (see applyMove's per-move scoreGained accumulation below).
// 'clearance' is the third (see the clearance-layers entry in
// engine/DECISIONS.md): it tracks how many hidden per-cell layers have been
// cleared, like 'score' has no single matchType to track — its targetCount is
// derived from the level's own GameState.layerCells total at createGameState
// time, not hand-authored (see LevelConfig.layerCells below), so there's no
// way for a level author's objective targetCount to drift out of sync with
// the actual layered cells placed.
// 'escort' is the fourth objective type (see the dropdown-ingredients entry
// in engine/DECISIONS.md): it tracks how many 'dropdown' pieces (matrix.ts's
// Piece.type) have reached the bottom of their column, like 'clearance' its
// targetCount is derived — from LevelConfig.dropdownPositions' length at
// createGameState time, never hand-authored — so a level author can't let
// the two numbers drift out of sync.
export type ObjectiveType = 'collect' | 'score' | 'clearance' | 'escort';

export interface Objective {
  type: ObjectiveType;
  // Only meaningful for 'collect' — the matchType this objective counts
  // toward targetCount. undefined for 'score' (currentCount is the level's
  // running score instead), 'clearance' (currentCount is the running total
  // of layers cleared instead), and 'escort' (currentCount is the running
  // total of dropdown pieces collected instead).
  targetMatchType?: string;
  targetCount: number;
  currentCount: number;
}

// The dynamic denial-zone spread mechanic's per-level runtime state. Present on
// GameState (and enabled via LevelConfig.denialSpread) ONLY for levels past the
// difficulty threshold that gates it — see appPersistence.ts's
// DENIAL_SPREAD_MIN_LEVEL_NUMBER, gated the same way pot_lid is. Absent
// (undefined) on every level below the threshold, which keeps blockers purely
// static: a cluster of blockers is a denial zone that never grows, identical to
// every level built before this mechanic. See engine/DECISIONS.md's
// denial-zone-spread entry and CLAUDE.md's Data Model Notes.
export interface DenialSpreadState {
  // Unaddressed moves since the zone last took damage (or last spread). Reset
  // to 0 the moment any blocker is hit or cleared this move ("addressing" the
  // zone), which also cancels any pending warning.
  movesUnaddressed: number;
  // The move count at which an unaddressed zone spreads. NOT a fixed universal
  // number — createGameState sets it to a proportion of the level's own move
  // budget (SPREAD_MOVE_FRACTION), so the pressure feels the same whether a
  // level grants 18 moves or 30. Always >= 2, so spreadInterval - 1 (the
  // warning move) is always a real, visible move before the spread lands.
  spreadInterval: number;
  // The hitsRemaining a freshly spread blocker is born with — the level's own
  // blockerHitsToClear, so a spread-in cell is exactly as tough to clear as a
  // generator-placed one.
  blockerHitsToClear: number;
  // Whether a freshly spread blocker is specialOnly (see matrix.ts's Piece
  // comment and engine/DECISIONS.md's blocker-depth entry) — the level's own
  // blockerSpecialOnly, so a spread-in cell shares the exact same damage rule
  // as a generator-placed one. A real gap this field closes: without it, a
  // sealed_jar-gated level's zone would spread ordinary (vulnerable)
  // blockers into new cells, silently inconsistent with the rest of the
  // zone — every generated level only ever places one blocker type, so this
  // is a single flag, not a per-cell lookup.
  blockerSpecialOnly?: boolean;
}

export type GameStatus = 'in_progress' | 'paused_awaiting_input' | 'won';

// Which resource hit zero to cause a paused_awaiting_input status. null
// whenever status isn't paused_awaiting_input. This is the mechanism that
// lets a future skin show different messaging per pause type without the
// engine needing to know what that messaging is — same "engine emits data,
// skin decides presentation" separation as the event types below.
//
// 'lives' was removed from this union — see DECISIONS.md's life-spend
// session. Mid-level lives exhaustion never had a real trigger (nothing
// ever decremented GameState.lives during play), and the life-spend
// mechanic actually built spends a life *after* a level ends, at the
// account level, with level-start itself gated at lives > 0 — so
// GameState.lives, fixed at level start to an already-gated value, can
// never legitimately reach zero inside a call to applyMove. Re-add it here
// only if a real mid-level lives-spend trigger is ever built.
export type PauseReason = 'moves' | null;

export interface GameState {
  board: Board;
  movesRemaining: number;
  // Snapshot of the account's persisted lives count at level start — read
  // by the HUD for display, but not itself decremented during play (see
  // PauseReason's comment above). The account-level lives count that
  // actually changes on a loss lives in App.tsx, not here.
  lives: number;
  // Always at least one entry — a single-objective level (every hand-built
  // LEVEL_QUEUE entry today) is just an array of length one, not a special
  // case. Win requires every entry's currentCount to reach its targetCount
  // (see applyMove), so this array is also the one place "how many things
  // does this level ask for" lives.
  objectives: Objective[];
  status: GameStatus;
  pauseReason: PauseReason;
  // Running total of every piece cleared this level, by matchType — feeds
  // the level_summary event. Distinct from each objective's currentCount,
  // which only tracks the one matchType that objective cares about.
  totalCleared: Record<string, number>;
  // Generates the next cascade-spawned piece. Stored as a closure (not a
  // seed) so GameState never needs to know whether it's backed by a seeded
  // PRNG or something else — same injection pattern as matrix.ts's
  // calculateCascades(board, spawnPiece). GameState is transient/in-memory
  // only (see SaveData below), so a non-serializable field here is fine.
  spawnPiece: () => Piece;
  // Present only when the dynamic denial-zone spread mechanic is enabled for
  // this level (LevelConfig.denialSpread, gated in appPersistence.ts).
  // undefined means blockers never spread — every level below the threshold,
  // and every level built before this mechanic existed. See DenialSpreadState.
  denialSpread?: DenialSpreadState;
  // Hidden per-cell layer counts, keyed by "row,col" — a clearance-layers cell
  // (see LevelConfig.layerCells and engine/DECISIONS.md's clearance-layers
  // entry). Unlike a blocker's hitsRemaining (carried ON the Piece, since a
  // blocker piece never moves or gets replaced until it clears), a layer must
  // stay pinned to the GRID POSITION: calculateCascades refills a cleared cell
  // with a freshly spawned piece of a different id, so the count can't live on
  // any single Piece. Always present (an empty object for every level with no
  // layerCells — every level built before this mechanic, and every level that
  // doesn't use it), the same "always present, empty is the no-op state"
  // convention totalCleared already uses, rather than DenialSpreadState's
  // gated-undefined shape (there's no difficulty threshold to gate here — a
  // layered cell is purely hand-authored content). A key present with value 0
  // means fully cleared (never deleted, so re-clearing that cell later, if it
  // happens, is a harmless no-op — see applyMove's decrementLayers).
  layerCells: Record<string, number>;
}

export interface ComboStreakEvent {
  type: 'combo_streak';
  cascadeCount: number;
  clearedByMatchType: Record<string, number>;
}

export interface LevelSummaryEvent {
  type: 'level_summary';
  outcome: 'won' | 'paused_awaiting_input';
  // null when outcome is 'won' — a reason only means something for a pause.
  reason: PauseReason;
  clearedByMatchType: Record<string, number>;
}

export type EngineEvent = ComboStreakEvent | LevelSummaryEvent;

export interface ApplyMoveResult {
  state: GameState;
  events: EngineEvent[];
  // One board snapshot per cascade pass this move resolved, in order, for
  // the presentation layer to animate as distinct sequential beats (this
  // pass's clears settle, then the next pass's begin) rather than collapsing
  // the whole chain into a single before/after diff. The final entry always
  // equals `state.board`, so animating the last step lands exactly on the
  // committed board. Empty for a rejected move (no match / not in progress),
  // where `state` is returned unchanged. A single-match move with no chain
  // yields exactly one step — the settled board — so simple cases are
  // unchanged, just expressed as a length-1 sequence. See DECISIONS.md's
  // cascade-steps entry.
  //
  // Also empty for a genuinely COMMITTED move that clears nothing at all —
  // only reachable via a dropdown (escort) swap that neither forms a match
  // nor lands the piece at its column's bottom (matrix.ts's Piece comment):
  // every other committed move guarantees at least one step, since an
  // ordinary swap that clears nothing is rejected before ever reaching
  // resolveCascades. This is NOT the same as a rejected move — `state` here
  // is genuinely different from the input state (the swap really happened),
  // just with zero passes to animate. Callers must not assume steps[0]
  // exists just because a move committed — see components/Board.tsx's
  // animateCascade, which special-cases this (a real bug, caught live: it
  // used to read steps[0] unconditionally and crash on undefined).
  steps: Board[];
  // True when this move's resolution had 2+ already-special pieces (striped,
  // color bomb, area bomb) fire their own clear effect together WITHIN THE
  // SAME pass — via a chain reaction catching another special
  // (expandChainClears), or a combo (two swapped specials are each origins,
  // always 2+) — never just two specials firing on unrelated/sequential
  // cascade passes later in a long chain. A pure by-product of the SAME
  // chaining bookkeeping (originKeys/expandChainClears) already computed for
  // real gameplay (see countFiredSpecials/CascadeResolution), not a new
  // detection mechanism. It's the exact differentiator the chain_reaction
  // tutorial teaches — see appPersistence.ts's shouldShowChainReactionTutorial.
  multiSpecialFired: boolean;
}

// mulberry32, same implementation as generator.ts. Duplicated rather than
// imported since generator.ts doesn't export it — see DECISIONS.md.
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeededSpawnPiece(seed: number, pieceTypeIds: string[]): () => Piece {
  const rng = mulberry32(seed);
  let counter = 0;
  return (): Piece => {
    const id = `spawn-${counter}`;
    counter += 1;
    const matchType = pieceTypeIds[Math.floor(rng() * pieceTypeIds.length)];
    return { id, type: 'normal', matchType };
  };
}

export interface LevelConfig {
  seed: number;
  rows: number;
  cols: number;
  pieceTypeIds: string[];
  movesLimit: number;
  lives: number;
  // Always non-empty. Every objective must be met to win (see applyMove) —
  // never let two 'collect' entries share a targetMatchType, since
  // clearedByMatchType is keyed by matchType and a shared target would
  // double-credit the same clear toward two different objectives at once.
  // `type` defaults to 'collect' when omitted (every level built before
  // 'score' existed stays byte-identical); a 'score' entry has no
  // targetMatchType, since it tracks cumulative move-score instead of one
  // piece type — see ObjectiveType/Objective above and the scoring-system
  // entry in engine/DECISIONS.md. A 'clearance' entry has neither
  // targetMatchType NOR a hand-authored targetCount — createGameState derives
  // its targetCount from summing this same config's layerCells, so a level
  // author can never let the two numbers drift out of sync (see the
  // clearance-layers entry in engine/DECISIONS.md).
  // An 'escort' entry, like 'clearance', has neither targetMatchType NOR a
  // hand-authored targetCount — createGameState derives its targetCount from
  // this same config's dropdownPositions length, so a level author can never
  // let the two numbers drift out of sync (see the dropdown-ingredients
  // entry in engine/DECISIONS.md).
  objectives: Array<
    | { type?: 'collect'; targetMatchType: string; targetCount: number }
    | { type: 'score'; targetCount: number }
    | { type: 'clearance' }
    | { type: 'escort' }
  >;
  // Optional so generator-driven levels (appPersistence.ts's
  // buildGeneratedLevelConfig) can leave it unset rather than fabricate a
  // name — components/levelProgress.ts's resolveLevelDisplayName falls back
  // to a plain "Level N" label whenever this is undefined.
  displayName?: string;
  // Optional generated-level blocker placement — mirrors generator.ts's
  // GeneratorConfig fields exactly. Omitted (or blockerCount 0/undefined)
  // means no blockers, identical to every level built before this phase.
  blockerCount?: number;
  blockerMatchType?: string;
  blockerHitsToClear?: number;
  // "Blocker depth" (see engine/DECISIONS.md's blocker-depth entry) — when
  // true, this level's blockers only take adjacent damage from a special
  // effect (a striped sweep, an area-bomb blast, a color-bomb detonation,
  // or a chain any of those trigger), never a plain ordinary match.
  // Omitted/false means an ordinary blocker, identical to every level built
  // before this variant existed. Hand-authored today — generator
  // integration is a separate, later step (see DEFERRED_COMPLEXITY.md).
  blockerSpecialOnly?: boolean;
  // When true, this level's denial zone spreads if left unaddressed — the
  // dynamic layer, gated past a difficulty threshold in appPersistence.ts
  // (buildGeneratedLevelConfig). Omitted/false means blockers are purely
  // static, the default for every level below the threshold and every level
  // built before this mechanic. createGameState turns this flag into the
  // concrete DenialSpreadState (interval scaled to movesLimit).
  denialSpread?: boolean;
  // Optional board-shape holes — the cells that make this level
  // non-rectangular (a plus, a ring, an irregular outline). Passed straight
  // through to generateLevel, which turns each into a fixed 'void' piece (see
  // matrix.ts's Piece doc and generator.ts). Omitted/empty means a plain
  // rows×cols rectangle, the default for every level built before board-shape
  // support. Hand-authored today; generator-driven shapes are deferred (see
  // DEFERRED_COMPLEXITY.md).
  voidCells?: Position[];
  // Clearance-layers cells — a hidden per-cell layer count (1 or 2, the
  // level author's choice, mirroring blockerHitsToClear's own convention)
  // that decrements by one whenever the piece sitting on that cell is
  // cleared by ANY effect (an ordinary match, a special sweep, a chain, a
  // combo, a bomb blast) — never by a blocker's adjacent damage, since a
  // layered cell never also carries a blocker this session (see
  // engine/DECISIONS.md's clearance-layers entry). Omitted/empty means no
  // layered cells, the default for every level built before this mechanic.
  // Hand-authored today, like voidCells — generator integration is a
  // separate, later step (see DEFERRED_COMPLEXITY.md).
  layerCells?: Array<{ position: Position; layers: number }>;
  // The escort mechanic's starting positions — each becomes a colorless
  // `type: 'dropdown'` piece at createGameState time (converted in place
  // from whatever generateLevel put there; safe because dropping a
  // matchType can only eliminate a potential match, never create one, so
  // generateLevel's own match-free guarantee still holds). Omitted/empty
  // means no dropdown pieces, the default for every level built before this
  // mechanic. Hand-authored today, like voidCells/layerCells — generator
  // integration is a separate, later step (see DEFERRED_COMPLEXITY.md). Not
  // designed to coexist with a blocker or void on the SAME cell (mirroring
  // layerCells' own confirmed scope line) — a level author's responsibility,
  // not runtime-validated, the same as every other hand-authored placement
  // in this file.
  dropdownPositions?: Position[];
}

// What fraction of a level's move budget an untouched denial zone is allowed to
// sit before it spreads. A quarter of the budget: an 18-move level spreads
// every 5 unaddressed moves, a 30-move level every 8 — proportional, so the
// pressure reads the same regardless of level length (see DenialSpreadState's
// spreadInterval). Deliberately gentle per CLAUDE.md's calm-pacing brief: the
// zone can only grow a handful of times across a whole level even if totally
// ignored, and any single hit on the zone resets the clock. This is the one
// place the spread cadence is tuned; the WHICH-levels gate lives separately in
// appPersistence.ts.
const SPREAD_MOVE_FRACTION = 0.25;

export function createGameState(config: LevelConfig): GameState {
  const board = generateLevel(config.seed, {
    rows: config.rows,
    cols: config.cols,
    pieceTypeIds: config.pieceTypeIds,
    blockerCount: config.blockerCount,
    blockerMatchType: config.blockerMatchType,
    blockerHitsToClear: config.blockerHitsToClear,
    blockerSpecialOnly: config.blockerSpecialOnly,
    voidCells: config.voidCells,
    // A denial-spread-eligible level's zone should already read as one
    // contiguous region the moment it loads, not rely on several spread
    // moves to grow that contiguity in — see generator.ts's clusterBlockers
    // doc comment and CLAUDE.md's Phase 8 section. This is the one place the
    // gameplay-eligibility flag (denialSpread) gets translated into the
    // generator's purely-geometric placement switch; generator.ts itself has
    // no idea what a "denial zone" is.
    clusterBlockers: config.denialSpread,
  });

  // Converts each configured position into a colorless 'dropdown' piece,
  // in place — safe after generateLevel because dropping a matchType can
  // only eliminate a potential match, never create one, so the board's
  // match-free guarantee still holds. Keeps its original id so the
  // presentation diff sees a piece that was already there, not a new spawn.
  for (const pos of config.dropdownPositions ?? []) {
    const cell = board[pos.row][pos.col];
    board[pos.row][pos.col] = { id: cell.id, type: 'dropdown' };
  }

  // Keyed by "row,col" — see GameState.layerCells's doc comment for why this
  // can't live on the Piece/Board the way blocker hitsRemaining does.
  const layerCells: Record<string, number> = {};
  for (const cell of config.layerCells ?? []) {
    layerCells[`${cell.position.row},${cell.position.col}`] = cell.layers;
  }
  // A 'clearance' objective's targetCount is ALWAYS derived from the level's
  // own layerCells total, never hand-authored — see LevelConfig.objectives'
  // doc comment on why (no way for the two numbers to drift out of sync). An
  // 'escort' objective's targetCount is derived the same way, from
  // dropdownPositions' length.
  const totalLayers = Object.values(layerCells).reduce((sum, n) => sum + n, 0);
  const totalDropdowns = config.dropdownPositions?.length ?? 0;

  return {
    board,
    movesRemaining: config.movesLimit,
    lives: config.lives,
    objectives: config.objectives.map((objective) =>
      objective.type === 'score'
        ? { type: 'score', targetCount: objective.targetCount, currentCount: 0 }
        : objective.type === 'clearance'
          ? { type: 'clearance', targetCount: totalLayers, currentCount: 0 }
          : objective.type === 'escort'
            ? { type: 'escort', targetCount: totalDropdowns, currentCount: 0 }
            : {
                type: 'collect',
                targetMatchType: objective.targetMatchType,
                targetCount: objective.targetCount,
                currentCount: 0,
              }
    ),
    status: 'in_progress',
    pauseReason: null,
    totalCleared: {},
    layerCells,
    // seed + 1, not config.seed itself: generateLevel's own rng instance is
    // internal and fully consumed by the time it returns, so ongoing
    // cascade spawns need a fresh stream. Offsetting by 1 keeps it
    // deterministic per level while decorrelating it from the board-fill
    // sequence. See DECISIONS.md.
    spawnPiece: createSeededSpawnPiece(config.seed + 1, config.pieceTypeIds),
    // Only levels flagged for the dynamic mechanic carry spread state; every
    // other level leaves this undefined and its blockers stay static. The
    // interval is derived from THIS level's movesLimit so the cadence scales
    // with level length; max(2, ...) guarantees a warning move exists.
    denialSpread: config.denialSpread
      ? {
          movesUnaddressed: 0,
          spreadInterval: Math.max(2, Math.round(config.movesLimit * SPREAD_MOVE_FRACTION)),
          blockerHitsToClear: config.blockerHitsToClear ?? 1,
          ...(config.blockerSpecialOnly ? { blockerSpecialOnly: true as const } : {}),
        }
      : undefined,
  };
}

function cloneBoardWithGaps(board: Board, positions: Position[]): Array<Array<Piece | null>> {
  const next: Array<Array<Piece | null>> = board.map((row) => row.slice());
  for (const pos of positions) {
    next[pos.row][pos.col] = null;
  }
  return next;
}

// Whether a piece may be force-cleared by a special effect (a striped sweep,
// an area-bomb blast, a color-bomb detonation, a combo, or the chain reaction
// any of those can trigger). A blocker never force-clears — it only ever takes
// adjacent damage (see applyAdjacentDamage) — and a void never clears at all,
// since it's board SHAPE, not content (see matrix.ts's calculateCascades: a
// void is a fixed floor gravity treats as permanent). Every clear-set builder
// below used to spell out `type !== 'blocker'` on its own; on a rectangular
// board that was equivalent to this, since void never existed. Once
// non-rectangular boards shipped, every one of those call sites still let a
// sweep/blast/chain reach straight through a void cell — nulling it via
// cloneBoardWithGaps, which calculateCascades then reads as an ordinary gap
// (not a void, since its isVoid check requires an actual void Piece, not
// null) and refills with a spawned piece, permanently erasing the hole. The
// swallowed void also lands in diffBoards' `cleared` list with no matchType,
// so the exit-tile pipeline resolves it to the undefined/"?" placeholder on
// its way out. One shared predicate, not five ad hoc `!== 'blocker'` checks
// that could drift independently again the next time a non-content type is
// added (see matrix.ts's parallel `swappable` guard in hasLegalMoves, which
// already excludes both for the same reason).
// A dropdown (escort) piece is excluded here too — it's immune to every
// clearing effect (a striped sweep, a blast, a detonation, a chain), only
// ever removed by reaching the bottom of its column via ordinary gravity
// (matrix.ts's dropdownArrivals). Being swept away before arriving would
// defeat the whole point of an escort objective — a real, confirmed design
// fork (see engine/DECISIONS.md's dropdown-ingredients entry), not an
// oversight. Folding it into this ONE shared predicate (rather than a sixth
// ad hoc check) protects it at all five existing call sites automatically.
function isClearable(piece: Piece): boolean {
  return piece.type !== 'blocker' && piece.type !== 'void' && piece.type !== 'dropdown';
}

// Decrements GameState.layerCells by one at every position in `positions`
// that still has a layer remaining (a position with no entry, or already at
// 0, is a no-op — a plain board cell, or an already-fully-cleared layer cell
// hit again by a later effect). Called from applyMove with the FULL set of
// positions a move's resolution cleared (CascadeResolution.clearedPositions),
// so every clearing mechanism — ordinary match, special sweep, chain, combo,
// bomb blast — reduces a layer the same way, via the same shared clear-set
// bookkeeping every one of those already produces; no separate per-mechanism
// layer logic was needed (see engine/DECISIONS.md's clearance-layers entry).
// Returns the original object, not a copy, when nothing changed, so a move
// that touches no layered cell doesn't create a new object identity every
// turn. `layersCleared` is how many positions actually lost a layer this
// call — summed straight into a 'clearance' objective's currentCount by
// applyMove, the same way scoreGained feeds a 'score' objective.
function decrementLayers(
  layerCells: Record<string, number>,
  positions: Position[]
): { layerCells: Record<string, number>; layersCleared: number } {
  let layersCleared = 0;
  let next = layerCells;
  for (const p of positions) {
    const key = `${p.row},${p.col}`;
    const remaining = layerCells[key];
    if (remaining !== undefined && remaining > 0) {
      if (next === layerCells) next = { ...layerCells };
      next[key] = remaining - 1;
      layersCleared += 1;
    }
  }
  return { layerCells: next, layersCleared };
}

// The scoring system (see engine/DECISIONS.md's scoring-system entry): every
// cleared cell is worth points according to the TIER of the mechanism that
// cleared it, not a flat per-cell amount. 'ordinary' is a plain 3-match (or a
// blocker cleared by adjacent damage); 'special' is a cell cleared while
// creating OR firing a striped piece or area bomb (a 4-run, a 2x2 square, a
// striped sweep, an area-bomb blast); 'bomb' is a cell cleared while creating
// OR firing a color bomb, a 6+-long run, or either special-piece combo
// (striped+striped, striped+bomb) — the combos are scored at the top tier
// deliberately, since they're a harder, more deliberate play than a solo
// bomb, not a lesser one. A cell touched by more than one mechanism in the
// same pass (e.g. sitting in both a plain run and a chained sweep) keeps the
// HIGHEST tier it qualified for, never double-counted — see upgradeTier.
type ScoreTier = 'ordinary' | 'special' | 'bomb';

const SCORE_TIER_RANK: Record<ScoreTier, number> = { ordinary: 1, special: 2, bomb: 3 };

// Point value per cleared cell, by tier. Flat round numbers, not
// genre-benchmarked — the first real judgment call this feature needed (see
// DECISIONS.md): a 3-tier spread wide enough that a player can feel the
// difference between an ordinary match and a bomb combo on the same HUD
// number, without needing four-and-five-digit totals to show it.
const SCORE_TIER_POINTS: Record<ScoreTier, number> = { ordinary: 10, special: 25, bomb: 50 };

// Each successive cascade pass within a single move scores at a higher
// multiplier than the last — a real "cascades and chains contribute their
// own points" mechanic, not just the trivial fact that a second pass has more
// cells to sum. passIndex is 0 for the very first pass of the move (an
// ordinary swap's first match, or a bomb/combo's own detonation), so the
// first pass is always scored at 1x. A rejected alternative: flat per-cell
// scoring with no chain bonus, which would make the HUD score number track
// clearedByMatchType almost exactly and give a long chain no more weight than
// the same cells cleared across several separate moves — this app already
// celebrates chain depth elsewhere (COMBO_STREAK_THRESHOLD's event), so
// scoring should too.
const CASCADE_CHAIN_BONUS_PER_PASS = 0.25;

function passScoreMultiplier(passIndex: number): number {
  return 1 + passIndex * CASCADE_CHAIN_BONUS_PER_PASS;
}

// Records `tier` for `key`, but only ever upgrades — a cell already marked
// 'bomb' is never downgraded to 'special' by a later, weaker call touching
// the same cell in the same pass.
function upgradeTier(tierByKey: Map<string, ScoreTier>, key: string, tier: ScoreTier): void {
  const existing = tierByKey.get(key);
  if (!existing || SCORE_TIER_RANK[tier] > SCORE_TIER_RANK[existing]) {
    tierByKey.set(key, tier);
  }
}

// Sums SCORE_TIER_POINTS over every position, defaulting to 'ordinary' for
// any position with no recorded tier (a blocker cleared by adjacent damage,
// which never goes through addClear/expandChainClears at all).
function sumTierPoints(positions: Position[], tierByKey: Map<string, ScoreTier>): number {
  let total = 0;
  for (const p of positions) {
    const tier = tierByKey.get(`${p.row},${p.col}`) ?? 'ordinary';
    total += SCORE_TIER_POINTS[tier];
  }
  return total;
}

// Every cell in a striped piece's sweep line — its whole row ('row') or whole
// column ('col'). Pure grid geometry, blocker-agnostic: callers decide what to
// do with a blocker on the line (resolveMatchEffects's addClear skips it; the
// combos filter it out before clearing, so it only ever takes adjacent damage).
// The single source of the striped-line geometry, shared by the in-match sweep
// (resolveMatchEffects) and both swap-triggered combos (applyMove).
function sweepLinePositions(
  rows: number,
  cols: number,
  pos: Position,
  direction: StripeDirection
): Position[] {
  const out: Position[] = [];
  if (direction === 'row') {
    for (let c = 0; c < cols; c++) out.push({ row: pos.row, col: c });
  } else {
    for (let r = 0; r < rows; r++) out.push({ row: r, col: pos.col });
  }
  return out;
}

// Every cell in the (2*radius+1)x(2*radius+1) block centered on `pos`, clamped
// to the board edges — the area an area bomb clears when it fires. Includes
// the center cell, so the bomb consumes itself. Pure grid geometry, the
// square-shaped sibling of sweepLinePositions above and just as
// blocker-agnostic: its callers (resolveAreaBomb and the area-bomb combos
// below) filter blockers out of the clear set, so a blocker on the blast takes
// normal adjacent damage instead of a force-clear. Kept beside
// sweepLinePositions since both are "which cells does this special reach"
// geometry. `radius` defaults to 1 (the solo area bomb's 3x3); the
// area+area combo below passes 2 for its bigger 5x5, reusing this same
// geometry rather than hand-rolling a second block scan.
function areaBlastPositions(rows: number, cols: number, pos: Position, radius = 1): Position[] {
  const out: Position[] = [];
  for (let r = pos.row - radius; r <= pos.row + radius; r++) {
    for (let c = pos.col - radius; c <= pos.col + radius; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      out.push({ row: r, col: c });
    }
  }
  return out;
}

// The board's single most common matchType — the color a color bomb detonates
// when it's CAUGHT in another effect's clear set (a chain), where there's no
// swap partner to name a target color the way an ordinary bomb swap has one.
// Counts every non-blocker piece carrying a matchType (ordinary AND striped
// pieces — a striped piece still has a color; color/area bombs are colorless, so
// they carry none and never count). Ties resolve toward the first matchType seen
// in row-major order (strict > keeps the earlier one), so the pick is fully
// deterministic — same board always chains the same way. Returns undefined only
// when no colored piece exists at all (a board of nothing but specials/blockers),
// in which case a caught color bomb just clears itself with no detonation.
function mostCommonMatchType(board: Board): string | undefined {
  const counts = new Map<string, number>();
  for (const row of board) {
    for (const cell of row) {
      if (cell.type === 'blocker' || cell.matchType === undefined) continue;
      counts.set(cell.matchType, (counts.get(cell.matchType) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [matchType, count] of counts) {
    if (count > bestCount) {
      best = matchType;
      bestCount = count;
    }
  }
  return best;
}

// Chain reaction — the deferred behavior finally built: a special piece caught in
// ANOTHER special's clear effect fires its OWN effect too, rather than just
// vanishing as ordinary content. Given a seed set of cells some effect is about
// to clear, this expands it to include the clear set of every other special the
// seed catches, repeating until no further special is reached. It's the one
// shared place chaining lives, called from resolveClearSet (so every
// swap-triggered effect chains: solo color bomb, area bomb, striped+striped,
// striped+bomb) AND from resolveMatchEffects (so an in-match striped sweep chains
// too) — so a special reacts identically however it was caught.
//
// `originKeys` are the special pieces the CALLING effect already fired or consumed
// itself: the swapped bomb, the two swapped stripeds, the supercombo's converted
// pieces, the in-match striped triggers. They sit in the seed (so they still
// clear) but must never re-fire — a chain is only the OTHER specials an effect
// catches, never the ones the effect already IS. Without this, e.g. a solo color
// bomb would re-detonate itself on the most-common color, and a striped+striped
// cross would fire each trigger's own line on top of the cross it defines.
//
// Each caught special contributes its own geometry:
//   - striped    → its full row or column, per its own `direction`
//   - area_bomb  → the 3x3 block centered on it
//   - color_bomb → every piece of the board's most common matchType (a caught
//                  bomb has no swap partner — see mostCommonMatchType)
//
// Blockers are never added (they only ever take adjacent damage — the one rule
// every caller already enforces on its own seed). It ALWAYS terminates: the board
// has finitely many cells, each cell enters `cleared` at most once, and only a
// freshly-cleared non-origin special is ever enqueued — so the chain must run dry
// the moment it stops reaching new specials, or once the whole board is cleared.
// Pure: reads the board, returns the fully-expanded position list alongside the
// score tier each cleared cell earned. `seedTiers` carries the tier the CALLER
// already assigned its own seed cells (an ordinary match's cells, a bomb's
// detonation, a combo's cleared set); a chained special's own cells are tiered
// as they're discovered ('special' for a chained striped sweep or area-bomb
// blast, 'bomb' for a chained color-bomb detonation) via upgradeTier, so a cell
// already seeded at a higher tier is never downgraded by a later chain touch.
function expandChainClears(
  board: Board,
  seed: Position[],
  originKeys: Set<string>,
  seedTiers: Map<string, ScoreTier>
): { positions: Position[]; tierByKey: Map<string, ScoreTier> } {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const keyOf = (r: number, c: number): string => `${r},${c}`;
  const cleared = new Set<string>();
  const tierByKey = new Map<string, ScoreTier>();
  const queue: Position[] = [];

  const add = (r: number, c: number, tier: ScoreTier): void => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (!isClearable(board[r][c])) return;
    const key = keyOf(r, c);
    const alreadyCleared = cleared.has(key);
    cleared.add(key);
    upgradeTier(tierByKey, key, tier);
    if (alreadyCleared) return;
    // A special the calling effect didn't already fire is a chain source. Origins
    // still clear (added above) but are never enqueued, so they don't re-fire.
    const type = board[r][c].type;
    if (
      (type === 'striped' || type === 'area_bomb' || type === 'color_bomb') &&
      !originKeys.has(key)
    ) {
      queue.push({ row: r, col: c });
    }
  };

  for (const p of seed) add(p.row, p.col, seedTiers.get(keyOf(p.row, p.col)) ?? 'ordinary');

  while (queue.length > 0) {
    const pos = queue.shift() as Position;
    const piece = board[pos.row][pos.col];
    if (piece.type === 'striped') {
      const direction: StripeDirection = piece.direction === 'row' ? 'row' : 'col';
      for (const q of sweepLinePositions(rows, cols, pos, direction)) add(q.row, q.col, 'special');
    } else if (piece.type === 'area_bomb') {
      for (const q of areaBlastPositions(rows, cols, pos)) add(q.row, q.col, 'special');
    } else if (piece.type === 'color_bomb') {
      const target = mostCommonMatchType(board);
      if (target !== undefined) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cell = board[r][c];
            if (cell.type !== 'blocker' && cell.matchType === target) add(r, c, 'bomb');
          }
        }
      }
    }
  }

  return {
    positions: [...cleared].map((k) => {
      const [r, c] = k.split(',').map(Number);
      return { row: r, col: c };
    }),
    tierByKey,
  };
}

// How many of the given positions were already a special piece (striped,
// color bomb, area bomb) on `board` — i.e. how many specials actually fired
// their own effect into the clear set they're found in, whether as the
// pass's own trigger (a swapped bomb, a swapped striped, an in-match striped
// sweep) or a chain reaction it caught (expandChainClears's queue above).
// This is the sole signal the chain_reaction tutorial's trigger reuses (see
// ApplyMoveResult.multiSpecialFired and appPersistence.ts's
// shouldShowChainReactionTutorial) — a pure count over a clear set every
// caller already computed, not a new detection mechanism. Exported for
// direct unit testing (gameState.test.ts) of the independent-simultaneous-
// specials case, which no test drove through the full applyMove pipeline
// before — see that test's comment.
export function countFiredSpecials(board: Board, positions: Position[]): number {
  let count = 0;
  for (const p of positions) {
    const type = board[p.row][p.col].type;
    if (type === 'striped' || type === 'area_bomb' || type === 'color_bomb') count += 1;
  }
  return count;
}

// The shape every cascade-resolving helper below returns. `maxSpecialsFired`
// is the largest number of already-special pieces that fired TOGETHER within
// any single pass of this move (see countFiredSpecials) — tracked as a max
// across cascade passes, not a sum, because the chain_reaction moment is
// specials compounding in the SAME resolution step, not two unrelated
// specials each firing alone on separate beats of a long cascade.
interface CascadeResolution {
  board: Board;
  cascadeCount: number;
  clearedByMatchType: Record<string, number>;
  steps: Board[];
  maxSpecialsFired: number;
  // Total points earned resolving this move (or this detonation plus
  // whatever it chains into) — see SCORE_TIER_POINTS/passScoreMultiplier.
  // Summed straight into a 'score'-type Objective's currentCount by
  // applyMove; entirely separate from clearedByMatchType, which 'collect'
  // objectives read instead.
  score: number;
  // Every position actually cleared (gapped and refilled) across every pass
  // this resolution ran, in no particular order — the raw position list
  // clearedByMatchType already aggregates into per-matchType counts, exposed
  // here instead so applyMove can look up GameState.layerCells by exact
  // position (clearedByMatchType's matchType key can't do that — a
  // clearance-layers cell isn't matchType-addressable). Includes any blocker
  // that reached zero and cleared alongside (newlyClearedBlockers), for the
  // same "the piece sitting on that cell was cleared" reasoning, even though
  // this session's layered cells never coincide with a blocker in practice
  // (see engine/DECISIONS.md's clearance-layers entry).
  clearedPositions: Position[];
  // How many dropdown (escort) pieces reached the bottom of their column and
  // were collected across every pass this resolution ran — summed straight
  // into an 'escort'-type Objective's currentCount by applyMove, the same
  // shape `score` feeds a 'score' objective. Never derived from
  // clearedPositions/clearedByMatchType (a dropdown piece is colorless, so
  // it would only ever bucket into the generic 'unknown' key there, which no
  // objective reads) — this is its own dedicated count.
  dropdownCollected: number;
}

// The special piece an anchor cell is converted into this pass. A striped
// piece carries its sweep direction; a color bomb carries nothing (it's
// colorless — see matrix.ts's Piece comment); an area bomb is now also colorless
// and carries nothing (it drops the base cell's matchType, same as a color bomb,
// since it's swap-activated rather than matched). Kept as a discriminated union
// so resolveCascades builds each target piece correctly without a second lookup,
// and so adding a future special type is one more variant here.
type AnchorSpec =
  | { kind: 'striped'; direction: StripeDirection }
  | { kind: 'color_bomb' }
  | { kind: 'area_bomb' };

// Decides what each of this pass's matches (runs) and squares actually does —
// the one place the special-piece spawn rules live:
//  - a run that CONTAINS a live striped piece triggers it: the striped piece
//    sweeps its whole row or column (per its `direction`) into the clear set,
//    and the ordinary run cells clear too. A DIFFERENT special caught on that
//    swept line (another striped, a color bomb, an area bomb) now chains — fires
//    its own effect too — via expandChainClears at the tail of this function
//    (chaining is built; see that helper). Area bombs are NOT triggered by the
//    run itself: a colorless, swap-activated area bomb can never sit inside a run
//    (see resolveAreaBomb and applyMove for its swap trigger) — but one caught in
//    a striped sweep here does chain;
//  - a fresh 4-long run of ordinary pieces CONVERTS one cell into a striped
//    piece carrying the run's orientation as its clear direction, and clears
//    the other three;
//  - a fresh 5-long run CONVERTS one cell into a color bomb and clears the
//    other four. (A color bomb doesn't act here — it only fires when the
//    player swaps it, handled in applyMove. This branch just spawns it.);
//  - a fresh 2x2 SQUARE (from `squares`) CONVERTS its top-left cell into an
//    area bomb and clears the other three. Usually only if none of its four
//    cells is part of any run this pass — an overlap is normally an L/T/larger
//    shape, deferred (DEFERRED_COMPLEXITY.md): the run logic handles those
//    cells and the square stands down. The one exception is a genuinely
//    UNAMBIGUOUS embedded square (see isUnambiguousEmbeddedSquare below): a
//    plain exactly-3 run plus a 2-cell extension into the row/column beside it
//    (a 2x3 rectangle missing one corner) really is just one real, non-guessed
//    square, so it fires anyway — a real playtest report, not a hypothetical.
//    Still deferred, unchanged: two runs each producing their OWN overlapping
//    square candidate (e.g. a full aligned 2x3, where both rows are
//    independently exactly-3 runs) is a genuinely ambiguous case with no clear
//    "which one wins," so both still stand down exactly as before. The spawned
//    area bomb is colorless
//    (drops its matchType, like a color bomb) and fires only when later
//    swapped (resolveAreaBomb), not passively. If one of the square's four
//    cells is already a live striped piece (matrix.ts's checkSquares allows
//    this through — see its squareEligible comment), no new area bomb spawns
//    at all: that striped piece fires its own sweep instead, the same
//    "an existing special fires itself rather than seeding a new one" rule
//    the run branch above applies;
//  - anything else (a plain 3-match, or a 6+ run) clears every cell.
// Blockers are never added to the clear set here: they only ever fall to
// adjacent damage (applyAdjacentDamage), so a striped sweep or area blast across
// a blocker still respects its hitsRemaining rather than force-clearing it. Pure
// — reads `board`, mutates nothing, returns the cells to gap and the anchor
// cells to convert into special pieces.
function resolveMatchEffects(
  board: Board,
  matches: Match[],
  squares: Square[],
  crosses: CrossShape[]
): {
  clearedPositions: Position[];
  anchors: Array<{ pos: Position } & AnchorSpec>;
  specialsFired: number;
  tierByKey: Map<string, ScoreTier>;
} {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const keyOf = (r: number, c: number): string => `${r},${c}`;
  const clearedKeys = new Set<string>();
  const anchorByKey = new Map<string, AnchorSpec>();
  // Every cell's scoring tier as it's added to clearedKeys (see ScoreTier) —
  // upgrade-only, so a cell touched by more than one mechanism this pass
  // keeps the highest tier it actually qualified for.
  const tierByKey = new Map<string, ScoreTier>();
  // The striped pieces that fire their own sweep in the loop below — the pass's
  // own triggers. Passed to expandChainClears as origins so they aren't treated
  // as caught specials and re-swept; only OTHER specials on their lines chain.
  const stripedTriggerKeys = new Set<string>();

  const addClear = (r: number, c: number, tier: ScoreTier = 'ordinary'): void => {
    if (isClearable(board[r][c])) {
      const key = keyOf(r, c);
      clearedKeys.add(key);
      upgradeTier(tierByKey, key, tier);
    }
  };

  // Fires every live striped piece among `triggers` (its own line sweep) and
  // clears every cell in `allCells` alongside it, all at the 'special' score
  // tier — a striped/area-bomb trigger event, whichever shape carried it in.
  // Shared by the run branch below and the square branch further down — both
  // answer the same question ("a match already contains a live special — fire
  // it, don't spawn a new special over it") the same way, so this is the one
  // place that logic lives rather than being duplicated per shape.
  const fireStripedTriggersAndClearAll = (triggers: Position[], allCells: Position[]): void => {
    for (const p of triggers) {
      stripedTriggerKeys.add(keyOf(p.row, p.col));
      const piece = board[p.row][p.col];
      const direction: StripeDirection = piece.direction === 'row' ? 'row' : 'col';
      for (const q of sweepLinePositions(rows, cols, p, direction)) addClear(q.row, q.col, 'special');
    }
    for (const p of allCells) addClear(p.row, p.col, 'special');
  };

  // Every cell any run covers this pass, and — separately — the exact run
  // length(s) covering each one. A square touching runCovered is USUALLY stood
  // down (the pure-square rule that keeps L/T/larger shapes deferred, see the
  // doc above), but a genuinely UNAMBIGUOUS embedded square (see
  // isUnambiguousEmbeddedSquare below) is allowed through as its own real
  // playtest-reported gap: a run of exactly 3 in one row/column plus a 2-cell
  // extension into the adjacent row/column (a "2x3 rectangle missing one
  // corner") IS a real, single, non-guessable 2x2 square — checkSquares
  // (matrix.ts) already finds it unconditionally (it scans every 2x2 window on
  // the board, with no "must be isolated" restriction at all), this function was
  // simply standing it down unconditionally too, indistinguishably from the
  // genuinely ambiguous/conflicting cases below.
  const runCovered = new Set<string>();
  const runLengthsAt = new Map<string, number[]>();
  for (const match of matches) {
    for (const p of match.positions) {
      const key = keyOf(p.row, p.col);
      runCovered.add(key);
      const lengths = runLengthsAt.get(key) ?? [];
      lengths.push(match.positions.length);
      runLengthsAt.set(key, lengths);
    }
  }

  // A square that overlaps a run is fired anyway, instead of standing down,
  // ONLY when all three of these hold — each guards a genuinely different way
  // "which shape wins here?" could otherwise be a silent guess:
  //  1. Every run touching any of the square's 4 cells is EXACTLY length 3 (an
  //     ordinary match, the "else" branch above). A 4/5-long arm already spawns
  //     its own striped piece/color bomb over those same cells — letting a
  //     square also fire there would double-spawn a special over one event.
  //     This preserves the existing, confirmed 4/5-arm precedence tests
  //     unchanged.
  //  2. No OTHER detected square shares a cell with this one. Two overlapping
  //     squares (e.g. a full, aligned 2x3 rectangle, where BOTH rows are
  //     independently exactly-3 runs) is a genuinely different, harder case —
  //     which of the two would "win" is an unresolved design question, not
  //     something to guess at here — so both stand down exactly as before,
  //     unchanged from today's behavior.
  //  3. The square shares no cell with any detected cross (matrix.ts's
  //     checkCrossShapes). A cross's own arms are runs too (always exactly
  //     length 3, so rule 1 alone wouldn't exclude them) — this rule keeps a
  //     square from double-spawning a second area bomb over a genuine L/T/plus
  //     the cross loop above already resolved.
  const isUnambiguousEmbeddedSquare = (square: Square): boolean => {
    const overlapsOnlyPlainRuns = square.positions.every((p) => {
      const lengths = runLengthsAt.get(keyOf(p.row, p.col));
      return !lengths || lengths.every((length) => length === 3);
    });
    if (!overlapsOnlyPlainRuns) return false;

    const isSharedWithAnotherSquare = squares.some(
      (other) =>
        other !== square &&
        other.positions.some((p) => square.positions.some((q) => q.row === p.row && q.col === p.col))
    );
    if (isSharedWithAnotherSquare) return false;

    const overlapsACross = crosses.some((cross) =>
      cross.positions.some((p) => square.positions.some((q) => q.row === p.row && q.col === p.col))
    );
    return !overlapsACross;
  };

  for (const match of matches) {
    const cells = match.positions;
    // Live striped pieces sitting in this run — a striped piece fires its line
    // sweep when it's included in a match (its passive trigger). Area bombs are
    // no longer collected here: they're colorless and swap-activated now (see
    // matrix.ts's piecesMatch and gameState.ts's resolveAreaBomb), so one can
    // never appear in a run's cells in the first place.
    const striped = cells.filter((p) => board[p.row][p.col].type === 'striped');

    if (striped.length > 0) {
      fireStripedTriggersAndClearAll(striped, cells);
    } else if (cells.length === 5) {
      const anchor = cells[0];
      anchorByKey.set(keyOf(anchor.row, anchor.col), { kind: 'color_bomb' });
      for (let i = 1; i < cells.length; i++) addClear(cells[i].row, cells[i].col, 'bomb');
    } else if (cells.length === 4) {
      const anchor = cells[0];
      anchorByKey.set(keyOf(anchor.row, anchor.col), { kind: 'striped', direction: match.orientation });
      for (let i = 1; i < cells.length; i++) addClear(cells[i].row, cells[i].col, 'special');
    } else if (cells.length >= 6) {
      // A 6+ run is rarer and bigger than the 5-run that spawns a color bomb,
      // so it scores at least as well — the 'bomb' tier, not lumped in with a
      // plain 3-match. See SCORE_TIER_POINTS's doc comment.
      for (const p of cells) addClear(p.row, p.col, 'bomb');
    } else {
      for (const p of cells) addClear(p.row, p.col, 'ordinary');
    }
  }

  // A crossing point (matrix.ts's checkCrossShapes): a horizontal run and a
  // vertical run, each EXACTLY length 3, sharing one cell (the classic
  // L/T/plus) — a second, additive area-bomb spawn alongside the square
  // above. Every CrossShape here is ALREADY guaranteed both-arms-exactly-3 by
  // construction (checkCrossShapes never reports a 4/5-arm intersection at
  // all), so this loop never needs to re-derive or gate on arm length itself
  // — a 4/5-arm intersection already spawned its own striped/color-bomb
  // anchor in the run loop above, unaffected by this loop's existence.
  //
  // No runCovered-style overlap check is needed (unlike squares): a cross's
  // own five cells were ALREADY added to the ordinary clear set by the two
  // Matches processed above (each arm is a real Match), so this loop's only
  // new job is converting the SHARED cell into an area-bomb anchor instead of
  // letting it clear — the existing "an anchor cell is never also gapped"
  // step below (the anchorByKey deletion from clearedKeys) already covers
  // that, unmodified. A square overlapping a cross's arm stands down via
  // isUnambiguousEmbeddedSquare's explicit cross-overlap check below (a
  // cross's arms are always exactly-length-3 runs, so the plain run-length
  // rule alone wouldn't exclude them).
  for (const cross of crosses) {
    const anchor = cross.positions[0];
    // A live striped piece anywhere in the cross already fired its own sweep
    // via the run loop above (whichever arm's Match contained it) — so the
    // cross stands down and spawns no area bomb, the same "an existing
    // special fires itself rather than seeding a new one" rule the run and
    // square branches already apply.
    const hasStriped = cross.positions.some((p) => board[p.row][p.col].type === 'striped');
    if (hasStriped) continue;

    anchorByKey.set(keyOf(anchor.row, anchor.col), { kind: 'area_bomb' });
    for (let i = 1; i < cross.positions.length; i++) {
      addClear(cross.positions[i].row, cross.positions[i].col);
    }
  }

  // Pure 2x2 squares → area bombs — unless the square already contains a live
  // striped piece, in which case that piece fires its own sweep instead (the
  // same rule the run branch above applies): checkSquares now allows a
  // striped corner through (see matrix.ts's squareEligible), so a square is no
  // longer guaranteed to be four plain ordinary pieces. Otherwise, same
  // anchor-conversion shape a 4-run uses for a striped piece: convert the
  // top-left cell, clear the other three (so a square credits 3 toward
  // objectives now; the bomb pays out the rest when it later fires).
  //
  // A square touching a run stands down UNLESS isUnambiguousEmbeddedSquare
  // says it's the one genuine, non-guessable embedding (see that function's
  // doc above) — e.g. a plain 3-run in one row plus a 2-cell extension into
  // the row alongside it (a 2x3 rectangle missing one corner). In that case
  // this loop proceeds exactly as the no-overlap case below: the anchor may
  // already be in the run's own clear set, but the "an anchor cell is never
  // also gapped" step at the end of this function (anchorByKey deletion from
  // clearedKeys) already handles that correctly — the same machinery a
  // cross's shared crossing cell already relies on.
  for (const square of squares) {
    const overlapsRun = square.positions.some((p) => runCovered.has(keyOf(p.row, p.col)));
    if (overlapsRun && !isUnambiguousEmbeddedSquare(square)) continue;
    const stripedCorners = square.positions.filter((p) => board[p.row][p.col].type === 'striped');
    if (stripedCorners.length > 0) {
      fireStripedTriggersAndClearAll(stripedCorners, square.positions);
      continue;
    }
    const anchor = square.positions[0];
    anchorByKey.set(keyOf(anchor.row, anchor.col), { kind: 'area_bomb' });
    for (let i = 1; i < square.positions.length; i++) {
      addClear(square.positions[i].row, square.positions[i].col, 'special');
    }
  }

  // Chain reaction: any OTHER special the pass's clears catch — a striped piece,
  // color bomb, or area bomb lying on a swept line — fires its own effect too,
  // to fixpoint (see expandChainClears). The pass's own striped triggers are
  // excluded as origins so they don't re-sweep. Expansion reads the pre-pass
  // `board`, so a cell being converted into a special THIS pass (an anchor, still
  // ordinary on `board`) is never a chain source — a freshly-spawned special
  // never fires the same pass it's born. Run before the anchor-delete below so an
  // anchor cell a chain happens to sweep is still restored to a special, not
  // gapped.
  const seedPositions = [...clearedKeys].map((k) => {
    const [r, c] = k.split(',').map(Number);
    return { row: r, col: c };
  });
  clearedKeys.clear();
  const expanded = expandChainClears(board, seedPositions, stripedTriggerKeys, tierByKey);
  for (const p of expanded.positions) {
    clearedKeys.add(keyOf(p.row, p.col));
  }

  const parseKey = (k: string): Position => {
    const [r, c] = k.split(',').map(Number);
    return { row: r, col: c };
  };

  // How many already-special pieces fired together in THIS pass (see
  // countFiredSpecials) — read before the anchor-delete below, though it
  // wouldn't matter either way: an anchor cell is always a plain 'normal'
  // piece on the pre-pass `board` until this pass converts it, never itself
  // an already-special piece.
  const specialsFired = countFiredSpecials(board, [...clearedKeys].map(parseKey));

  // A cell chosen to become a special piece is never also gapped, even if an
  // overlapping match (or a chain sweep above) added it to the clear set — the
  // special piece wins.
  for (const k of anchorByKey.keys()) clearedKeys.delete(k);

  return {
    clearedPositions: [...clearedKeys].map(parseKey),
    anchors: [...anchorByKey.entries()].map(([k, spec]) => ({ pos: parseKey(k), ...spec })),
    specialsFired,
    tierByKey: expanded.tierByKey,
  };
}

// `startPassIndex` lets a caller that already resolved an earlier beat of the
// same move (resolveClearSet's own detonation, always pass 0) continue the
// cascade-chain score multiplier from where that beat left off, rather than
// resetting to 1x — see passScoreMultiplier. An ordinary swap calls this with
// the default 0, since it IS the first pass of its move.
function resolveCascades(
  board: Board,
  spawnPiece: () => Piece,
  startPassIndex: number = 0
): CascadeResolution {
  let currentBoard = board;
  let cascadeCount = 0;
  const clearedByMatchType: Record<string, number> = {};
  // One settled board snapshot per cascade pass, in order, so the
  // presentation layer can animate each pass as a distinct beat instead of
  // diffing only the pre-move and final-settled boards (see DECISIONS.md's
  // cascade-steps entry). steps.length always equals cascadeCount; the last
  // entry equals the returned `board`. This is the exact per-pass state the
  // while loop already computes — exposing it, not recomputing anything.
  const steps: Board[] = [];
  // See CascadeResolution's doc comment — a max across passes, not a sum.
  let maxSpecialsFired = 0;
  let score = 0;
  // Every position cleared across every pass — see CascadeResolution's
  // clearedPositions doc comment.
  const allClearedPositions: Position[] = [];
  // See CascadeResolution's dropdownCollected doc comment.
  let dropdownCollected = 0;

  while (true) {
    const matches = checkMatches(currentBoard);
    // Squares are a second, run-independent match shape (a pure 2x2 forms no
    // 3-in-a-row), so the cascade continues while EITHER exists — otherwise a
    // cascade that settles into a bare 2x2 would leave it un-triggered.
    const squares = checkSquares(currentBoard);
    // Crossing points (matrix.ts's checkCrossShapes) need no loop-continuation
    // clause of their own, unlike squares — a cross's two arms are always
    // already-counted ordinary Matches, so `matches.length === 0` can never
    // coincide with a cross existing.
    const crosses = checkCrossShapes(currentBoard);
    // Dropdown (escort) arrivals are a THIRD reason to keep cascading, distinct
    // from matches/squares: a settled board with no match at all can still
    // have a dropdown piece sitting at the bottom of its column, waiting to be
    // collected — see matrix.ts's dropdownArrivals.
    const arrivals = dropdownArrivals(currentBoard);
    if (matches.length === 0 && squares.length === 0 && arrivals.length === 0) break;

    const passIndex = startPassIndex + cascadeCount;
    cascadeCount += 1;

    const { clearedPositions: matchClearedPositions, anchors, specialsFired, tierByKey } = resolveMatchEffects(
      currentBoard,
      matches,
      squares,
      crosses
    );
    maxSpecialsFired = Math.max(maxSpecialsFired, specialsFired);

    // Folded into this pass's own clear set alongside whatever match effects
    // also fired, rather than run as a wholly separate pipeline — an arrival
    // is collected exactly like any other clear (gapped, refilled, deals
    // adjacent blocker damage), just reached by position instead of a match.
    // Tracked in its own dropdownCollected count, never through
    // clearedByMatchType/sumTierPoints — a dropdown piece is colorless, so
    // it isn't a scored or matchType-keyed event.
    dropdownCollected += arrivals.length;
    const clearedPositions = [...matchClearedPositions, ...arrivals];

    // Blockers don't match directly — they take damage from whatever clears
    // next to them (see matrix.ts's applyAdjacentDamage and DECISIONS.md),
    // now including a striped piece's line sweep. Any blocker that reaches
    // zero this pass clears alongside and joins the same cascade/refill.
    // specialClearedKeys (tierByKey minus the 'ordinary' entries) is what a
    // "blocker depth" specialOnly blocker (see the Piece interface's own
    // comment) actually cares about — a plain ordinary blocker ignores this
    // entirely. A dropdown arrival is never in tierByKey at all (it's not a
    // scored event), so it's correctly treated as non-special here too.
    const specialClearedKeys = new Set(
      [...tierByKey.entries()].filter(([, tier]) => tier !== 'ordinary').map(([key]) => key)
    );
    const { board: damagedBoard, newlyClearedBlockers } = applyAdjacentDamage(
      currentBoard,
      clearedPositions,
      specialClearedKeys
    );
    allClearedPositions.push(...clearedPositions, ...newlyClearedBlockers);

    // Count every cell that actually clears, by its matchType. The anchor
    // cell of a 4-match is excluded (it becomes a striped piece, it isn't
    // cleared), so a 4-match credits 3 toward objectives now and the striped
    // piece pays out the rest when it later triggers.
    for (const pos of clearedPositions) {
      const key = currentBoard[pos.row][pos.col].matchType ?? 'unknown';
      clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
    }
    for (const pos of newlyClearedBlockers) {
      const key = damagedBoard[pos.row][pos.col].matchType ?? 'unknown';
      clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
    }

    // This pass's own points (tiered per cleared cell, blockers always at the
    // 'ordinary' tier — see sumTierPoints), scaled by how deep into the move's
    // cascade chain this pass sits (see passScoreMultiplier). Uses
    // matchClearedPositions, not the merged clearedPositions — a dropdown
    // arrival isn't a tiered match effect, so it earns no score points.
    const passPoints = sumTierPoints(matchClearedPositions, tierByKey) + newlyClearedBlockers.length * SCORE_TIER_POINTS.ordinary;
    score += Math.round(passPoints * passScoreMultiplier(passIndex));

    const withGaps = cloneBoardWithGaps(damagedBoard, [...clearedPositions, ...newlyClearedBlockers]);
    // Convert each anchor cell in place. It keeps its id (so the presentation
    // diff sees a piece that stayed put, not a new spawn) and survives this
    // pass's gravity like any other piece.
    //  - striped: keeps its matchType too (it's still a matchable piece of its
    //    own type until swept) and gains the type + clear direction.
    //  - area_bomb: drops matchType/direction entirely — like a color bomb it's
    //    now colorless (can never form an ordinary run, see matrix.ts's
    //    piecesMatch) and only fires when swapped (resolveAreaBomb via
    //    applyMove). Only its id is preserved, same as the color bomb.
    //  - color_bomb: drops matchType/direction entirely — it's colorless and
    //    can never form an ordinary run (see matrix.ts's piecesMatch), it only
    //    fires when swapped (applyMove).
    for (const anchor of anchors) {
      const base = currentBoard[anchor.pos.row][anchor.pos.col];
      withGaps[anchor.pos.row][anchor.pos.col] =
        anchor.kind === 'striped'
          ? { ...base, type: 'striped', direction: anchor.direction }
          : anchor.kind === 'area_bomb'
            ? { id: base.id, type: 'area_bomb' }
            : { id: base.id, type: 'color_bomb' };
    }
    currentBoard = calculateCascades(withGaps, spawnPiece);
    steps.push(currentBoard);
  }

  return {
    board: currentBoard,
    cascadeCount,
    clearedByMatchType,
    steps,
    maxSpecialsFired,
    score,
    clearedPositions: allClearedPositions,
    dropdownCollected,
  };
}

// Activates a color bomb swap — a genuinely different mechanism from a normal
// match (which resolveCascades drives). A color bomb doesn't clear by forming
// a run; it detonates the instant it's swapped:
//  - swapped with an ordinary/striped piece: clear every non-blocker piece
//    sharing that piece's matchType (including the swapped piece itself and
//    the bomb), regardless of whether a run would have formed;
//  - swapped with ANOTHER color bomb (the rarest, most set-up-intensive play,
//    confirmed with the architect): clear every non-blocker piece on the whole
//    board.
// Either way blockers are NOT force-cleared — they only ever take normal
// adjacent damage from the cells that clear around them (applyAdjacentDamage),
// exactly as they do for an ordinary match or a striped sweep, so a two-hit
// blocker genuinely still needs two hits no matter what triggers the clear.
// After the detonation clears + refills, any chain matches the refill creates
// resolve through the ordinary resolveCascades path, so bomb combos still
// cascade normally. Returns the same shape resolveCascades does, so applyMove
// treats both move kinds identically from here on. `bombPos` is where the
// swapped bomb sits; `otherPos` is the piece it was swapped with. Neither is
// physically swapped first — both cells clear regardless, so the swap itself
// is cosmetically irrelevant.
function resolveColorBomb(
  board: Board,
  bombPos: Position,
  otherPos: Position,
  spawnPiece: () => Piece
): CascadeResolution {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const other = board[otherPos.row][otherPos.col];
  const detonateWholeBoard = other.type === 'color_bomb';
  const targetMatchType = other.matchType;

  const clearedPositions: Position[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const piece = board[r][c];
      // Blockers only ever fall to adjacent damage, never a direct clear; a
      // void is board shape, never content, and never clears at all (matters
      // most for detonateWholeBoard below, which would otherwise sweep every
      // void on a shaped board along with everything else).
      if (!isClearable(piece)) continue;
      const isBomb = r === bombPos.row && c === bombPos.col;
      const matchesTarget =
        piece.type !== 'color_bomb' && targetMatchType !== undefined && piece.matchType === targetMatchType;
      if (detonateWholeBoard || isBomb || matchesTarget) {
        clearedPositions.push({ row: r, col: c });
      }
    }
  }

  // The swapped bomb and its partner are THIS effect's own triggers — they clear
  // but don't chain (the bomb mustn't re-detonate on the most-common color; a
  // bomb partner in a whole-board swap mustn't either). Any OTHER special the
  // detonation catches — e.g. a striped piece of the target color elsewhere — is
  // not an origin, so it chains and fires its sweep.
  const originKeys = new Set<string>([
    `${bombPos.row},${bombPos.col}`,
    `${otherPos.row},${otherPos.col}`,
  ]);
  // 'bomb' tier — the top scoring tier, matching "a 5-match or color bomb
  // worth more still" (see SCORE_TIER_POINTS's doc comment), whether this
  // detonates one color or the whole board.
  return resolveClearSet(board, clearedPositions, spawnPiece, originKeys, 'bomb');
}

// Activates an area-bomb swap — the same swap-triggered camp as the color bomb,
// but with a fixed LOCAL effect: it always clears the 3x3 block centered on the
// bomb's own cell, regardless of what it was swapped with (the partner just has
// to be an ordinary piece — an area+special swap is a deferred combo that
// applyMove snaps back before ever reaching here). This reverses the area bomb's
// original passive/colored trigger (see engine/DECISIONS.md's area-bomb reversal
// entry). `bombPos` is where the area bomb sits; it isn't physically swapped
// first, since the blast is centered on it and clears it regardless — the swap
// is cosmetically irrelevant, exactly like the color bomb. Blockers on the blast
// are filtered out of the clear set (they only ever take adjacent damage, never
// a force-clear) and the shared resolveClearSet tail does the detonation +
// refill + chain-cascade, so applyMove treats this like every other move kind
// from here on.
function resolveAreaBomb(
  board: Board,
  bombPos: Position,
  spawnPiece: () => Piece
): CascadeResolution {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const clearedPositions = areaBlastPositions(rows, cols, bombPos).filter((p) =>
    isClearable(board[p.row][p.col])
  );
  // The area bomb itself is this effect's own trigger (it clears but doesn't
  // chain — its blast IS the seed). Any OTHER special caught in the 3x3 is not an
  // origin, so it chains and fires its own effect.
  const originKeys = new Set<string>([`${bombPos.row},${bombPos.col}`]);
  // 'special' tier — an area bomb is spawned the same "worth more than a
  // plain match" way a 4-run/striped piece is (a 2x2 square), so it fires at
  // that same tier, not the top 'bomb' tier reserved for a color bomb/combo.
  return resolveClearSet(board, clearedPositions, spawnPiece, originKeys, 'special');
}

// The shared "clear exactly these cells, then let the board settle" pipeline —
// the common tail of every swap-triggered effect that doesn't clear by forming
// a run (the color bomb and both special-piece combos below). Given a set of
// cells to clear, it: applies adjacent damage to any blockers beside them (only
// ever a one-hit-per-call knock, never a force-clear — clearedPositions must
// already EXCLUDE blocker cells, exactly as each caller builds it); counts every
// cleared cell (and any blocker that reached zero) by matchType so objectives
// credit correctly; gaps + refills; then hands the refilled board to the
// ordinary resolveCascades so any chain matches the refill creates still cascade
// normally. Returns the exact same shape resolveCascades does — the detonation
// is step one — so applyMove treats every move kind identically from here on.
// `seedTier` is the score tier the WHOLE clearedPositions set earns for this
// detonation ('bomb' for a color-bomb or either combo, 'special' for an area
// bomb — see each caller); a chain reaction on top of it can still earn a
// higher tier per cell (a caught color bomb chains at 'bomb' even inside an
// area-bomb blast) via expandChainClears's own upgrade-only tiering.
function resolveClearSet(
  board: Board,
  clearedPositions: Position[],
  spawnPiece: () => Piece,
  originKeys: Set<string>,
  seedTier: ScoreTier
): CascadeResolution {
  const seedTiers = new Map<string, ScoreTier>();
  for (const p of clearedPositions) seedTiers.set(`${p.row},${p.col}`, seedTier);

  // Chain reaction first: fold in the clear set of every other special this
  // effect's cells catch (see expandChainClears). originKeys are the specials
  // THIS effect already fired (its bomb, its swapped stripeds, its converted
  // pieces) — they clear but never re-fire. Everything below counts and gaps the
  // fully-expanded set, so a chained sweep/blast credits its own cells to
  // objectives exactly like a first-order clear does.
  const { positions: expanded, tierByKey } = expandChainClears(board, clearedPositions, originKeys, seedTiers);

  // How many already-special pieces fired together in this one detonation —
  // a combo's own two swapped specials are always both origins here (so this
  // is already 2+ for any combo), and any OTHER special the expansion caught
  // is a genuine chain reaction on top of that.
  const specialsFired = countFiredSpecials(board, expanded);

  // Every position here is inherently special — this whole function only
  // ever handles a bomb/combo detonation and whatever it chains into, never
  // a plain ordinary match — so a specialOnly blocker (see matrix.ts's
  // Piece comment) should take damage from any of it. Derived from
  // tierByKey the same way resolveCascades' own call site does, rather than
  // just treating all of `expanded` as special outright, so the two stay
  // provably consistent with each other.
  const specialClearedKeys = new Set(
    [...tierByKey.entries()].filter(([, tier]) => tier !== 'ordinary').map(([key]) => key)
  );
  const { board: damagedBoard, newlyClearedBlockers } = applyAdjacentDamage(board, expanded, specialClearedKeys);

  const clearedByMatchType: Record<string, number> = {};
  for (const pos of expanded) {
    const key = board[pos.row][pos.col].matchType ?? 'unknown';
    clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
  }
  for (const pos of newlyClearedBlockers) {
    const key = damagedBoard[pos.row][pos.col].matchType ?? 'unknown';
    clearedByMatchType[key] = (clearedByMatchType[key] ?? 0) + 1;
  }

  // This detonation is always the first beat of its move (pass index 0), the
  // same "first pass is always 1x" rule an ordinary swap's resolveCascades
  // call gets — see passScoreMultiplier.
  const detonationPoints =
    sumTierPoints(expanded, tierByKey) + newlyClearedBlockers.length * SCORE_TIER_POINTS.ordinary;
  const detonationScore = Math.round(detonationPoints * passScoreMultiplier(0));

  const withGaps = cloneBoardWithGaps(damagedBoard, [...expanded, ...newlyClearedBlockers]);
  const firstBoard = calculateCascades(withGaps, spawnPiece);

  // The detonation itself is the first beat; any matches its refill creates
  // chain through the ordinary cascade loop (starting at pass index 1, so the
  // chain-bonus multiplier keeps climbing rather than resetting), so combos
  // still resolve normally.
  const chained = resolveCascades(firstBoard, spawnPiece, 1);
  for (const [matchType, count] of Object.entries(chained.clearedByMatchType)) {
    clearedByMatchType[matchType] = (clearedByMatchType[matchType] ?? 0) + count;
  }

  return {
    board: chained.board,
    cascadeCount: 1 + chained.cascadeCount,
    clearedByMatchType,
    steps: [firstBoard, ...chained.steps],
    // Max, not sum, with whatever the refill's own ordinary cascade found —
    // see CascadeResolution's doc comment on why this is a per-pass max.
    maxSpecialsFired: Math.max(specialsFired, chained.maxSpecialsFired),
    score: detonationScore + chained.score,
    clearedPositions: [...expanded, ...newlyClearedBlockers, ...chained.clearedPositions],
    // A dropdown piece is never itself part of `expanded` (isClearable
    // excludes it from every clear-set builder, including expandChainClears
    // above), but this detonation's own refill can still cause one to
    // arrive — chained's own resolveCascades call already checks for that
    // on every pass of its loop, so this is never lost, just not double-
    // counted here.
    dropdownCollected: chained.dropdownCollected,
  };
}

// Combo 1: two striped pieces swapped directly into each other. Both sweeps fire
// at once, clearing a full cross — the entire row AND entire column through the
// swap — instead of each piece waiting to be included in a later ordinary match.
// The cross is centered on posA; posB is its adjacent swap partner, so it lies on
// one of the two swept lines and clears regardless. The combo overrides each
// piece's individual sweep direction (two stripeds always make a cross, even if
// both happened to be row-clearers), matching the genre and the "entire row and
// column" spec. Blocker cells are filtered out of the clear set — like every
// other mechanism, a blocker on the cross only takes adjacent damage (see
// resolveClearSet). Always a legal, committed move (it doesn't rely on a run) —
// hasLegalMoves treats a striped+striped pair as legal for the same reason.
function resolveStripedCross(
  board: Board,
  posA: Position,
  posB: Position,
  spawnPiece: () => Piece
): CascadeResolution {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const keys = new Set<string>();
  for (const p of sweepLinePositions(rows, cols, posA, 'row')) keys.add(`${p.row},${p.col}`);
  for (const p of sweepLinePositions(rows, cols, posA, 'col')) keys.add(`${p.row},${p.col}`);
  const cleared = keysToClearablePositions(keys, board);
  // Both swapped stripeds are this combo's own triggers — the cross overrides
  // their individual directions, so neither re-fires its own line as a chain.
  // A THIRD striped (or a bomb) lying on the cross is not an origin and chains.
  const originKeys = new Set<string>([`${posA.row},${posA.col}`, `${posB.row},${posB.col}`]);
  // 'bomb' tier — a deliberate combo of two specials is scored at the top
  // tier, a harder/more valuable play than a solo bomb detonation, not a
  // lesser one (see SCORE_TIER_POINTS's doc comment).
  return resolveClearSet(board, cleared, spawnPiece, originKeys, 'bomb');
}

// Combo 2: a striped piece swapped directly with a color bomb — the supercombo.
// Every non-blocker piece on the board sharing the striped piece's matchType is
// converted into a striped piece and then fired, all at once. Because a converted
// striped piece's only effect is to sweep its line, the settled result is exactly
// the union of those sweeps, which is what we compute directly here (the same way
// resolveColorBomb computes its clear set without physically staging the swap) —
// the intermediate "everything flashes striped" frame is a presentation nicety,
// deferred (see DEFERRED_COMPLEXITY.md). Directions alternate row/col by
// discovery order so the supercombo clears both full rows and full columns rather
// than one orientation. The bomb cell is consumed too. Blockers are filtered out
// and only take adjacent damage. Always legal (the bomb already makes any swap
// involving it legal in hasLegalMoves).
function resolveStripedBombCombo(
  board: Board,
  stripedPos: Position,
  bombPos: Position,
  spawnPiece: () => Piece
): CascadeResolution {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const targetMatchType = board[stripedPos.row][stripedPos.col].matchType;
  const keys = new Set<string>();
  keys.add(`${bombPos.row},${bombPos.col}`); // the bomb consumes itself
  // The bomb and every piece this combo converts-and-fires are its own triggers —
  // they clear but never chain. This matters because a matching cell may ALREADY
  // be a striped piece on the board: without it here, expandChainClears would
  // re-sweep that piece along its ORIGINAL direction on top of the alternating
  // one the combo assigned, over-clearing beyond the defined supercombo. A
  // DIFFERENT-colored special the sweeps catch is not in here, so it still chains.
  const originKeys = new Set<string>([`${bombPos.row},${bombPos.col}`]);
  let converted = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const piece = board[r][c];
      if (piece.type === 'blocker' || piece.type === 'color_bomb') continue;
      if (targetMatchType === undefined || piece.matchType !== targetMatchType) continue;
      // Convert this matching piece to a striped piece and fire it immediately.
      originKeys.add(`${r},${c}`);
      const direction: StripeDirection = converted % 2 === 0 ? 'row' : 'col';
      converted += 1;
      for (const p of sweepLinePositions(rows, cols, { row: r, col: c }, direction)) {
        keys.add(`${p.row},${p.col}`);
      }
    }
  }
  const cleared = keysToClearablePositions(keys, board);
  // 'bomb' tier — the supercombo is the single strongest effect in the game
  // (every matching piece on the board converts and fires at once), so it
  // scores at the top tier, same as the cross combo above.
  return resolveClearSet(board, cleared, spawnPiece, originKeys, 'bomb');
}

// Combo 3: an area bomb swapped directly with a color bomb. Neither piece
// carries a matchType (both are colorless), so unlike resolveStripedBombCombo
// there's no swapped piece to read a target color off of — the same problem
// a chained, partner-less color bomb already solves via mostCommonMatchType
// (see expandChainClears above). Reusing that same function here picks the
// board's single most-common matchType, converts every piece of that type
// into an area bomb, and fires all of them at once — several 3x3 blasts
// landing simultaneously, the area-bomb sibling of the striped supercombo's
// "convert then clear all" pattern. If no colored piece exists at all (a
// board of nothing but specials/blockers), only the two swapped bombs clear —
// still a legal, committed move, just with nothing further to convert.
function resolveAreaColorCombo(
  board: Board,
  areaPos: Position,
  bombPos: Position,
  spawnPiece: () => Piece
): CascadeResolution {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const targetMatchType = mostCommonMatchType(board);
  const keys = new Set<string>();
  keys.add(`${areaPos.row},${areaPos.col}`);
  keys.add(`${bombPos.row},${bombPos.col}`);
  // Both swapped bombs are this combo's own triggers, plus every piece it
  // converts-and-fires into an area bomb — none of these re-chain. A
  // DIFFERENT special one of the resulting 3x3 blasts catches is not in here,
  // so it still chains normally.
  const originKeys = new Set<string>([`${areaPos.row},${areaPos.col}`, `${bombPos.row},${bombPos.col}`]);
  if (targetMatchType !== undefined) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const piece = board[r][c];
        if (piece.type === 'blocker' || piece.matchType !== targetMatchType) continue;
        originKeys.add(`${r},${c}`);
        for (const p of areaBlastPositions(rows, cols, { row: r, col: c })) {
          keys.add(`${p.row},${p.col}`);
        }
      }
    }
  }
  const cleared = keysToClearablePositions(keys, board);
  // 'bomb' tier — same top tier every other area+special combo below uses.
  return resolveClearSet(board, cleared, spawnPiece, originKeys, 'bomb');
}

// Combo 4: an area bomb swapped directly with a striped piece. Produces a
// plus-shaped blast — the area bomb's own 3x3 block, unioned with the striped
// piece's full sweep line in its own direction — reusing areaBlastPositions
// and sweepLinePositions exactly as they already are, rather than hand-rolling
// new plus-shaped geometry.
function resolveAreaStripedCombo(
  board: Board,
  areaPos: Position,
  stripedPos: Position,
  spawnPiece: () => Piece
): CascadeResolution {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const stripedPiece = board[stripedPos.row][stripedPos.col];
  const direction: StripeDirection = stripedPiece.direction === 'row' ? 'row' : 'col';
  const keys = new Set<string>();
  for (const p of areaBlastPositions(rows, cols, areaPos)) keys.add(`${p.row},${p.col}`);
  for (const p of sweepLinePositions(rows, cols, stripedPos, direction)) keys.add(`${p.row},${p.col}`);
  const cleared = keysToClearablePositions(keys, board);
  // Both swapped specials are this combo's own triggers — the plus shape
  // overrides the striped piece's line firing independently, so it doesn't
  // re-chain. A THIRD special caught in the plus is not an origin and chains.
  const originKeys = new Set<string>([`${areaPos.row},${areaPos.col}`, `${stripedPos.row},${stripedPos.col}`]);
  // 'bomb' tier — same top tier every other combo uses.
  return resolveClearSet(board, cleared, spawnPiece, originKeys, 'bomb');
}

// Combo 5: two area bombs swapped directly into each other. Rather than two
// separate 3x3 blasts, this fires a single bigger 5x5 blast — centered on
// `posA` (the position the caller always designates as the anchor, mirroring
// resolveStripedCross's own posA-centered convention), reusing
// areaBlastPositions' existing geometry with radius=2 instead of building a
// new shape. Since the two bombs are always adjacent, posB always falls
// within the 5x5 already, so it's cleared as part of the blast regardless.
function resolveAreaAreaCombo(
  board: Board,
  posA: Position,
  posB: Position,
  spawnPiece: () => Piece
): CascadeResolution {
  const rows = board.length;
  const cols = rows > 0 ? board[0].length : 0;
  const keys = new Set<string>();
  for (const p of areaBlastPositions(rows, cols, posA, 2)) keys.add(`${p.row},${p.col}`);
  const cleared = keysToClearablePositions(keys, board);
  // Both swapped bombs are this combo's own triggers — neither re-fires its
  // own solo 3x3 as a chain on top of the bigger blast that already contains it.
  const originKeys = new Set<string>([`${posA.row},${posA.col}`, `${posB.row},${posB.col}`]);
  // 'bomb' tier — same top tier every other combo uses.
  return resolveClearSet(board, cleared, spawnPiece, originKeys, 'bomb');
}

// Turns a set of "r,c" cell keys into the Position list resolveClearSet wants,
// dropping any cell that can't be force-cleared (see isClearable) — a blocker,
// so it only ever takes adjacent damage, and a void, so a combo's sweep lines
// can never eat through a shaped board's fixed holes.
function keysToClearablePositions(keys: Set<string>, board: Board): Position[] {
  const out: Position[] = [];
  for (const k of keys) {
    const [r, c] = k.split(',').map(Number);
    if (isClearable(board[r][c])) out.push({ row: r, col: c });
  }
  return out;
}

// Total blocker hitsRemaining across the board — the denial zone's "health."
// Compared before vs after a move resolves to decide whether the zone was
// ADDRESSED this move (any blocker hit or cleared lowers it). Matches can only
// ever lower it (a match never adds a blocker; spread runs after this check), so
// a strict decrease is an unambiguous "the player engaged the zone" signal.
function blockerHealth(board: Board): number {
  let total = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell.type === 'blocker') total += cell.hitsRemaining ?? 1;
    }
  }
  return total;
}

// Strips the transient spreadWarning flag off every cell that carries it,
// returning a new board only when something changed (so an unwarned board keeps
// its identity). The warning is recomputed from scratch each move, so it's
// always cleared first rather than mutated in place.
function clearSpreadWarnings(board: Board): Board {
  let changed = false;
  const next = board.map((row) =>
    row.map((cell) => {
      if (!cell.spreadWarning) return cell;
      changed = true;
      const { spreadWarning, ...rest } = cell;
      return rest;
    })
  );
  return changed ? next : board;
}

// Advances the denial zone one move. Pure: takes the settled post-cascade board
// plus the current spread state and whether the zone was addressed this move,
// returns the next board (with a warning marked, a cell spread, or neither) and
// the next spread state. The three outcomes:
//   - addressed        → reset the clock to 0, cancel any warning
//   - reaches interval  → SPREAD: the frontier ordinary cell becomes a blocker
//   - reaches interval-1→ WARNING: the frontier cell is flagged (growing crack)
// Any prior warning is always cleared first, then recomputed, so a warning never
// lingers past the one move it's meant to precede.
function stepDenialZone(
  board: Board,
  denial: DenialSpreadState,
  addressed: boolean
): { board: Board; denial: DenialSpreadState } {
  const cleared = clearSpreadWarnings(board);

  if (addressed) {
    return { board: cleared, denial: { ...denial, movesUnaddressed: 0 } };
  }

  const movesUnaddressed = denial.movesUnaddressed + 1;

  if (movesUnaddressed >= denial.spreadInterval) {
    const spot = findSpreadTarget(cleared);
    if (!spot) {
      // Zone fully boxed in — nowhere to grow. Hold at the threshold rather
      // than resetting, so it spreads the instant a neighbor opens up instead
      // of making the player wait out another full interval.
      return { board: cleared, denial: { ...denial, movesUnaddressed: denial.spreadInterval } };
    }
    const source = cleared[spot.source.row][spot.source.col];
    const targetPiece = cleared[spot.target.row][spot.target.col];
    const nextBoard = cleared.map((row) => row.slice());
    nextBoard[spot.target.row][spot.target.col] = {
      // Reuse the target cell's id so the tile morphs into a blocker in place
      // (boardDiff sees no clear/spawn) — the cell was denied, it didn't leave.
      id: targetPiece.id,
      type: 'blocker',
      matchType: source.matchType,
      hitsRemaining: denial.blockerHitsToClear,
      ...(denial.blockerSpecialOnly ? { specialOnly: true as const } : {}),
    };
    return { board: nextBoard, denial: { ...denial, movesUnaddressed: 0 } };
  }

  if (movesUnaddressed === denial.spreadInterval - 1) {
    const spot = findSpreadTarget(cleared);
    if (spot) {
      const targetPiece = cleared[spot.target.row][spot.target.col];
      const nextBoard = cleared.map((row) => row.slice());
      nextBoard[spot.target.row][spot.target.col] = { ...targetPiece, spreadWarning: true };
      return { board: nextBoard, denial: { ...denial, movesUnaddressed } };
    }
  }

  return { board: cleared, denial: { ...denial, movesUnaddressed } };
}

// Fires when a single move triggers this many chained cascades or more.
const COMBO_STREAK_THRESHOLD = 4;

// A move's resolution counts as the chain_reaction "multiple specials fired
// together" moment once this many already-special pieces contributed their
// own effect within the SAME pass (see CascadeResolution.maxSpecialsFired).
const MULTI_SPECIAL_THRESHOLD = 2;

export function applyMove(state: GameState, posA: Position, posB: Position): ApplyMoveResult {
  if (state.status !== 'in_progress') {
    return { state, events: [], steps: [], multiSpecialFired: false };
  }

  // Blockers aren't swappable at all — moving one out of its cell would
  // dodge the adjacent-damage mechanic entirely, so this is rejected the
  // same way a no-match swap is: snap back, no move spent, no events. Checked
  // before the color-bomb branch below so a bomb-with-blocker swap is rejected
  // too (a blocker is never a valid detonation partner), matching the same
  // exclusion hasLegalMoves makes.
  const pieceA = state.board[posA.row][posA.col];
  const pieceB = state.board[posB.row][posB.col];
  if (pieceA.type === 'blocker' || pieceB.type === 'blocker') {
    return { state, events: [], steps: [], multiSpecialFired: false };
  }

  // Void cells are holes in the board's shape, never pieces — a swap into or
  // out of one can't happen. Rejected exactly like a blocker/no-match swap: no
  // move spent, no state change. This is the safety net for a drag from a cell
  // on the board's edge toward a neighbouring void (dragDirection only
  // bounds-checks the rectangle, not the shape); hasLegalMoves excludes voids
  // too, so a board is never wrongly judged stuck because of one.
  if (pieceA.type === 'void' || pieceB.type === 'void') {
    return { state, events: [], steps: [], multiSpecialFired: false };
  }

  // Special-piece swaps activate on the swap itself, NOT by forming a match, so
  // they bypass the no-match snap-back check below entirely (always legal,
  // committed moves — hasLegalMoves is extended to match). The branch ORDER here
  // is load-bearing:
  //
  //   0. area bomb + anything  → area+color_bomb combo (resolveAreaColorCombo),
  //                              area+striped combo (resolveAreaStripedCombo),
  //                              area+area combo (resolveAreaAreaCombo), or a
  //                              solo 3x3 blast (resolveAreaBomb) for an
  //                              ordinary partner
  //   1. striped + color bomb  → supercombo (resolveStripedBombCombo)
  //   2. striped + striped     → cross clear (resolveStripedCross)
  //   3. color bomb + anything → solo bomb   (resolveColorBomb)
  //   4. ordinary swap         → match-or-snap-back
  //
  // (0) MUST come before (3): an area+color_bomb swap is also "bomb-involving,"
  // but the area bomb is colorless (no matchType), so resolveColorBomb would run
  // a degenerate single-type clear on `undefined` and detonate only the bomb
  // cell — the exact same class of bug the striped+bomb ordering below already
  // guards against, learned once and reapplied here. All three area+special
  // pairings (area+color_bomb, area+striped, area+area) are now real combos,
  // not a snap-back — see DEFERRED_COMPLEXITY.md's area+special entry, now
  // resolved. area+ordinary still fires the local 3x3 blast. The area branch
  // only fires when an area bomb is actually involved, so it's inert for every
  // non-area swap below.
  // (1) MUST come before (3): a striped+bomb swap is also "bomb-involving," and a
  // striped piece carries a matchType, so resolveColorBomb would happily accept
  // it as an ordinary detonation partner and run the WEAKER single-type clear
  // instead of the convert-every-matching-piece-to-striped supercombo. Checking
  // it first is the only thing guaranteeing the stronger effect wins.
  // (2) MUST come before (4): two striped pieces don't necessarily form a run, so
  // the ordinary branch would snap them back instead of comboing.
  const aArea = pieceA.type === 'area_bomb';
  const bArea = pieceB.type === 'area_bomb';
  const aStriped = pieceA.type === 'striped';
  const bStriped = pieceB.type === 'striped';
  const aBomb = pieceA.type === 'color_bomb';
  const bBomb = pieceB.type === 'color_bomb';
  const aDropdown = pieceA.type === 'dropdown';
  const bDropdown = pieceB.type === 'dropdown';
  let resolved: CascadeResolution;
  if (aDropdown || bDropdown) {
    // A dropdown (escort) piece is immune to every special effect (see
    // matrix.ts's Piece comment and this file's isClearable) — it's never a
    // valid detonation partner, so this branch runs FIRST, before the area/
    // striped/bomb branches below, so swapping one directly into a bomb (or
    // any other special) never triggers that special's effect. Always
    // committed, never snapped back (matching findAnyLegalMove's own
    // dropdown clause) — just a plain position swap; the normal cascade loop
    // then checks for both an ordinary match AND a dropdown arrival.
    const swapped = swapPieces(state.board, posA, posB);
    resolved = resolveCascades(swapped, state.spawnPiece);
  } else if (aArea || bArea) {
    const areaPos = aArea ? posA : posB;
    const partnerPos = aArea ? posB : posA;
    const partner = aArea ? pieceB : pieceA;
    if (partner.type === 'color_bomb') {
      resolved = resolveAreaColorCombo(state.board, areaPos, partnerPos, state.spawnPiece);
    } else if (partner.type === 'striped') {
      resolved = resolveAreaStripedCombo(state.board, areaPos, partnerPos, state.spawnPiece);
    } else if (partner.type === 'area_bomb') {
      resolved = resolveAreaAreaCombo(state.board, areaPos, partnerPos, state.spawnPiece);
    } else {
      // area + ordinary: fire the 3x3 blast centered on the bomb, regardless of
      // what it was swapped with or whether a run would have formed.
      resolved = resolveAreaBomb(state.board, areaPos, state.spawnPiece);
    }
  } else if ((aStriped && bBomb) || (aBomb && bStriped)) {
    const stripedPos = aStriped ? posA : posB;
    const bombPos = aBomb ? posA : posB;
    resolved = resolveStripedBombCombo(state.board, stripedPos, bombPos, state.spawnPiece);
  } else if (aStriped && bStriped) {
    resolved = resolveStripedCross(state.board, posA, posB, state.spawnPiece);
  } else if (aBomb || bBomb) {
    // Solo bomb. If both are bombs either assignment works (resolveColorBomb
    // detonates the whole board regardless).
    const bombPos = aBomb ? posA : posB;
    const otherPos = aBomb ? posB : posA;
    resolved = resolveColorBomb(state.board, bombPos, otherPos, state.spawnPiece);
  } else {
    const swapped = swapPieces(state.board, posA, posB);
    // A swap is legal if it forms a straight run OR a 2x2 square (which spawns
    // an area bomb — see resolveMatchEffects). A pure square forms no
    // 3-in-a-row, so checkSquares must be consulted here too, or a valid
    // square-forming move would be wrongly snapped back as a no-match swap.
    // No checkCrossShapes clause is needed here, deliberately — a crossing
    // point's two arms are themselves already ordinary 3-runs checkMatches
    // independently reports, so checkMatches(swapped) is already non-empty
    // whenever a cross-forming swap exists. See engine/DECISIONS.md's
    // crossing-run entry.
    if (checkMatches(swapped).length === 0 && checkSquares(swapped).length === 0) {
      // Illegal move: no match, snap back. No move spent, no state change.
      return { state, events: [], steps: [], multiSpecialFired: false };
    }
    resolved = resolveCascades(swapped, state.spawnPiece);
  }

  const {
    board: cascadedBoard,
    cascadeCount,
    clearedByMatchType,
    steps,
    maxSpecialsFired,
    score: scoreGained,
    clearedPositions,
    dropdownCollected,
  } = resolved;

  // Clearance-layers: every position this move actually cleared (any
  // mechanism — see decrementLayers' doc comment) loses one layer, if it has
  // any left. layersCleared feeds a 'clearance' objective's currentCount
  // below, the same way scoreGained feeds a 'score' objective's.
  const { layerCells, layersCleared } = decrementLayers(state.layerCells, clearedPositions);

  // Dynamic denial-zone spread (gated levels only — state.denialSpread is
  // undefined everywhere else, so blockers stay static). Runs on the settled
  // post-cascade board and BEFORE the legal-move rescue below, so a
  // spread-created blocker is covered by the same hasLegalMoves guarantee as
  // everything else. "Addressed" = the zone lost blocker health this move (any
  // blocker damaged or cleared, comparing the pre-move board to the settled
  // one), which resets the spread clock and cancels any pending warning.
  let denialSpread = state.denialSpread;
  let settledBoard = cascadedBoard;
  if (denialSpread) {
    const addressed = blockerHealth(cascadedBoard) < blockerHealth(state.board);
    const stepped = stepDenialZone(cascadedBoard, denialSpread, addressed);
    settledBoard = stepped.board;
    denialSpread = stepped.denial;
  }

  // A settled cascade can leave a board with zero legal moves — confirmed
  // during real mobile playtesting as a genuine mid-play stuck state, not
  // just a theoretical edge case. `generateLevel` (generator.ts) already
  // runs this exact hasLegalMoves -> shuffle rescue once at level creation;
  // reusing both functions here rather than writing new logic keeps
  // "board is playable" a single guarantee enforced the same way at both
  // points it can be violated. No event fires for this — a shuffle should
  // read as silent and immediate to the player, not an announced
  // interruption, per CLAUDE.md's calm-pacing constraint.
  //
  // shuffle() itself now throws rather than silently handing back an
  // illegal board when it genuinely can't find or construct a legal
  // rearrangement (see engine/matrix.ts's shuffle-hardening entry) — the
  // right contract for a reusable pure function, and exactly what
  // generateLevel's own call site above wants (a level that can never be
  // made legal is a real content bug worth failing loudly on). But THIS
  // call site is mid-play, not level creation, and the comment above is
  // explicit that a rescue should read as silent and immediate — turning a
  // failed safety net into a crash would be the exact "announced
  // interruption" this was written to avoid. `settledBoard` itself is never
  // in question here (it's a real move's real cascaded result, always
  // match/square-free); a failed shuffle only means this specific stuck
  // state didn't get rescued, not that anything is actually broken. So this
  // degrades gracefully — logged (not silent), never thrown further.
  let resolvedBoard = settledBoard;
  if (!hasLegalMoves(settledBoard)) {
    try {
      resolvedBoard = shuffle(settledBoard);
    } catch (err) {
      console.error(
        '[gameState] applyMove: the shuffle rescue could not find a legal rearrangement — leaving the board as-is.',
        err
      );
    }
  }

  const totalCleared = { ...state.totalCleared };
  for (const [matchType, count] of Object.entries(clearedByMatchType)) {
    totalCleared[matchType] = (totalCleared[matchType] ?? 0) + count;
  }

  // A 'score' objective's currentCount tracks cumulative move-score instead
  // of any single matchType's clear count — see scoreGained above. A
  // 'clearance' objective's currentCount tracks cumulative layers cleared,
  // the same shape — see layersCleared above. An 'escort' objective's
  // currentCount tracks cumulative dropdown pieces collected, the same
  // shape again — see dropdownCollected above.
  const objectives: Objective[] = state.objectives.map((objective) => ({
    ...objective,
    currentCount:
      objective.type === 'score'
        ? objective.currentCount + scoreGained
        : objective.type === 'clearance'
          ? objective.currentCount + layersCleared
          : objective.type === 'escort'
            ? objective.currentCount + dropdownCollected
            : objective.currentCount + (clearedByMatchType[objective.targetMatchType ?? ''] ?? 0),
  }));

  const movesRemaining = state.movesRemaining - 1;

  let status: GameStatus = state.status;
  let pauseReason: PauseReason = state.pauseReason;
  // Win requires every objective met, not just one — a two-objective level
  // with only one target satisfied stays in_progress (or pauses on moves)
  // exactly like an unmet single-objective level always has.
  if (objectives.every((objective) => objective.currentCount >= objective.targetCount)) {
    status = 'won';
    pauseReason = null;
  } else if (movesRemaining <= 0) {
    status = 'paused_awaiting_input';
    pauseReason = 'moves';
  }

  const events: EngineEvent[] = [];
  if (cascadeCount >= COMBO_STREAK_THRESHOLD) {
    events.push({ type: 'combo_streak', cascadeCount, clearedByMatchType });
  }
  // paused_awaiting_input IS this phase's "loss" outcome (see DECISIONS.md)
  // — a resource hit zero without the objective met, and the matching grant
  // function (grantBonusMoves / grantBonusLife) is the only way out of it.
  // The summary event fires for both ways a level can end: reaching the
  // objective, or running out of a resource.
  if (status === 'won' || status === 'paused_awaiting_input') {
    events.push({
      type: 'level_summary',
      outcome: status,
      reason: pauseReason,
      clearedByMatchType: totalCleared,
    });
  }

  const newState: GameState = {
    ...state,
    board: resolvedBoard,
    movesRemaining,
    objectives,
    status,
    pauseReason,
    totalCleared,
    denialSpread,
    layerCells,
  };

  // resolveCascades' last step is the pre-rescue cascadedBoard; the state
  // actually committed is resolvedBoard (identical unless a zero-legal-move
  // rescue shuffle fired). Overwrite the final step so animating through
  // `steps` always ends exactly on state.board — a rescue shuffle folds into
  // that last beat rather than becoming a visible extra rearrangement, per
  // its "silent and immediate" intent (see DECISIONS.md). steps is always
  // non-empty here: an ordinary swap reached this point only because `swapped`
  // had at least one match (resolveCascades ran ≥1 pass), and every special
  // swap (bomb / cross / supercombo) returns the detonation itself as step one
  // via resolveClearSet — so there is always a final step to overwrite.
  const finalSteps = steps.slice();
  finalSteps[finalSteps.length - 1] = resolvedBoard;

  return {
    state: newState,
    events,
    steps: finalSteps,
    multiSpecialFired: maxSpecialsFired >= MULTI_SPECIAL_THRESHOLD,
  };
}

// The engine doesn't know or care what triggers this (rewarded ad, IAP,
// whatever) — that decision lives entirely outside the engine. It only
// knows how to resume play from the paused state. Checks pauseReason (not
// just status) so this stays correct if a second pause reason is ever
// reintroduced — see PauseReason's comment on why 'lives' was removed.
export function grantBonusMoves(state: GameState, n: number): GameState {
  if (state.status !== 'paused_awaiting_input' || state.pauseReason !== 'moves') {
    return state;
  }
  return {
    ...state,
    movesRemaining: state.movesRemaining + n,
    status: 'in_progress',
    pauseReason: null,
  };
}

// The free, player-invoked "fresh board" affordance (distinct from the
// removed purchasable power-up tray — see DEFERRED_COMPLEXITY.md's tray
// entry — and from applyMove's own silent stuck-board rescue above, which
// only ever fires automatically when hasLegalMoves already fails). Reuses
// the exact same shuffle() every rescue path already trusts rather than
// building a second reshuffle, so "the board is playable after a shuffle" stays
// one guarantee, not two. Only valid mid-play (status 'in_progress') — a
// paused/won/lost state has no board a player should be able to reach in to
// reshuffle. Costs nothing: movesRemaining, lives, objectives, denialSpread,
// and layerCells are all left untouched, only board changes.
export function requestManualShuffle(state: GameState): GameState {
  if (state.status !== 'in_progress') {
    return state;
  }
  return {
    ...state,
    board: shuffle(state.board),
  };
}

export interface SaveData {
  skinId: string;
  currentLevel: number;
  lives: number;
  // Known, accepted tradeoff: this is set from Date.now() at grant time, so
  // a player can get more lives than intended by winding the device clock
  // back. Not worth solving at this scale — see CLAUDE.md's Data Model
  // Notes and DECISIONS.md.
  livesLastRegenAt: number;
  itemsCollected: Record<string, number>;
  powerUpCounts: Record<string, number>;
  // 1-based level numbers the player has won at least once, feeding the
  // dashboard screen. Optional (not just defaulted to []) so save files
  // written before the level queue existed still parse — a hard schema
  // migration isn't worth it at this scale, same call as livesLastRegenAt
  // above. Every new write (see appPersistence.ts's buildSaveData) always
  // populates it; readers fall back to [] themselves.
  completedLevels?: number[];
  // IDs of one-time tutorial popups the player has already dismissed (e.g.
  // 'blocker') — a plain string list, not a bespoke boolean per tutorial,
  // so a later power-up tutorial is one more entry here rather than a
  // second bespoke flag and a second bespoke check. Optional for the same
  // pre-existing-save-file reason as completedLevels above; readers fall
  // back to [] themselves.
  seenTutorials?: string[];
  // IDs of recipe cards (skinConfig.recipeCards) the player has unlocked by
  // winning that card's milestone level at least once — same plain-list,
  // optional-for-pre-existing-saves shape as seenTutorials above, not a
  // richer "unlocked at timestamp X" record, since nothing reads anything
  // beyond membership (see appPersistence.ts's unlockRecipeCard).
  unlockedRecipeCards?: string[];
  // Best-ever star rating (1-3) earned per level, keyed by 1-based level
  // number — feeds the level map's per-node star row. `1 | 2 | 3` mirrors
  // components/wonActions.ts's StarRating literal-for-literal rather than
  // importing it: engine/ never imports from components/ (CLAUDE.md's Leak
  // Test — this file must stay ignorant of any presentation-layer type).
  // "Best-ever", not "most recent attempt": a replay that scores lower never
  // overwrites an already-earned higher rating (see appPersistence.ts's
  // recordLevelStars) — a worse replay shouldn't erase a genuinely earned
  // result, matching this game's calm, non-punishing design. Optional for
  // the same pre-existing-save-file reason as completedLevels/seenTutorials
  // above; readers fall back to {} themselves. A completed level absent from
  // this map (any save written before this field existed) has no honestly
  // knowable past rating, so it renders as unrated rather than a fabricated
  // guess — see components/LevelMap.tsx.
  levelStars?: Record<number, 1 | 2 | 3>;
  // Whether in-game sound effects (match/cascade/win) should play. Optional
  // for the same pre-existing-save-file reason as completedLevels/
  // seenTutorials/unlockedRecipeCards above — a save written before this
  // field existed still parses; App.tsx's applyLoadedSave resolves the real
  // default (off, per CLAUDE.md's Design Constraints: the target player
  // finds game sound distracting) at read time via `??`, never here.
  soundEnabled?: boolean;
  // Whether haptic feedback (a light tap on a successful match) should
  // fire. Independent of soundEnabled — a different sensory channel, so a
  // player can want tactile confirmation without audio or vice versa. Same
  // optional-for-old-saves shape; App.tsx's applyLoadedSave resolves the
  // real default (also off, for the same calm-by-default reasoning as
  // sound — no documented user research exists for haptics specifically).
  hapticsEnabled?: boolean;
  // How many level losses in a row the player has just had, hand-built or
  // generated — see appPersistence.ts's consecutiveLossesAfterLoss/
  // shouldApplyBreather and CLAUDE.md's difficulty-breather entry. Reset to
  // 0 on any win, and consumed back to 0 the instant a breather is actually
  // granted to a generated level. Optional for the same pre-existing-save-
  // file reason as every other field above; App.tsx's applyLoadedSave
  // resolves the real default (0 — a save with no history of this yet has
  // no streak) at read time via `??`, never here.
  consecutiveLosses?: number;
  // The most recent uncaught crash ErrorBoundary caught, if any — see
  // recordCrash below and components/ErrorBoundary.tsx/errorRecovery.ts.
  // This is the one real signal that a crash happened on a real device with
  // nobody watching a console, per CLAUDE.md's no-silent-failures rule:
  // no remote telemetry service exists in this project (see
  // DEFERRED_COMPLEXITY.md), so this in-app record — checkable later on the
  // device itself, e.g. via components/Settings.tsx — is the lightest real
  // alternative rather than building one. "Most recent", not a growing
  // list: a single field is enough to notice something went wrong at all,
  // and an unbounded crash log on a device nobody actively monitors would
  // just grow forever with no reader to prune it.
  lastCrash?: CrashRecord;
}

export interface CrashRecord {
  message: string;
  stack?: string;
  // Date.now() at the moment of the crash — a real timestamp, not a
  // relative "just now," since this is only ever read back much later.
  timestamp: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number');
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every((entry) => typeof entry === 'number');
}

function isValidLevelStars(value: unknown): value is Record<number, 1 | 2 | 3> {
  return isPlainObject(value) && Object.values(value).every((entry) => entry === 1 || entry === 2 || entry === 3);
}

// The one place that decides a loaded save is trustworthy enough to build a
// session from — see loadSave below and engine/DECISIONS.md's
// defensive-save-loading entry. Checks the required backbone fields
// strictly (a save missing or misshaping any of these can't have come from
// this game) and every field added since (completedLevels, seenTutorials,
// etc.) only IF PRESENT — those are genuinely optional so a save written
// before a field existed still parses (see each field's own comment above),
// but if present they must still be the right shape, or a save could pass
// this check while carrying, say, a string where seenTutorials expects an
// array — which would parse "successfully" here only to throw the first
// time something calls .includes()/.some() on it downstream. Deliberately
// NOT exported: nothing outside loadSave needs to ask "is this valid,"
// they only ever get a real SaveData or null back.
function isValidSaveData(value: unknown): value is SaveData {
  if (!isPlainObject(value)) return false;

  if (typeof value.skinId !== 'string') return false;
  if (typeof value.currentLevel !== 'number') return false;
  if (typeof value.lives !== 'number') return false;
  if (typeof value.livesLastRegenAt !== 'number') return false;
  if (!isNumberRecord(value.itemsCollected)) return false;
  if (!isNumberRecord(value.powerUpCounts)) return false;

  if (value.completedLevels !== undefined && !isNumberArray(value.completedLevels)) return false;
  if (value.seenTutorials !== undefined && !isStringArray(value.seenTutorials)) return false;
  if (value.unlockedRecipeCards !== undefined && !isStringArray(value.unlockedRecipeCards)) return false;
  if (value.levelStars !== undefined && !isValidLevelStars(value.levelStars)) return false;
  if (value.soundEnabled !== undefined && typeof value.soundEnabled !== 'boolean') return false;
  if (value.hapticsEnabled !== undefined && typeof value.hapticsEnabled !== 'boolean') return false;
  if (value.lastCrash !== undefined && !isValidCrashRecord(value.lastCrash)) return false;

  return true;
}

function isValidCrashRecord(value: unknown): value is CrashRecord {
  if (!isPlainObject(value)) return false;
  if (typeof value.message !== 'string') return false;
  if (value.stack !== undefined && typeof value.stack !== 'string') return false;
  if (typeof value.timestamp !== 'number') return false;
  return true;
}

// Small interface matching @react-native-async-storage/async-storage's
// actual getItem/setItem shape (both real signatures also accept an
// optional trailing callback, which is structurally compatible with this
// narrower shape), so the real package below is a drop-in `AsyncStorageLike`
// with no adapter code needed. `createInMemoryStorage` is kept as an
// explicit, dependency-free option for tests that don't want to touch real
// storage — see DECISIONS.md.
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  // Deletes a key entirely — the honest way to clear a save (writing an empty
  // value would leave a non-null blob that loadSave would then JSON.parse).
  // The real AsyncStorage.removeItem(key, callback?) is structurally compatible
  // with this narrower shape, same as getItem/setItem above, so the package
  // stays a drop-in with no adapter.
  removeItem(key: string): Promise<void>;
}

export function createInMemoryStorage(): AsyncStorageLike {
  const store = new Map<string, string>();
  return {
    async getItem(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async setItem(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

// Real, persisted storage: native iOS/Android get the actual native
// AsyncStorage module; Expo's web target gets the package's own
// window.localStorage-backed fallback (see
// node_modules/@react-native-async-storage/async-storage/src/AsyncStorage.ts)
// — both resolve automatically through this one import, no platform branch
// needed here.
const defaultStorage: AsyncStorageLike = AsyncStorage;

// Generic namespace tag for this save format — deliberately not a skin/product
// name (that would fail CLAUDE.md's Leak Test the same way the old hardcoded
// 'lalas-kitchen' literal did: engine code carrying a specific skin's name).
// skinId is the only thing that varies the key, so it's the sole thing that
// determines which skin's data a key resolves to — the same "engine never
// knows the skin" boundary every other part of this pipeline already holds.
const SAVE_KEY_NAMESPACE = 'save';

// Exported so it's a single, directly testable source of truth for the real
// key format — not a private detail other files (tests included) would
// otherwise need to reconstruct by hand and risk drifting from.
export function saveKey(skinId: string): string {
  return `${SAVE_KEY_NAMESPACE}:${skinId}`;
}

// A corrupted or malformed save (truncated by an interrupted write, storage
// corruption, or a future save-format change an old blob doesn't match) used
// to throw straight out of JSON.parse with no try/catch anywhere above it —
// and since no ErrorBoundary existed either, that crash would repeat on
// every subsequent launch, permanently, with the only "fix" being an app
// data wipe the player has no way to know to perform. Falling back to null
// (this function's own, already-real "no save yet" contract — see
// App.tsx's applyLoadedSave(null), also what the dev-only reset already
// uses) costs at most that one corrupted save's progress, a real but
// completely different category of problem than the app refusing to open
// at all. See engine/DECISIONS.md's defensive-save-loading entry.
export async function loadSave(
  skinId: string,
  storage: AsyncStorageLike = defaultStorage
): Promise<SaveData | null> {
  const raw = await storage.getItem(saveKey(skinId));
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[gameState] loadSave: save for skin "${skinId}" is not valid JSON — treating as a fresh save.`,
      err
    );
    return null;
  }

  if (!isValidSaveData(parsed)) {
    console.error(
      `[gameState] loadSave: save for skin "${skinId}" failed schema validation — treating as a fresh save.`,
      parsed
    );
    return null;
  }

  return parsed;
}

export async function saveProgress(
  skinId: string,
  data: SaveData,
  storage: AsyncStorageLike = defaultStorage
): Promise<void> {
  await storage.setItem(saveKey(skinId), JSON.stringify(data));
}

// Called from components/ErrorBoundary.tsx's componentDidCatch — the one
// in-app crash record this project has (see SaveData.lastCrash's own
// comment for why this exists instead of a remote telemetry service).
// Reads whatever the CURRENT save actually is (loadSave already falls back
// to null on a corrupted blob — see the defensive-save-loading entry above)
// and patches in just `lastCrash`, rather than rebuilding a full SaveData
// via appPersistence.ts's buildSaveData: a crash can happen with no valid
// in-memory app state to rebuild one from, but "whatever's already on disk,
// plus this one field" only ever needs what's already there. A genuinely
// fresh install (no save yet) still gets a real record — currentLevel: 1 and
// every other field at its documented default, mirroring App.tsx's own
// applyLoadedSave(null) fresh-save shape, so a crash before the player has
// ever completed anything is still recorded rather than silently dropped.
export async function recordCrash(
  skinId: string,
  crash: CrashRecord,
  storage: AsyncStorageLike = defaultStorage
): Promise<void> {
  const existing = await loadSave(skinId, storage);
  const base: SaveData = existing ?? {
    skinId,
    currentLevel: 1,
    lives: 0,
    livesLastRegenAt: Date.now(),
    itemsCollected: {},
    powerUpCounts: {},
  };
  await saveProgress(skinId, { ...base, lastCrash: crash }, storage);
}

// Deletes this skin's entire save so the next loadSave returns null — the exact
// "fresh install" state. Used only by the dev-only reset (see App.tsx's
// handleDevReset); a normal player never triggers it. Removing the key (rather
// than writing a blank SaveData) means "no save" and "reset save" are the same
// state, so the app's real first-run path can be reused verbatim afterward.
export async function clearSave(
  skinId: string,
  storage: AsyncStorageLike = defaultStorage
): Promise<void> {
  await storage.removeItem(saveKey(skinId));
}
