import { UNLOADED_GOOD_TYPE, type VehicleGraphics } from '@open-northland/data';
import {
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

/** The vehicle job's standing wait (`[gfxanimatomic]` action 2). */
const WAIT_ACTION = 2;
/** The ships' second hull (action 4), drawn as the wait with cargo aboard. */
const LOADED_WAIT_ACTION = 4;

/** The catapult's shot, staged as this `[GfxLandscape]` record beside the vehicle: weapon 21 authors
 *  `createsmoke 1`, and this is the one looping smoke record the content ships (the in-house cauldron's).
 *  Approximation: which smoke record the original's `createsmoke` names is not read. */
export const VEHICLE_ATTACK_SMOKE_FX = 'fx smoke';
/** Where the shot's smoke sits, in screen px from the catapult's feet anchor (+y down). Approximation:
 *  the bowl of the `cr_veh_body_00` catapult frames, read off the sprite. */
const ATTACK_SMOKE_DX = 0;
const ATTACK_SMOKE_DY = -36;

/** The served atlas stem of a row's body under its palette (`cr_veh_body_00.goods01`). */
export function vehicleAtlasStem(row: Pick<VehicleGraphics, 'body' | 'bodyPalette'>): string {
  return `${row.body.slice(row.body.lastIndexOf('/') + 1).replace(/\.bmd$/i, '')}.${row.bodyPalette}`;
}

/**
 * The atlases a binding over `rows` draws from: every body under its own palette, with each body's
 * shadow twin. A row's `playerPalettes` family is not baked per player (the pipeline decodes
 * `human_ship01` alone), so every owner sails that one hull.
 */
export function vehicleAtlasStems(rows: readonly VehicleGraphics[]): {
  stems: Set<string>;
  shadowByStem: Map<string, string>;
} {
  const stems = new Set<string>();
  const shadowByStem = new Map<string, string>();
  for (const row of rows) {
    const stem = vehicleAtlasStem(row);
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
): VehicleLook | undefined {
  const layer = vehicleAtlasStem(row);
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
  const loadedIdle = clipOf(LOADED_WAIT_ACTION);
  return {
    layer,
    idle,
    ...(loadedIdle !== undefined ? { loadedIdle } : {}),
    ...(moving !== undefined ? { moving } : {}),
    ...(Object.keys(movingByGood).length > 0 ? { movingByGood } : {}),
    ...(loadedMoving !== undefined ? { loadedMoving } : {}),
    ...(attack !== undefined ? { attack } : {}),
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
  attackFxLoaded: boolean,
): VehicleBinding | undefined {
  const byTribe: Record<number, Record<number, VehicleLook>> = {};
  let any = false;
  for (const row of rows) {
    const look = vehicleLook(row, loaded, frames);
    if (look === undefined) continue;
    const looks = byTribe[row.tribe] ?? {};
    looks[row.vehicleType] = look;
    byTribe[row.tribe] = looks;
    any = true;
  }
  if (!any) return undefined;
  const tribes: Record<number, VehicleTribeLooks> = byTribe;
  return {
    byTribe: tribes,
    fallbackTribe,
    ...(attackFxLoaded
      ? { attackFx: { name: VEHICLE_ATTACK_SMOKE_FX, dx: ATTACK_SMOKE_DX, dy: ATTACK_SMOKE_DY } }
      : {}),
  };
}
