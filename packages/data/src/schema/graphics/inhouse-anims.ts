import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';

/** The `<from> <to>` window every in-house line ends with: percent of the atomic's length, `from`
 *  inclusive and `to` exclusive. A zero-length window seeds a position without ever playing. */
const WindowPercent = z.number().int().min(0).max(100);

/** A pixel offset from the house's anchor, its map node projected to screen, screen-down positive.
 *  Source basis: observation - read this way the authored offsets put each worker at its own oven,
 *  forge, wheel and bench. */
const HousePx = z.number().int();

/** The `logicgoodtype` of a walk carrying nothing, in `[gfxwalkatomic]` and in an in-house walk alike. */
export const UNLOADED_GOOD_TYPE = 0;

/** `gfxinhousewalk <dir> <goodtype> <x> <y> <from> <to>`: walk to `(x, y)` from the previous walk
 *  line's point, facing `dir`, in the `[gfxwalkatomic]` gait for `goodType`. */
export const GfxInHouseWalk = z.strictObject({
  kind: z.literal('walk'),
  /** The engine's movement-direction ring (`0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE, 6 N, 7 S`). */
  dir: z.number().int().min(0).max(7),
  goodType: TypeId,
  x: HousePx,
  y: HousePx,
  from: WindowPercent,
  to: WindowPercent,
});
export type GfxInHouseWalk = z.infer<typeof GfxInHouseWalk>;

/** `gfxinhouseanim <action> <subid> <dir> <from> <to>`: play the `[gfxanimatomic]` record
 *  `(tribe, job, action, subId)` stretched over the window, standing where the last walk ended. */
export const GfxInHouseClip = z.strictObject({
  kind: z.literal('clip'),
  action: AtomicId,
  /** `0` names the job's plain record for `action`; `1..n` its `logicinhouseatomicsubid` records. */
  subId: z.number().int().nonnegative(),
  dir: z.number().int().min(0).max(7),
  from: WindowPercent,
  to: WindowPercent,
});
export type GfxInHouseClip = z.infer<typeof GfxInHouseClip>;

/** `gfxinhouseoverlaylandscape "<name>" <x> <y> <from> <to>`: a `[GfxLandscape]` record (a fire, a
 *  smoke plume) drawn at the offset while the window is open. */
export const GfxInHouseLandscapeOverlay = z.strictObject({
  kind: z.literal('landscape'),
  name: z.string(),
  x: HousePx,
  y: HousePx,
  from: WindowPercent,
  to: WindowPercent,
});

/** `gfxinhouseoverlaybob <layer> <x> <y> <from> <to>`: one of the house's own `[GfxHouse]` bob layers
 *  redrawn at the offset while the window is open. */
export const GfxInHouseHouseBobOverlay = z.strictObject({
  kind: z.literal('houseBob'),
  layer: z.number().int().nonnegative(),
  x: HousePx,
  y: HousePx,
  from: WindowPercent,
  to: WindowPercent,
});

export const GfxInHouseEntry = z.discriminatedUnion('kind', [
  GfxInHouseWalk,
  GfxInHouseClip,
  GfxInHouseLandscapeOverlay,
  GfxInHouseHouseBobOverlay,
]);
export type GfxInHouseEntry = z.infer<typeof GfxInHouseEntry>;

/**
 * One `gfxanimmode 2` `[gfxanimatomic]` record from `mapmoveableanimations/animations.ini`: the
 * choreography a worker plays inside its workplace for `(logictribe, logicjob, logicatomicaction)`.
 * Entries keep file order, which carries an overlay's depth against the worker.
 */
export const GfxInHouseProgram = z.strictObject({
  tribe: TypeId,
  job: TypeId,
  action: AtomicId,
  entries: z.array(GfxInHouseEntry),
  source: Provenance.optional(),
});
export type GfxInHouseProgram = z.infer<typeof GfxInHouseProgram>;
