import { clamp } from '../../math.js';
import { ONE } from '../../projection/index.js';
import { readNumField } from '../../snapshot/index.js';
import type { StaticDrawFields } from '../draw-item.js';

function readBuildingType(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Building', 'buildingType');
}

function readBuildingTribe(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Building', 'tribe');
}

/**
 * An under-construction building's progress as a whole percent (0..99), or `undefined` when it is
 * finished, unreadable, or upgrading - an upgrade reads {@link readUpgradePct} instead, so the old-tier
 * body keeps drawing under the upgrade overlay rather than the from-scratch stages.
 */
export function readBuiltPct(components: Readonly<Record<string, unknown>>): number | undefined {
  if ('Upgrading' in components) return undefined;
  return risingPct(components);
}

/**
 * An upgrading building's progress as a whole percent (0..99), or `undefined` when it is not
 * mid-upgrade. Mutually exclusive with {@link readBuiltPct} by construction.
 */
export function readUpgradePct(components: Readonly<Record<string, unknown>>): number | undefined {
  if (!('Upgrading' in components)) return undefined;
  return risingPct(components);
}

/** The shared read behind the two above: `Building.built`, a fixed-point fraction of ONE, floored to a
 *  0..99 percent so a nearly-done site never reads as finished. `undefined` once `built >= ONE`. */
function risingPct(components: Readonly<Record<string, unknown>>): number | undefined {
  const b = components.Building as { built?: unknown } | undefined;
  if (b === undefined || typeof b.built !== 'number' || !Number.isFinite(b.built) || b.built >= ONE) {
    return undefined;
  }
  return clamp(Math.floor((b.built * 100) / ONE), 0, 99);
}

/**
 * A finished building's remaining Health fraction (0..1), or `undefined` when it is undamaged, carries
 * no readable Health, or is still building/upgrading - its pool ramps with the build, so a site would
 * otherwise read damaged for its whole construction.
 */
export function readHpFraction(components: Readonly<Record<string, unknown>>): number | undefined {
  if (risingPct(components) !== undefined) return undefined;
  const h = components.Health as { hitpoints?: unknown; max?: unknown } | undefined;
  if (h === undefined || typeof h.hitpoints !== 'number' || typeof h.max !== 'number' || h.max <= 0) {
    return undefined;
  }
  if (!Number.isFinite(h.hitpoints) || h.hitpoints >= h.max) return undefined;
  return clamp(h.hitpoints / h.max, 0, 1);
}

/**
 * Whether a building is mid production cycle. The `Production` component exists exactly while a cycle
 * runs, so its presence is the whole signal - its `elapsed`/`duration` counters stay sim-internal.
 */
export function readProducing(components: Readonly<Record<string, unknown>>): boolean {
  return 'Production' in components;
}

function readResourceGood(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Resource', 'goodType');
}

/**
 * A resource node's render-variant tag: `Resource.gfxIndex`, the exact `[GfxLandscape]` record a decoded
 * map spawned it from ("pine 02", not the good's representative "yew 01"). An opaque app-numbered index
 * the sim never interprets; `undefined` for an admin- or scene-spawned node.
 */
function readResourceGfxIndex(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Resource', 'gfxIndex');
}

/**
 * The visual fill level of a mined deposit: an integer in `[1, levels]`, `levels` when full and `0` for
 * an exhausted or mis-stamped deposit. Rounding up keeps a barely-drained deposit on its full frame and
 * shows the dregs only on the last unit. Level `k` draws mine gfx state `k`, authored fullest at the top.
 */
export function depositVisualLevel(remaining: number, initial: number, levels: number): number {
  if (remaining <= 0 || initial <= 0 || levels <= 0) return 0;
  return clamp(Math.ceil((remaining * levels) / initial), 1, levels);
}

/**
 * A mined node's or crop's visual ladder - the current `level` and the `levels` denominator it is out
 * of, returned together so the two can never drift - or `undefined` for a plain node. A sown `Crop`
 * uses its growth stage as the level directly: stage `k` draws gfx state `k` (the wheat record's 5
 * states are authored smallest-at-1 to ripe-at-5, exactly the stage numbering).
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

/** A stump's `Stump.goodType` - the resource it is the remains of (a chopped tree → wood). */
function readStumpGood(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Stump', 'goodType');
}

/** `BerryBush.stage` as the 1-based index into a bush binding's three-frame list (bare, flowering, ripe). */
const BERRY_STAGE_LEVEL: Readonly<Record<string, number>> = { bare: 1, flowering: 2, ripe: 3 };

/** A berry bush's growth draw level from `BerryBush.stage`, or `undefined` for an unknown or malformed
 *  stage, which draws the binding's default frame rather than a bogus level. */
export function readBerryBushLevel(components: Readonly<Record<string, unknown>>): number | undefined {
  const b = components.BerryBush as { stage?: unknown } | undefined;
  if (b === undefined || typeof b.stage !== 'string') return undefined;
  return BERRY_STAGE_LEVEL[b.stage] ?? undefined;
}

/** A berry bush's render variant: the fruited-bush `[GfxLandscape]` record it was spawned from
 *  (`BerryBush.gfxIndex`), or `undefined` for a scene- or synthetic bush with no variant tag. */
export function readBerryBushGfxIndex(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'BerryBush', 'gfxIndex');
}

/** A closed or opened chest's render variant, or `undefined` for a scene chest with no variant tag. */
export function readChestGfxIndex(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Chest', 'gfxIndex') ?? readNumField(components, 'OpenedChest', 'gfxIndex');
}

const STATIC_DRAW_KEYS = ['typeId', 'builtPct', 'goodType', 'level', 'levels', 'gfxIndex', 'tribe'] as const;
// A key missing from STATIC_DRAW_KEYS makes _UncopiedKey non-never and fails to compile here, so a new
// StaticDrawFields entry cannot be silently dropped by the hand copy below.
type _UncopiedKey = Exclude<keyof StaticDrawFields, (typeof STATIC_DRAW_KEYS)[number]>;
const _allKeysListed: [_UncopiedKey] extends [never] ? true : _UncopiedKey = true;
void _allKeysListed;

/** Copy the present {@link StaticDrawFields} of `source` onto `target` in place, leaving absent fields
 *  absent (exactOptionalPropertyTypes) so a fog ghost re-emits exactly what it captured. */
export function copyStaticFields(target: StaticDrawFields, source: StaticDrawFields): void {
  for (const key of STATIC_DRAW_KEYS) {
    const value = source[key];
    if (value !== undefined) target[key] = value;
  }
}

/**
 * Assign the {@link StaticDrawFields} a building / resource / stump draws by onto `target` in place - no
 * intermediate object, so the per-frame scene build allocates nothing - omitting absent facts. The one
 * place that choice lives, so the live scene build and the fog-ghost capture cannot drift apart.
 */
export function assignStaticFields(
  target: StaticDrawFields,
  kind: 'building' | 'resource' | 'stump' | 'chest',
  components: Readonly<Record<string, unknown>>,
): void {
  switch (kind) {
    case 'building': {
      const typeId = readBuildingType(components);
      if (typeId !== undefined) target.typeId = typeId;
      const tribe = readBuildingTribe(components);
      if (tribe !== undefined) target.tribe = tribe;
      const builtPct = readBuiltPct(components);
      if (builtPct !== undefined) target.builtPct = builtPct;
      return;
    }
    case 'resource': {
      const goodType = readResourceGood(components);
      if (goodType !== undefined) target.goodType = goodType;
      const ladder = readResourceLadder(components);
      if (ladder !== undefined) {
        target.level = ladder.level;
        target.levels = ladder.levels;
      }
      const gfxIndex = readResourceGfxIndex(components);
      if (gfxIndex !== undefined) target.gfxIndex = gfxIndex;
      return;
    }
    case 'stump': {
      const goodType = readStumpGood(components);
      if (goodType !== undefined) target.goodType = goodType;
      return;
    }
    case 'chest': {
      const gfxIndex = readChestGfxIndex(components);
      if (gfxIndex !== undefined) target.gfxIndex = gfxIndex;
      return;
    }
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
    }
  }
}
