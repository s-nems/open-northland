import { ONE, tileToScreen } from '../iso.js';
import type { DrawKind, SpriteState } from './draw-item.js';

/**
 * The PURE snapshot-component readers — every function here turns one plain-cloned snapshot
 * component into the render-side fact a {@link import('./draw-item.js').DrawItem} carries (state, facing,
 * carried good, build progress, …). Split out of `scene.ts` so the *reads* (total, defensive
 * decoders of plain data) live apart from the *scene assembly* (projection + depth sort) that
 * consumes them — each is unit-testable and changeable on its own.
 *
 * Shared contract: every reader is a pure, TOTAL function of a snapshot entity's `components`
 * record. A missing or malformed component reads as its "absent" value (`null`/`undefined`/`{}`),
 * never a throw — the scene must survive any snapshot shape. Nothing here re-enters the sim.
 */

/**
 * The snapshot's `Position` component value, as plain data (Fixed = a scaled integer). Mirrors the
 * sim component; redeclared here so `render` doesn't reach into sim internals for a 2-field shape.
 */
interface PositionValue {
  x: number;
  y: number;
}

export function readPosition(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Position as PositionValue | undefined;
  if (p === undefined || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  return p;
}

/** Classify a snapshot entity by which marker component it carries (terrain tiles are separate). */
export function classify(components: Readonly<Record<string, unknown>>): DrawKind | null {
  // An in-flight munition (a bare Projectile + Position entity, the ranged-combat shot) — drawn as the
  // minimal oriented arrow (no decoded arrow bob exists in the extracted [bobseq] lanes; a named gap).
  if ('Projectile' in components) return 'projectile';
  if ('Building' in components) return 'building';
  if ('Resource' in components) return 'resource';
  // A wild berry bush (Position + BerryBush marker) — drawn per-species from the bush atlas, ripe or bare
  // by its forage/regrow state. Checked before Settler/Stockpile (a bush is neither); it carries no
  // Resource, so it never collides with the resource path above.
  if ('BerryBush' in components) return 'berrybush';
  // A felled tree's leftover stump/debris — pure decor (a Position + Stump marker, no other drawable
  // component), drawn by a per-good {@link import('../sprites/index.js').ResourceTypeBinding} like a resource
  // node but from the dead-tree/debris atlas. Checked before Settler/Stockpile (a stump is neither).
  if ('Stump' in components) return 'stump';
  if ('Settler' in components) return 'settler';
  // A designated delivery flag — a PURE MARKER (Position + DeliveryFlag, no Stockpile: it holds no goods,
  // the harvest piles as separate loose heaps around it). Drawn as the flag graphic and painted ON TOP of
  // any co-located heap. Checked before the Stockpile paths since a flag carries no Stockpile of its own.
  if ('DeliveryFlag' in components) return 'stockpile';
  // A freshly-felled trunk still on the ground (a Stockpile carrying the GroundDrop marker) draws its
  // pickup-stage LOG graphic, distinct from a tidy delivery pile — the original shows a different object
  // for uncollected harvest than for the stored heap. Checked before the plain Stockpile so a marked drop
  // never falls through to the flag/heap path.
  if ('GroundDrop' in components && 'Stockpile' in components) return 'grounddrop';
  // A bare Stockpile with NO Building is a loose ground pile (the gathering economy's dropped goods heaps,
  // the yard a flag-bound gatherer stacks around its flag). Checked AFTER Building so a warehouse/HQ store —
  // which carries both Building and Stockpile — stays a `building`, matching the sim's own ground-pile rule
  // (`nearestGroundPile`: Stockpile ∧ Position ∧ ¬Building).
  if ('Stockpile' in components) return 'stockpile';
  return null; // an entity with a Position but no drawable marker is skipped (e.g. a pure mover)
}

/**
 * The atomic id a snapshot entity is mid-execution on, or `null`. Reads only the `atomicId` field of
 * the (plain-cloned) `CurrentAtomic` component — the same numeric id the sim stores as the `setatomic`
 * animation join key.
 */
export function readActingAtomic(components: Readonly<Record<string, unknown>>): number | null {
  const a = components.CurrentAtomic as { atomicId?: unknown } | undefined;
  if (a === undefined || typeof a.atomicId !== 'number') return null;
  return a.atomicId;
}

/**
 * A building entity's type id — the `Building.buildingType` (the `[GfxHouse]` `LogicType` the placement
 * command stamped). Stamped onto the building draw item as {@link import('./draw-item.js').DrawItem.typeId}
 * so a per-type {@link import('../sprites/index.js').BuildingTypeBinding} can draw each building its own house
 * bob. `undefined` for a missing/malformed component (the binding then falls back to its default house).
 */
export function readBuildingType(components: Readonly<Record<string, unknown>>): number | undefined {
  const b = components.Building as { buildingType?: unknown } | undefined;
  return b !== undefined && typeof b.buildingType === 'number' ? b.buildingType : undefined;
}

/**
 * An UNDER-CONSTRUCTION building's progress as a whole percent (0..99), or `undefined` for a finished
 * building (`built >= ONE` — the normal body draw applies) or a missing/malformed component. The sim's
 * `Building.built` is a fixed-point fraction of ONE; the floor keeps a nearly-done site below 100 so
 * the construction stages stay up until the finish tick flips the draw to the completed body.
 */
export function readBuiltPct(components: Readonly<Record<string, unknown>>): number | undefined {
  const b = components.Building as { built?: unknown } | undefined;
  if (b === undefined || typeof b.built !== 'number' || !Number.isFinite(b.built) || b.built >= ONE) {
    return undefined; // finished (or malformed — NaN would poison every range test downstream)
  }
  return Math.max(0, Math.min(99, Math.floor((b.built * 100) / ONE)));
}

/**
 * Whether a building is mid PRODUCTION cycle — the sim `Production` component's presence (it exists
 * exactly while a cycle runs, `productionSystem`). Stamped onto the building draw item as
 * {@link import('./draw-item.js').DrawItem.working}, the switch an animated state overlay flips on
 * (the mill's rotor spins while the mill produces). Presence is the whole signal — the component's
 * `elapsed`/`duration` counters are sim-internal, never read here.
 */
export function readProducing(components: Readonly<Record<string, unknown>>): boolean {
  return 'Production' in components;
}

/**
 * The whole ticks the settler has executed in its current atomic — the sim's `CurrentAtomic.elapsed`
 * (a plain integer, no fixed-point rescale). The action's animation clock: a directional swing advances
 * at a fixed cadence over these ticks, so its speed never depends on the action's duration. Returns
 * `null` when not mid-atomic.
 */
export function readAtomicElapsed(components: Readonly<Record<string, unknown>>): number | null {
  const a = components.CurrentAtomic as { elapsed?: unknown } | undefined;
  if (a === undefined || typeof a.elapsed !== 'number') return null;
  return a.elapsed;
}

/**
 * The bob block index per SCREEN-heading octant, indexed by `round(angle / 45°) mod 8` with the angle
 * from `Math.atan2(dy, dx)` (screen +x right, +y down): octant 0 = E, 1 = SE, 2 = S, 3 = SW, 4 = W,
 * 5 = NW, 6 = N, 7 = NE. The `CR_Hum_Body` sheet's 8 direction blocks are NOT a uniform screen-angle
 * rotation — each was read off the decoded frames one by one (`source basis` "Settler facing";
 * blocks face `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`) — hence the lookup.
 */
const HEADING_OCTANT_TO_BLOCK: readonly number[] = [4, 5, 6, 0, 1, 2, 7, 3];

/** The S-facing block — the fallback for an (unreachable) out-of-table octant lookup. */
const DEFAULT_HEADING_BLOCK = 6;

/**
 * The facing block whose sprite looks along the given SCREEN heading (px delta, +x right, +y down):
 * quantize the heading angle to the nearest of the 8 octants and look the block up. Facing must be
 * derived from the PROJECTED heading, not the grid delta's sign — under the staggered raster the
 * same grid step `(0,+1)` heads screen down-RIGHT from an even row but down-LEFT from an odd one
 * (the sign-pair table this replaced faced both as "south", one of the visible zigzag artifacts;
 * source basis "Settler facing"). Floats are fine — render-only, never re-enters the sim.
 */
function facingFromScreenHeading(dx: number, dy: number): number {
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)); // -4..4, 0 = screen right
  return HEADING_OCTANT_TO_BLOCK[((octant % 8) + 8) % 8] ?? DEFAULT_HEADING_BLOCK;
}

/**
 * One {@link PathFollow} waypoint, as plain snapshot data (Fixed = scaled int). Redeclared here so
 * `render` doesn't import the sim component shape for a 2-field read.
 */
interface WaypointValue {
  x: number;
  y: number;
}

/**
 * The facing block whose sprite looks from one TILE toward another — the combat-facing seam: an attacker
 * mid-swing has no {@link PathFollow} heading (it stopped to strike), so it faces its target by the
 * PROJECTED screen step between the two tiles (the same parity-correct projection {@link readFacing}
 * uses). Both coordinates are FLOAT tile coordinates (the snapshot's Fixed position already divided by
 * ONE). `undefined` when the two project to the same point (no heading — coincident/adjacent-rounded).
 */
export function facingTowardTile(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number | undefined {
  const f = tileToScreen(from.x, from.y);
  const t = tileToScreen(to.x, to.y);
  const dx = t.x - f.x;
  const dy = t.y - f.y;
  if (dx === 0 && dy === 0) return undefined;
  return facingFromScreenHeading(dx, dy);
}

/**
 * A settler's combat-**engagement** flag — whether the sim stamped the `Engagement` marker on it (it is
 * advancing on or fighting an enemy). A render fact orthogonal to {@link readSpriteState}: a binding reads
 * it to pick the readied `..._agressive` gait ({@link import('../draw-item.js').DrawItem.engaged}). Presence
 * is the whole signal — the marker's `repathAt` field is sim-internal, never read here.
 */
export function readEngaged(components: Readonly<Record<string, unknown>>): boolean {
  return 'Engagement' in components;
}

/**
 * The entity a settler's current atomic acts ON — the `CurrentAtomic.targetEntity` (the enemy it swings
 * at, the resource it harvests). Used to FACE an attacker at its target during a stationary swing: the
 * target's LIVE position is looked up in the scene builder (a target moves, so its id — not a snapshot
 * of its tile — is the stable handle). `null` when the settler runs no atomic or its atomic has no entity
 * target. (`CurrentAtomic.targetTile` stays sim-internal and is never populated today, so it is not read.)
 */
export function readAtomicTargetEntity(components: Readonly<Record<string, unknown>>): number | null {
  const a = components.CurrentAtomic as { targetEntity?: unknown } | undefined;
  if (a === undefined || typeof a.targetEntity !== 'number') return null;
  return a.targetEntity;
}

/**
 * The STORE a settler's running atomic exchanges goods with — the `pileup` deposit's `store` or the
 * `pickup` lift's `from` — or `null` for any other/no atomic. The scene builder hides a settler whose
 * exchange partner is a completed BUILDING: the original's carrier walks INTO the house and vanishes
 * for the exchange (observed), so instead of pantomiming the deposit at the door the settler is not
 * drawn for the atomic's duration (it "entered"), reappearing when the exchange completes.
 */
export function readStoreExchangeRef(components: Readonly<Record<string, unknown>>): number | null {
  const a = components.CurrentAtomic as { effect?: unknown } | undefined;
  const effect = a?.effect as { kind?: unknown; store?: unknown; from?: unknown } | undefined;
  if (effect === undefined || effect === null) return null;
  if (effect.kind === 'pileup' && typeof effect.store === 'number') return effect.store;
  if (effect.kind === 'pickup' && typeof effect.from === 'number') return effect.from;
  return null;
}

/**
 * The entity id an in-flight projectile homes on (the sim `Projectile.target`), or `null` for a
 * missing/malformed component. The scene aims the drawn arrow's {@link
 * import('./draw-item.js').DrawItem.rotation} at this target's live position — the sim re-aims its
 * homing step at the same target each tick, so the drawn heading tracks the true flight.
 */
export function readProjectileTarget(components: Readonly<Record<string, unknown>>): number | null {
  const p = components.Projectile as { target?: unknown } | undefined;
  if (p === undefined || typeof p.target !== 'number') return null;
  return p.target;
}

/**
 * The point a projectile was LOOSED from (the sim `Projectile.originX/originY`, fixed-point), or `null`
 * for a missing/malformed component. With the live target position it fixes the flight chord, and the
 * fraction flown along it is the scene builder's ballistic-arc parameter (lob height + tangent). A shot
 * with no readable origin simply draws flat along the straight line — never a throw.
 */
export function readProjectileOrigin(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Projectile as { originX?: unknown; originY?: unknown } | undefined;
  if (p === undefined || typeof p.originX !== 'number' || typeof p.originY !== 'number') return null;
  return { x: p.originX, y: p.originY };
}

/**
 * Derive a settler's facing direction index (0..7) from its live heading: the PROJECTED screen step
 * from its current position toward the {@link PathFollow} waypoint it is walking to, quantized to the
 * block whose sprite faces that heading ({@link facingFromScreenHeading}). Projecting through
 * `tileToScreen` (not reading the grid delta's sign) is what makes facing parity-correct under the
 * staggered raster: a lattice leg one row down faces SE from an even row and SW from an odd one.
 * Returns `undefined` when there is no movement to read a heading from (no path, or already on the
 * waypoint) — the binding then falls back to a default facing.
 */
export function readFacing(components: Readonly<Record<string, unknown>>): number | undefined {
  const pf = components.PathFollow as { waypoints?: unknown; index?: unknown } | undefined;
  const pos = readPosition(components);
  if (pf === undefined || pos === null || !Array.isArray(pf.waypoints)) return undefined;
  const idx = typeof pf.index === 'number' ? pf.index : 0;
  const wp = pf.waypoints[idx] as WaypointValue | undefined;
  if (wp === undefined || typeof wp.x !== 'number' || typeof wp.y !== 'number') return undefined;
  const from = tileToScreen(pos.x / ONE, pos.y / ONE);
  const to = tileToScreen(wp.x / ONE, wp.y / ONE);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return undefined; // already there — no heading
  return facingFromScreenHeading(dx, dy);
}

/**
 * Derive a sprite's coarse {@link SpriteState} from its snapshot components, in priority order:
 * mid-atomic (`CurrentAtomic`) ⇒ `acting`, else IN TRANSIT (a live path OR a pending goal) ⇒ `moving`,
 * else `idle`. Acting wins over moving because a settler that started an atomic has stopped to act even
 * if a stale path lingers.
 *
 * "In transit" is more than a live {@link PathFollow}: a unit re-issuing its route drops the PathFollow
 * for a tick while it still holds a {@link MoveGoal} / a freshly-queued {@link PathRequest} — most
 * visibly a combat chaser, which re-paths toward a MOVING enemy every few ticks (systems/conflict
 * `REPATH_CADENCE`). Treating that gap as `idle` made the walk animation drop to the standing pose for a
 * frame each tile — the reported march "stutter". A **failed** PathRequest is the opposite case: the goal
 * is unreachable and the unit is genuinely stuck, so it stays `idle` rather than moonwalk in place.
 */
export function readSpriteState(components: Readonly<Record<string, unknown>>): SpriteState {
  if (readActingAtomic(components) !== null) return 'acting';
  if ('PathFollow' in components) return 'moving';
  const req = components.PathRequest as { failed?: unknown } | undefined;
  if (req !== undefined) return req.failed === true ? 'idle' : 'moving';
  if ('MoveGoal' in components) return 'moving';
  return 'idle';
}

/**
 * What a snapshot settler is hauling — the (plain-cloned) `Carrying` component's `goodType` (the sim
 * adds the component on harvest, removes it on deposit), or `null` when it carries nothing. Read as a
 * fact orthogonal to {@link readSpriteState} so a binding can pick the loaded gait (and the per-good
 * look) while the settler still reads as `moving`/`acting`. A present-but-malformed component still
 * reads as carrying (goodType `undefined` → the generic loaded look).
 */
export function readCarrying(components: Readonly<Record<string, unknown>>): { goodType?: number } | null {
  const c = components.Carrying as { goodType?: unknown } | undefined;
  if (c === undefined) return null;
  return typeof c.goodType === 'number' ? { goodType: c.goodType } : {};
}

/**
 * A settler's `Settler.jobType` — the per-character body/head join key
 * ({@link import('./draw-item.js').DrawItem.jobType}) — or `undefined` for a jobless (`null`) settler /
 * malformed component (the binding then falls back to its default look).
 */
export function readJobType(components: Readonly<Record<string, unknown>>): number | undefined {
  const s = components.Settler as { jobType?: unknown } | undefined;
  return s !== undefined && typeof s.jobType === 'number' ? s.jobType : undefined;
}

/**
 * The `typeId` of the good in a settler's `Equipment.weapon` slot ({@link import('./draw-item.js').DrawItem.weaponGood}),
 * so the drawn warrior weapon follows the equipment slot. `undefined` when the settler has no `Equipment`
 * component or its weapon slot is empty/malformed (the binding then falls back to the `jobType` look).
 */
export function readEquipmentWeaponGood(components: Readonly<Record<string, unknown>>): number | undefined {
  const eq = components.Equipment as { weapon?: { goodType?: unknown } | null } | undefined;
  const goodType = eq?.weapon?.goodType;
  return typeof goodType === 'number' ? goodType : undefined;
}

/**
 * A resource node's `Resource.goodType` — the per-good join key
 * ({@link import('./draw-item.js').DrawItem.goodType}) a {@link import('../sprites/index.js').ResourceTypeBinding}
 * draws its species/deposit by (a tree for wood, a mine for iron). `undefined` for a missing/malformed
 * component (the binding then falls back to its default node).
 */
export function readResourceGood(components: Readonly<Record<string, unknown>>): number | undefined {
  const r = components.Resource as { goodType?: unknown } | undefined;
  return r !== undefined && typeof r.goodType === 'number' ? r.goodType : undefined;
}

/**
 * A resource node's render-variant tag — the snapshot's `Resource.gfxIndex`, the exact `[GfxLandscape]`
 * record a decoded map spawned it from ("pine 02", not the good's representative "yew 01"; an opaque
 * app-numbered index the sim never interprets). The per-VARIANT join key
 * ({@link import('./draw-item.js').DrawItem.gfxIndex}) a
 * {@link import('../sprites/index.js').ResourceTypeBinding.byGfxIndex} draws the exact original object
 * by. `undefined` for an admin/scene-spawned node — the per-good binding then draws the representative
 * node as before.
 */
export function readResourceGfxIndex(components: Readonly<Record<string, unknown>>): number | undefined {
  const r = components.Resource as { gfxIndex?: unknown } | undefined;
  return r !== undefined && typeof r.gfxIndex === 'number' ? r.gfxIndex : undefined;
}

/**
 * The visual fill LEVEL of a mined deposit ({@link import('./draw-item.js').DrawItem.level}): a small integer
 * in `[1, levels]`, `levels` when full (`remaining === initial`) stepping down to `1` as it nears empty.
 * Pure integer math — the node twin of {@link readStockpile}'s pile `fill`, done here (in the snapshot
 * read-view) off the `Resource.remaining` + `MineDeposit.initial`/`levels` the sim exposes, never
 * re-entering the sim. `ceil(remaining · levels / initial)`: a partially-drained deposit reads as the
 * next level UP, so it looks full until the first unit is actually gone and only the last unit shows the
 * dregs. Matches the mine gfx `state` numbering directly (level `k` ⇒ `state k`), which is authored full
 * at the highest state.
 */
export function depositVisualLevel(remaining: number, initial: number, levels: number): number {
  if (remaining <= 0 || initial <= 0 || levels <= 0) return 0;
  return Math.min(levels, Math.max(1, Math.ceil((remaining * levels) / initial)));
}

/**
 * A mined resource node's visual fill level ({@link import('./draw-item.js').DrawItem.level}), or `undefined`
 * for a plain node. Reads the node's {@link import('@vinland/sim').MineDeposit} `initial`/`levels` (its
 * deposit capacity) against `Resource.remaining` and buckets them via {@link depositVisualLevel}.
 * `undefined` when the node carries no `MineDeposit` (a tree/mushroom/full showcase node) — the binding
 * then draws its full-state frame.
 */
export function readResourceLevel(components: Readonly<Record<string, unknown>>): number | undefined {
  // A SOWN FIELD (a `Crop` resource) reads its growth stage as the level DIRECTLY: stage k ⇒ gfx state
  // k's frame (the wheat record's 5 growth states are authored smallest-at-1 → ripe-at-5, exactly the
  // stage numbering), so a field visibly grows as the CropGrowthSystem steps it. Checked before the
  // deposit shape — a field is never a mined deposit.
  const crop = components.Crop as { stage?: unknown; stages?: unknown } | undefined;
  if (crop !== undefined && typeof crop.stage === 'number' && typeof crop.stages === 'number') {
    return Math.min(crop.stages, Math.max(1, crop.stage));
  }
  const deposit = components.MineDeposit as { initial?: unknown; levels?: unknown } | undefined;
  const res = components.Resource as { remaining?: unknown } | undefined;
  if (deposit === undefined || typeof deposit.initial !== 'number' || typeof deposit.levels !== 'number') {
    return undefined;
  }
  if (res === undefined || typeof res.remaining !== 'number') return undefined;
  return depositVisualLevel(res.remaining, deposit.initial, deposit.levels);
}

/**
 * How many levels a mined node's / a crop's visual ladder has — the sim's `MineDeposit.levels` (or a
 * `Crop.stages`), the denominator {@link readResourceLevel}'s value is out of. Carried onto the draw item
 * ({@link import('./draw-item.js').DrawItem.levels}) so the resolver can RESCALE the sim's ladder onto the
 * bound record's own authored state count (stone rocks carry 4 states, ore mines 5 — the sim buckets both
 * into one catalog count). `undefined` exactly when {@link readResourceLevel} is (a plain full node).
 */
export function readResourceLevelCount(components: Readonly<Record<string, unknown>>): number | undefined {
  const crop = components.Crop as { stage?: unknown; stages?: unknown } | undefined;
  if (crop !== undefined && typeof crop.stage === 'number' && typeof crop.stages === 'number') {
    return crop.stages;
  }
  // The SAME narrowing readResourceLevel applies (including `initial`), so the two readers are
  // defined/undefined together — a deposit malformed for the level never yields a dangling count.
  const deposit = components.MineDeposit as { initial?: unknown; levels?: unknown } | undefined;
  const res = components.Resource as { remaining?: unknown } | undefined;
  if (deposit === undefined || typeof deposit.initial !== 'number' || typeof deposit.levels !== 'number') {
    return undefined;
  }
  if (res === undefined || typeof res.remaining !== 'number') return undefined;
  return deposit.levels;
}

/**
 * A stump's `Stump.goodType` — the resource it is the remains of (a chopped tree → wood), the per-good
 * join key ({@link import('./draw-item.js').DrawItem.goodType}) a {@link import('../sprites/index.js').ResourceTypeBinding}
 * draws its debris frame by. `undefined` for a missing/malformed component (the binding falls back to
 * its default).
 */
export function readStumpGood(components: Readonly<Record<string, unknown>>): number | undefined {
  const s = components.Stump as { goodType?: unknown } | undefined;
  return s !== undefined && typeof s.goodType === 'number' ? s.goodType : undefined;
}

/**
 * A berry bush's ripe/bare draw LEVEL ({@link import('./draw-item.js').DrawItem.level}): 2 when the bush
 * holds fruit (`BerryBush.ripe`), 1 when bare (foraged, regrowing). A per-bush
 * {@link import('../sprites/index.js').ResourceTypeBinding.byGfxIndex} two-frame list (bare, ripe) indexes
 * by it, so the drawn bush tracks its state as the sim forages/regrows it — the bush twin of a mined
 * node's shrink-by-level. `undefined` for a malformed component (the binding then draws its default frame).
 */
export function readBerryBushLevel(components: Readonly<Record<string, unknown>>): number | undefined {
  const b = components.BerryBush as { ripe?: unknown } | undefined;
  if (b === undefined || typeof b.ripe !== 'boolean') return undefined;
  return b.ripe ? 2 : 1;
}

/**
 * A berry bush's render-variant `gfxIndex` ({@link import('./draw-item.js').DrawItem.gfxIndex}) — the
 * decoded map's fruited-bush `[GfxLandscape]` record index the bush was spawned from (`BerryBush.gfxIndex`),
 * so a per-variant binding draws the exact bush species. `undefined` for a scene/synthetic bush with no
 * variant tag (the binding then draws its default bush).
 */
export function readBerryBushGfxIndex(components: Readonly<Record<string, unknown>>): number | undefined {
  const b = components.BerryBush as { gfxIndex?: unknown } | undefined;
  return b !== undefined && typeof b.gfxIndex === 'number' ? b.gfxIndex : undefined;
}

/**
 * What a bare {@link import('@vinland/sim').Stockpile} draw item represents: the good its ground pile
 * mainly holds + how many units (its per-fill heap frame), or `{}` when it holds nothing. A stockpile-kind
 * item with no good draws the flag graphic — that is a genuine **delivery flag** (`isFlag`, a marker with no
 * Stockpile at all, so it always reads `{}`). The snapshot clones a `Stockpile.amounts` Map to an ascending-by-goodType
 * `[goodType, amount]` array (see `inspect/snapshot.ts`), so this reads that plain shape. The pile's good
 * is the one it holds MOST of (strict `>` keeps the FIRST max — i.e. the lowest goodType on a tie,
 * *because* the snapshot pre-sorts `amounts` ascending by goodType). That canonical order is what makes
 * the pick reproducible across runs. A pile in the gathering economy holds a single good, so this is
 * unambiguous there; the max rule just keeps a mixed heap deterministic.
 */
export function readStockpile(components: Readonly<Record<string, unknown>>): {
  goodType?: number;
  fill?: number;
} {
  const s = components.Stockpile as { amounts?: unknown } | undefined;
  if (s === undefined || !Array.isArray(s.amounts)) return {};
  let bestGood: number | undefined;
  let bestAmount = 0;
  for (const pair of s.amounts) {
    if (!Array.isArray(pair)) continue;
    const good = pair[0];
    const amount = pair[1];
    if (typeof good !== 'number' || typeof amount !== 'number' || amount <= 0) continue;
    if (amount > bestAmount) {
      bestAmount = amount;
      bestGood = good;
    }
  }
  return bestGood === undefined ? {} : { goodType: bestGood, fill: bestAmount };
}

/**
 * The owning player slot of a settler — the sim `Owner.player`, the render team-colour key
 * ({@link import('./draw-item.js').DrawItem.player}). `undefined` when the settler carries no `Owner`
 * (wildlife / a neutral fixture), which the renderer draws in the base palette.
 */
export function readOwnerPlayer(components: Readonly<Record<string, unknown>>): number | undefined {
  const o = components.Owner as { player?: unknown } | undefined;
  return o !== undefined && typeof o.player === 'number' ? o.player : undefined;
}
