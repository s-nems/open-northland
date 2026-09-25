import { UNLOADED_GOOD_TYPE, type VehicleGraphics } from '@open-northland/data';
import {
  type ClothIndexRanges,
  type FrameListAnim,
  VEHICLE_ATTACK_TICKS,
  type VehicleBinding,
  type VehicleLook,
  type VehicleTribeLooks,
} from '@open-northland/render';
import { ATTACK_ATOMIC } from '../../catalog/atomics.js';
import { servedShadowStem } from '../ir/joins.js';
import type { ContentIr } from '../ir/rows.js';
import { frameListsByFacing } from '../settler-gfx/index.js';

// The pure vehicle-look join: the IR's `vehicleGraphics` rows (one per tribe and type, clips already
// resolved to bob ids of the row's body) become the renderer's per-tribe `VehicleLook`s over the atlases
// that loaded. Byte loading lives in `./load.ts`.

/** The vehicle job's standing wait (`[gfxanimatomic]` action 2): a ship with its sails set. */
const WAIT_ACTION = 2;
/** The ships' second hull (action 4): sails furled, crates on deck (observation of the `ls_vehicles`
 *  frames, docs/formats/VEHICLES.md "Graphics"), drawn while the ship lies moored. */
const MOORED_WAIT_ACTION = 4;
/** The pipeline's suffix for an indexed body atlas (`stages/vehicle-colors.ts`). */
const INDEXED_SUFFIX = 'indexed';
/**
 * The palette indices the `ls_vehicles` hulls paint their sails with: the cream ramp, then the 32-entry
 * band the `human_shipNN` palettes differ in. Observation of the decoded frames, where no other part of
 * a hull draws from either range.
 */
const SAIL_CREAM_RAMP = [104, 111] as const;
const SHIP_OWNER_BAND = [128, 159] as const;
/**
 * The grey-cream ramp the viking big ship's `ve_test_ship` paints its sail with (observation of the
 * decoded frames). The deck awning shares it and ripples along; no owner band is painted, so the sail
 * shows no owner colour.
 */
const BIG_SHIP_SAIL_RAMP = [192, 207] as const;
/** The sail ranges by served indexed atlas stem, both ranges of a single-ramp sail being the ramp. */
export const SHIP_SAIL_INDEX_RANGES: Readonly<Record<string, ClothIndexRanges>> = {
  [`ls_vehicles.${INDEXED_SUFFIX}`]: [...SAIL_CREAM_RAMP, ...SHIP_OWNER_BAND],
  [`ve_test_ship.${INDEXED_SUFFIX}`]: [...BIG_SHIP_SAIL_RAMP, ...BIG_SHIP_SAIL_RAMP],
};

/** Whether `row` draws per owner: its body palette starts the family whose LUT loaded. */
function drawsPerOwner(row: VehicleGraphics, ownerFamily: string | undefined): boolean {
  return ownerFamily !== undefined && row.playerPalettes !== undefined && row.bodyPalette === ownerFamily;
}

/**
 * The served atlas stem of a row's body: baked under its palette (`cr_veh_body_00.goods01`), or the
 * indexed body (`ls_vehicles.indexed`) when the row draws per owner through `ownerFamily`'s LUT.
 */
export function vehicleAtlasStem(row: VehicleGraphics, ownerFamily?: string): string {
  const body = row.body.slice(row.body.lastIndexOf('/') + 1).replace(/\.bmd$/i, '');
  return `${body}.${drawsPerOwner(row, ownerFamily) ? INDEXED_SUFFIX : row.bodyPalette}`;
}

/** The first palette family the rows name (the ships' `human_ship01`): the one family a sheet's single
 *  vehicle LUT serves. A second family would draw its baked first member. */
export function vehicleOwnerFamily(rows: readonly VehicleGraphics[]): string | undefined {
  return rows.find((row) => row.playerPalettes !== undefined)?.bodyPalette;
}

/** The atlases a binding over `rows` draws from: every body under {@link vehicleAtlasStem}, with each
 *  body's shadow twin. */
export function vehicleAtlasStems(
  rows: readonly VehicleGraphics[],
  ownerFamily?: string,
): {
  stems: Set<string>;
  shadowByStem: Map<string, string>;
} {
  const stems = new Set<string>();
  const shadowByStem = new Map<string, string>();
  for (const row of rows) {
    const stem = vehicleAtlasStem(row, ownerFamily);
    stems.add(stem);
    const shadow = servedShadowStem(row.shadowBody);
    if (shadow !== undefined && !shadowByStem.has(stem)) shadowByStem.set(stem, shadow);
  }
  return { stems, shadowByStem };
}

/** The frame ids a loaded family atlas can draw (a 0x0 frame is not one), by served stem. */
export type DrawableFrames = ReadonlyMap<string, ReadonlySet<number>>;

/**
 * A clip as a looping per-facing frame list in the atlas's own id space, or `undefined` when the atlas
 * lacks any frame it names: the row indexes a larger layout than the baked body (the viking big ship's
 * loaded hull addresses `ls_vehicles` bobs its 32-frame `ve_test_ship` never had), and drawing it would
 * put up the placeholder. Dropping it lets the state fall back down the look's chain.
 */
function clipAnim(
  dirFrames: readonly (readonly number[])[],
  drawable: ReadonlySet<number>,
  ticksPerFrame?: number,
): FrameListAnim | undefined {
  if (dirFrames.every((list) => list.length === 0)) return undefined;
  for (const list of dirFrames) for (const bob of list) if (!drawable.has(bob)) return undefined;
  return {
    start: 0,
    frameLists: frameListsByFacing(dirFrames),
    loop: true,
    ...(ticksPerFrame !== undefined ? { ticksPerFrame } : {}),
  };
}

/**
 * One row's look over its loaded atlas, or `undefined` without a wait to stand on (a row with neither a
 * wait nor a drive, the shipped ox-less cart of two tribes, binds nothing and its tribe falls back). A
 * drive with no wait stands on its first frame.
 */
export function vehicleLook(
  row: VehicleGraphics,
  loaded: ReadonlySet<string>,
  frames: DrawableFrames,
  ownerFamily?: string,
): VehicleLook | undefined {
  const layer = vehicleAtlasStem(row, ownerFamily);
  const drawable = frames.get(layer);
  if (!loaded.has(layer) || drawable === undefined) return undefined;
  const clipOf = (action: number): FrameListAnim | undefined => {
    const clip = row.clips.find((c) => c.action === action);
    return clip === undefined ? undefined : clipAnim(clip.dirFrames, drawable);
  };
  const attackClip = row.clips.find((c) => c.action === ATTACK_ATOMIC);
  const attackFrames = attackClip?.dirFrames.reduce((max, list) => Math.max(max, list.length), 0) ?? 0;
  const attack =
    attackClip === undefined || attackFrames === 0
      ? undefined
      : clipAnim(attackClip.dirFrames, drawable, VEHICLE_ATTACK_TICKS / attackFrames);
  let moving: FrameListAnim | undefined;
  let loadedMoving: FrameListAnim | undefined;
  const movingByGood: Record<number, FrameListAnim> = {};
  for (const gait of row.gaits) {
    const anim = clipAnim(gait.dirFrames, drawable);
    if (anim === undefined) continue;
    if (gait.goodType === UNLOADED_GOOD_TYPE) moving ??= anim;
    else {
      movingByGood[gait.goodType] = anim;
      loadedMoving ??= anim;
    }
  }
  const wait = clipOf(WAIT_ACTION);
  const idle = wait ?? (moving === undefined ? undefined : holdFirstFrame(moving));
  if (idle === undefined) return undefined;
  const mooredIdle = clipOf(MOORED_WAIT_ACTION);
  return {
    layer,
    idle,
    ...(mooredIdle !== undefined ? { mooredIdle } : {}),
    ...(moving !== undefined ? { moving } : {}),
    ...(Object.keys(movingByGood).length > 0 ? { movingByGood } : {}),
    ...(loadedMoving !== undefined ? { loadedMoving } : {}),
    ...(attack !== undefined ? { attack } : {}),
    ...(drawsPerOwner(row, ownerFamily) ? { indexed: true } : {}),
  };
}

/** The drive's first frame per facing, as a standing pose. */
function holdFirstFrame(anim: FrameListAnim): FrameListAnim {
  return { start: anim.start, frameLists: anim.frameLists.map((list) => list.slice(0, 1)), loop: true };
}

/** The `vehicleGraphics` rows of the served IR; empty without one. */
export function vehicleGraphicsRows(ir: ContentIr | null): readonly VehicleGraphics[] {
  return ir?.vehicleGraphics ?? [];
}

/**
 * The binding over every row whose atlas loaded. `fallbackTribe` is the world's base tribe: a tribe the
 * data binds no vehicles for (Egypt in the shipped content) draws its looks, and so does a tribe whose
 * own row for a type binds nothing. `undefined` when no row binds, so a vehicle draws the placeholder.
 */
export function buildVehicleBinding(
  rows: readonly VehicleGraphics[],
  loaded: ReadonlySet<string>,
  frames: DrawableFrames,
  fallbackTribe: number,
  options: {
    /** The types that ride the swell at sea; absent draws every vehicle rigid. */
    readonly ships?: ReadonlySet<number>;
    /** The palette family whose LUT loaded; its rows bind the indexed body. */
    readonly ownerFamily?: string;
  } = {},
): VehicleBinding | undefined {
  const byTribe: Record<number, Record<number, VehicleLook>> = {};
  let any = false;
  for (const row of rows) {
    const look = vehicleLook(row, loaded, frames, options.ownerFamily);
    if (look === undefined) continue;
    const looks = byTribe[row.tribe] ?? {};
    looks[row.vehicleType] = options.ships?.has(row.vehicleType) === true ? { ...look, afloat: true } : look;
    byTribe[row.tribe] = looks;
    any = true;
  }
  if (!any) return undefined;
  const tribes: Record<number, VehicleTribeLooks> = byTribe;
  return { byTribe: tribes, fallbackTribe };
}
