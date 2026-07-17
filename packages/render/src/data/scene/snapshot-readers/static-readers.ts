import { clamp } from '../../math.js';
import { ONE } from '../../projection/index.js';
import { readNumField } from '../../snapshot/index.js';

/**
 * Per-static-object component reads — the draw fields a building, resource node, stump or berry bush
 * carries (type, build progress, good, fill level, render variant), plus {@link assignStaticFields}.
 */

/**
 * A building entity's type id — `Building.buildingType` (the `[GfxHouse]` `LogicType` the placement
 * command stamped), stamped onto the draw item as {@link import('../draw-item.js').DrawItem.typeId} so a
 * per-type {@link import('../../sprites/index.js').BuildingTypeBinding} draws each building its own house
 * bob. `undefined` for a missing/malformed component (the binding falls back to its default house).
 */
function readBuildingType(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Building', 'buildingType');
}

/**
 * An under-construction building's progress as a whole percent (0..99), or `undefined` for a finished
 * building (`built >= ONE`), an UPGRADING one (its progress reads as {@link readUpgradePct} instead —
 * the old-tier body must keep drawing under the upgrade overlay, not the from-scratch stages), or a
 * missing/malformed component. The sim's `Building.built` is a fixed-point fraction of ONE; the floor
 * keeps a nearly-done site below 100 so the construction stages stay up until the finish tick flips
 * the draw to the completed body.
 */
export function readBuiltPct(components: Readonly<Record<string, unknown>>): number | undefined {
  if ('Upgrading' in components) return undefined; // an upgrade site — see readUpgradePct
  return risingPct(components);
}

/**
 * An UPGRADING building's progress as a whole percent (0..99), or `undefined` when the building is not
 * mid-upgrade (no `Upgrading` component, or already finished). The same floored `Building.built` read
 * as {@link readBuiltPct}; the two are mutually exclusive by construction, so a building draw is either
 * a from-scratch stage stack, an old-body-plus-upgrade-overlay, or the plain finished body.
 */
export function readUpgradePct(components: Readonly<Record<string, unknown>>): number | undefined {
  if (!('Upgrading' in components)) return undefined;
  return risingPct(components);
}

/** The shared floored `Building.built` → 0..99 percent read behind {@link readBuiltPct} /
 *  {@link readUpgradePct}; `undefined` for a finished building or a malformed component. */
function risingPct(components: Readonly<Record<string, unknown>>): number | undefined {
  const b = components.Building as { built?: unknown } | undefined;
  if (b === undefined || typeof b.built !== 'number' || !Number.isFinite(b.built) || b.built >= ONE) {
    return undefined; // finished (or malformed — NaN would poison every range test downstream)
  }
  return clamp(Math.floor((b.built * 100) / ONE), 0, 99);
}

/**
 * Whether a building is mid production cycle — the sim `Production` component's presence (it exists
 * exactly while a cycle runs, `productionSystem`). Stamped onto the draw item as
 * {@link import('../draw-item.js').DrawItem.working}, the switch an animated state overlay flips on (the
 * mill's rotor spins while it produces). Presence is the whole signal; the component's `elapsed`/`duration`
 * counters are sim-internal.
 */
export function readProducing(components: Readonly<Record<string, unknown>>): boolean {
  return 'Production' in components;
}

/**
 * A resource node's `Resource.goodType` — the per-good join key
 * ({@link import('../draw-item.js').DrawItem.goodType}) a {@link import('../../sprites/index.js').ResourceTypeBinding}
 * draws its species/deposit by (a tree for wood, a mine for iron). `undefined` for a missing/malformed
 * component (the binding falls back to its default node).
 */
function readResourceGood(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Resource', 'goodType');
}

/**
 * A resource node's render-variant tag — `Resource.gfxIndex`, the exact `[GfxLandscape]` record a decoded
 * map spawned it from ("pine 02", not the good's representative "yew 01"; an opaque app-numbered index the
 * sim never interprets). The per-variant join key ({@link import('../draw-item.js').DrawItem.gfxIndex}) a
 * {@link import('../../sprites/index.js').ResourceTypeBinding.byGfxIndex} draws by. `undefined` for an
 * admin/scene-spawned node — the per-good binding then draws the representative node.
 */
function readResourceGfxIndex(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Resource', 'gfxIndex');
}

/**
 * The visual fill level of a mined deposit ({@link import('../draw-item.js').DrawItem.level}): an integer in
 * `[1, levels]`, `levels` when full (`remaining === initial`) stepping down to `1` as it nears empty.
 * `ceil(remaining · levels / initial)` rounds up, so a partially-drained deposit looks full until the first
 * unit is actually gone and only the last unit shows the dregs. Level `k` ⇒ mine gfx `state k`, which is
 * authored full at the highest state.
 */
export function depositVisualLevel(remaining: number, initial: number, levels: number): number {
  if (remaining <= 0 || initial <= 0 || levels <= 0) return 0;
  return clamp(Math.ceil((remaining * levels) / initial), 1, levels);
}

/**
 * A mined node's / crop's visual ladder — its current fill `level` (in `[1, levels]`) and the `levels`
 * denominator it is out of — or `undefined` for a plain node (no `Crop`, no readable `MineDeposit`). The
 * single narrowing both {@link readResourceLevel} and {@link readResourceLevelCount} read, so the two are
 * defined/undefined together by construction.
 *
 * A sown field (a `Crop` resource) uses its growth stage as the level directly: stage k ⇒ gfx state k (the
 * wheat record's 5 growth states are authored smallest-at-1 → ripe-at-5, exactly the stage numbering).
 * Checked before the deposit shape — a field is never a mined deposit. A `MineDeposit` instead buckets
 * `Resource.remaining` against its `initial`/`levels` capacity via {@link depositVisualLevel}.
 */
function readResourceLadder(
  components: Readonly<Record<string, unknown>>,
): { level: number; levels: number } | undefined {
  const crop = components.Crop as { stage?: unknown; stages?: unknown } | undefined;
  if (crop !== undefined && typeof crop.stage === 'number' && typeof crop.stages === 'number') {
    return { level: clamp(crop.stage, 1, crop.stages), levels: crop.stages };
  }
  const deposit = components.MineDeposit as { initial?: unknown; levels?: unknown } | undefined;
  const res = components.Resource as { remaining?: unknown } | undefined;
  if (deposit === undefined || typeof deposit.initial !== 'number' || typeof deposit.levels !== 'number') {
    return undefined;
  }
  if (res === undefined || typeof res.remaining !== 'number') return undefined;
  return {
    level: depositVisualLevel(res.remaining, deposit.initial, deposit.levels),
    levels: deposit.levels,
  };
}

/**
 * A mined resource node's / crop's visual fill level ({@link import('../draw-item.js').DrawItem.level}), or
 * `undefined` for a plain node — the `level` field of the node's {@link readResourceLadder}. The binding
 * then draws its full-state frame when absent.
 */
function readResourceLevel(components: Readonly<Record<string, unknown>>): number | undefined {
  return readResourceLadder(components)?.level;
}

/**
 * How many levels a mined node's / a crop's visual ladder has — the sim's `MineDeposit.levels` (or
 * `Crop.stages`), the denominator {@link readResourceLevel}'s value is out of. Carried onto the draw item
 * ({@link import('../draw-item.js').DrawItem.levels}) so the resolver can rescale the sim's ladder onto the
 * bound record's own authored state count (stone rocks carry 4 states, ore mines 5 — the sim buckets both
 * into one catalog count). `undefined` exactly when {@link readResourceLevel} is (a plain full node).
 */
export function readResourceLevelCount(components: Readonly<Record<string, unknown>>): number | undefined {
  return readResourceLadder(components)?.levels;
}

/**
 * A stump's `Stump.goodType` — the resource it is the remains of (a chopped tree → wood), the per-good
 * join key ({@link import('../draw-item.js').DrawItem.goodType}) a {@link import('../../sprites/index.js').ResourceTypeBinding}
 * draws its debris frame by. `undefined` for a missing/malformed component (the binding falls back to
 * its default).
 */
function readStumpGood(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Stump', 'goodType');
}

/**
 * A berry bush's ripe/bare draw level ({@link import('../draw-item.js').DrawItem.level}): 2 when the bush
 * holds fruit (`BerryBush.ripe`), 1 when bare (foraged, regrowing). A per-bush
 * {@link import('../../sprites/index.js').ResourceTypeBinding.byGfxIndex} two-frame list (bare, ripe) indexes
 * by it. `undefined` for a malformed component (the binding then draws its default frame).
 */
export function readBerryBushLevel(components: Readonly<Record<string, unknown>>): number | undefined {
  const b = components.BerryBush as { ripe?: unknown } | undefined;
  if (b === undefined || typeof b.ripe !== 'boolean') return undefined;
  return b.ripe ? 2 : 1;
}

/**
 * A berry bush's render-variant `gfxIndex` ({@link import('../draw-item.js').DrawItem.gfxIndex}) — the
 * decoded map's fruited-bush `[GfxLandscape]` record index the bush was spawned from (`BerryBush.gfxIndex`),
 * so a per-variant binding draws the exact bush species. `undefined` for a scene/synthetic bush with no
 * variant tag (the binding then draws its default bush).
 */
export function readBerryBushGfxIndex(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'BerryBush', 'gfxIndex');
}

/** The static per-kind draw fields a building / resource / stump carries — the subset shared by
 *  {@link import('../draw-item.js').DrawItem} and {@link import('../../fog/index.js').FogGhost}. */
export interface StaticDrawFields {
  typeId?: number;
  builtPct?: number;
  upgradePct?: number;
  goodType?: number;
  level?: number;
  gfxIndex?: number;
}

/**
 * Assign the static per-kind draw fields read off a building / resource / stump entity onto `target`, in
 * place (no intermediate object, so the per-frame scene build allocates nothing) and omitting absent facts.
 * The single place the "which components a static reads for its draw" decision lives, so the live scene
 * build and the fog-ghost capture can't drift on it. Excludes two fields each caller owns: a building's
 * `working` (live-only — a ghost never animates) and a resource's `levels` denominator (the live build adds
 * it alongside `level`; ghosts do not carry it today).
 */
export function assignStaticFields(
  target: StaticDrawFields,
  kind: 'building' | 'resource' | 'stump',
  components: Readonly<Record<string, unknown>>,
): void {
  switch (kind) {
    case 'building': {
      const typeId = readBuildingType(components);
      if (typeId !== undefined) target.typeId = typeId;
      const builtPct = readBuiltPct(components);
      if (builtPct !== undefined) target.builtPct = builtPct;
      const upgradePct = readUpgradePct(components);
      if (upgradePct !== undefined) target.upgradePct = upgradePct;
      return;
    }
    case 'resource': {
      const goodType = readResourceGood(components);
      if (goodType !== undefined) target.goodType = goodType;
      const level = readResourceLevel(components);
      if (level !== undefined) target.level = level;
      const gfxIndex = readResourceGfxIndex(components);
      if (gfxIndex !== undefined) target.gfxIndex = gfxIndex;
      return;
    }
    case 'stump': {
      const goodType = readStumpGood(components);
      if (goodType !== undefined) target.goodType = goodType;
      return;
    }
    default: {
      // Exhaustiveness guard: a new static kind fails to assign to `never` here instead of silently
      // taking the stump path.
      const _exhaustive: never = kind;
      void _exhaustive;
    }
  }
}
