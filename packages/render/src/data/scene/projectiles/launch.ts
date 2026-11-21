import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { facingHeading, WATER_PLANE_SQUASH } from '../../effects/wake.js';
import { tileToScreen } from '../../projection/index.js';
import { readNumField } from '../../snapshot/index.js';
import { gfxDirToFacing } from '../../sprites/settler.js';
import { readProjectileCover, readProjectileSiege } from '../snapshot-readers/index.js';
import { BOW_LAUNCH, BOW_LAUNCH_HEIGHT_PX, COVER_LAUNCH_HEIGHT_PX, type ShotLaunch } from './arc.js';

// A shot loosed from a building or a deck leaves from a spot of its own on the firing level or along the
// hull instead of its shooter's one anchor. Render-only: the sim's release point, flight time and landing
// do not move. The spots are measured on the drawn sprites, a drawn-look approximation.

/** The level a defence building's garrison shoots from, in bob px from its draw anchor (+y down): the
 *  middle of the firing level and the radius of the ring its archers stand on. */
export interface FiringPost {
  readonly x: number;
  readonly y: number;
  readonly halfWidth: number;
}

/** The firing post of a building type as one tribe draws it; undefined keeps {@link DEFAULT_FIRING_POST}. */
export type FiringPostLookup = (tribe: number, buildingType: number) => FiringPost | undefined;

/** The post of a building no record measures, the headquarters and barracks: a ring at the garrison height
 *  that every drawn body fills. */
export const DEFAULT_FIRING_POST: FiringPost = { x: 0, y: -COVER_LAUNCH_HEIGHT_PX, halfWidth: 40 };

/** Screen y per ground y on a drawn firing level, flatter than the map's ground plane: the byzantine
 *  tower's merlon ring is 103 px across and 30 px deep. */
const POST_RING_SQUASH = 0.3;

/** How far round its firing level from the side facing the mark a garrison archer stands, either way: the
 *  whole half of the ring that faces it. */
const POST_ARC_RAD = Math.PI / 2;

/** Half the deck a ship's bowmen stand along, in px of its east-facing body: the inner deck runs from
 *  120 px behind the anchor to 105 px ahead of it. */
const DECK_HALF_LENGTH_PX = 100;
/** How far off the keel line a bowman stands toward his mark, on the ground plane: just inside the rail,
 *  which the east-facing body draws 15 px off the keel. */
const DECK_HALF_BEAM_PX = 20;
/** The deck floor's height over the hull's anchor at the waterline. */
const DECK_FLOOR_PX = 20;

/** The golden ratio's fraction: stepping by it spreads consecutive ids evenly, so a volley's arrows leave
 *  from spots far apart. */
const GOLDEN_FRACTION = (Math.sqrt(5) - 1) / 2;

/** A stable fraction in [-1, 1) per shot: the spot it leaves from in every frame of its flight. */
function launchSpread(ref: number): number {
  return 2 * ((ref * GOLDEN_FRACTION) % 1) - 1;
}

/** The heading on the map's ground plane from a shot's release point toward `toAim`, a screen vector. */
function groundHeading(toAim: { x: number; y: number }): number {
  return Math.atan2(toAim.y / WATER_PLANE_SQUASH, toAim.x);
}

/**
 * A garrison shot from `post`: off the ring of its firing level, on the side facing the mark, `spread` of
 * {@link POST_ARC_RAD} round from it.
 */
export function postLaunch(post: FiringPost, toAim: { x: number; y: number }, spread: number): ShotLaunch {
  const angle = groundHeading(toAim) + spread * POST_ARC_RAD;
  return {
    dx: post.x + post.halfWidth * Math.cos(angle),
    dy: post.halfWidth * POST_RING_SQUASH * Math.sin(angle),
    height: -post.y,
    falls: true,
  };
}

/**
 * A deck shot from a ship drawn at render `facing`: `spread` of the way along the deck from its middle,
 * at the rail on the mark's side, from a bowman's hand over the deck floor. The hull lies as its wake
 * draws it.
 */
export function deckLaunch(facing: number, toAim: { x: number; y: number }, spread: number): ShotLaunch {
  const heading = facingHeading(facing);
  const alongX = Math.cos(heading);
  const alongY = Math.sin(heading);
  // The keel's normal, turned to the side the mark lies on.
  const mark = groundHeading(toAim);
  const side = Math.sign(-alongY * Math.cos(mark) + alongX * Math.sin(mark)) || 1;
  const groundX = alongX * spread * DECK_HALF_LENGTH_PX - side * alongY * DECK_HALF_BEAM_PX;
  const groundY = alongY * spread * DECK_HALF_LENGTH_PX + side * alongX * DECK_HALF_BEAM_PX;
  return {
    dx: groundX,
    dy: groundY * WATER_PLANE_SQUASH,
    height: DECK_FLOOR_PX + BOW_LAUNCH_HEIGHT_PX,
    falls: false,
  };
}

/** The render facing of the ship a deck bowman `source` rides, or null for a shooter on the ground. A
 *  rider aboard stands nowhere on the map. */
function deckFacingOf(snapshot: WorldSnapshot, source: number): number | null {
  const shooter = entityById(snapshot, source)?.components;
  if (shooter === undefined || 'Position' in shooter) return null;
  const vehicle = readNumField(shooter, 'Rider', 'vehicle');
  const ship = vehicle === undefined ? undefined : entityById(snapshot, vehicle)?.components;
  const facing = ship === undefined ? undefined : readNumField(ship, 'Vehicle', 'facing');
  return facing === undefined ? null : gfxDirToFacing(facing);
}

/**
 * How long the arrow a shooter's trade looses draws, as a multiple of its authored frame. Both ids are
 * undefined for a shooter that is no settler, a building firing from its walls or one that died since.
 */
export type ShotLengthLookup = (tribe: number | undefined, job: number | undefined) => number;

/** How a shot in flight draws: where it leaves from and how long its sprite is. */
export interface ShotLook {
  readonly launch: ShotLaunch;
  readonly length: number;
}

/** The authored frame, unstretched. */
const AUTHORED_LENGTH = 1;

const SIEGE_LOOK: ShotLook = { launch: BOW_LAUNCH, length: AUTHORED_LENGTH };

/** What a shot's look reads besides its own components. */
export interface LaunchContext {
  readonly snapshot: WorldSnapshot;
  readonly posts: FiringPostLookup | undefined;
  readonly lengths: ShotLengthLookup | undefined;
  /** The looks kept across builds; absent, each build reads the shooter as it stands now. */
  readonly held: ShotLaunches | undefined;
}

/** How projectile `ref`, loosed from `origin` at `aim` (tile units), draws. A siege shot is drawn by its
 *  own layer and keeps the bow's launch. */
export function shotLookOf(
  ctx: LaunchContext,
  ref: number,
  components: Readonly<Record<string, unknown>>,
  origin: { x: number; y: number },
  aim: { x: number; y: number },
): ShotLook {
  if (readProjectileSiege(components)) return SIEGE_LOOK;
  const launchTick = readNumField(components, 'Projectile', 'launchTick') ?? 0;
  const held = ctx.held?.of(ref, launchTick);
  if (held !== undefined) return held;
  const from = tileToScreen(origin.x, origin.y);
  const to = tileToScreen(aim.x, aim.y);
  const look: ShotLook = {
    launch: resolveLaunch(ctx, components, { x: to.x - from.x, y: to.y - from.y }, launchSpread(ref)),
    length: resolveLength(ctx, components),
  };
  ctx.held?.hold(ref, launchTick, look);
  return look;
}

function resolveLength(ctx: LaunchContext, components: Readonly<Record<string, unknown>>): number {
  if (ctx.lengths === undefined) return AUTHORED_LENGTH;
  const source = readNumField(components, 'Projectile', 'source');
  const shooter = source === undefined ? undefined : entityById(ctx.snapshot, source)?.components;
  if (shooter === undefined) return ctx.lengths(undefined, undefined);
  return ctx.lengths(readNumField(shooter, 'Settler', 'tribe'), readNumField(shooter, 'Settler', 'jobType'));
}

function resolveLaunch(
  ctx: LaunchContext,
  components: Readonly<Record<string, unknown>>,
  toAim: { x: number; y: number },
  spread: number,
): ShotLaunch {
  const cover = readProjectileCover(components);
  if (cover !== null) {
    const building = entityById(ctx.snapshot, cover)?.components;
    const tribe = building === undefined ? undefined : readNumField(building, 'Building', 'tribe');
    const type = building === undefined ? undefined : readNumField(building, 'Building', 'buildingType');
    const post = tribe === undefined || type === undefined ? undefined : ctx.posts?.(tribe, type);
    return postLaunch(post ?? DEFAULT_FIRING_POST, toAim, spread);
  }
  const source = readNumField(components, 'Projectile', 'source');
  const facing = source === undefined ? null : deckFacingOf(ctx.snapshot, source);
  return facing === null ? BOW_LAUNCH : deckLaunch(facing, toAim, spread);
}

/**
 * The look each shot in flight was first drawn with, kept until it lands: a ship that turns, a shooter
 * who dies or a tower that falls mid-flight changes neither where its arrows left from nor their length.
 * Held by one build loop; a pass over the held shots forgets the landed ones, so it costs the arrows in
 * flight.
 */
export class ShotLaunches {
  private readonly held = new Map<number, { readonly launchTick: number; readonly look: ShotLook }>();

  /** The look shot `ref` loosed on `launchTick` was first drawn with, if it was. */
  of(ref: number, launchTick: number): ShotLook | undefined {
    const known = this.held.get(ref);
    return known !== undefined && known.launchTick === launchTick ? known.look : undefined;
  }

  hold(ref: number, launchTick: number, look: ShotLook): void {
    this.held.set(ref, { launchTick, look });
  }

  /** Forget the shots `snapshot` no longer holds. */
  forgetLanded(snapshot: WorldSnapshot): void {
    for (const ref of this.held.keys()) if (entityById(snapshot, ref) === undefined) this.held.delete(ref);
  }

  clear(): void {
    this.held.clear();
  }
}
