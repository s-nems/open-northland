import { type SimEvent, TICKS_PER_SECOND } from '@open-northland/sim';
import { clamp01 } from '../math.js';
import { halfCellToScreenX, halfCellToScreenY } from '../projection/index.js';
import { SHOT_STRIKE_HEIGHT_PX } from '../scene/projectiles/arc.js';
import type { ShotShape } from '../scene/projectiles/launch.js';
import { WATER_PLANE_SQUASH } from './wake.js';

/**
 * An arrow a shield blocked glances off its target: it flips away to one side of its flight, spins half a
 * turn while it hops and drops to the ground, lies there a moment and fades. Open Northland's
 * presentation, timed in sim ticks so it holds still in a pause and keeps the game's speed; extents in
 * world px at zoom 1, tuned by eye.
 */

/** The glance from the strike to the ground, in sim ticks (about 0.4 s). */
export const GLANCE_TICKS = 5;
/** How long it lies on the ground before it fades, and the fade (about 0.6 and 0.4 s). */
const LIE_TICKS = 7;
const FADE_TICKS = 5;
/** A blocked arrow's whole life on screen, in sim ticks. */
export const DEFLECTION_TICKS = GLANCE_TICKS + LIE_TICKS + FADE_TICKS;
/** How far over the ground the glance flies sideways and back toward the shooter. */
const SIDE_REACH_PX = 20;
const BACK_REACH_PX = 5;
/** How high over the straight drop from the strike the glance hops. */
const HOP_PX = 14;
/** The turn the arrow makes on its way down: half a turn. */
const SPIN_RAD = Math.PI;
/** At most this many blocked arrows show at once; a new one retires the oldest. */
export const MAX_DEFLECTIONS = 48;
/** How long a launch's origin is kept for its arrow's heading, and how many are kept. */
const LAUNCH_MEMORY_SECONDS = 30;
const LAUNCH_MEMORY_TICKS = LAUNCH_MEMORY_SECONDS * TICKS_PER_SECOND;
const MAX_LAUNCHES = 512;

export type DeflectionSide = 1 | -1;

export interface Deflection {
  readonly projectile: number;
  readonly munitionType: number;
  /** The half-cell node the arrow struck at. */
  readonly hx: number;
  readonly hy: number;
  /** The screen angle the arrow flew in at (radians, y down, 0 = screen-east). */
  readonly heading: number;
  /** Which side of its flight it glances to: +1 turns clockwise on screen, -1 counter-clockwise. */
  readonly side: DeflectionSide;
  readonly shape: ShotShape | undefined;
  readonly spawnTick: number;
}

/** A blocked arrow at one moment, written in place. */
export interface DeflectionPose {
  /** Screen offset of the point under the arrow from the strike node's ground point. */
  dx: number;
  dy: number;
  /** Height of the arrow's middle over that ground point. */
  lift: number;
  /** The turn from its incoming heading, radians, clockwise on screen. */
  spin: number;
  alpha: number;
}

/** The side a projectile glances to, stable per id so a replay shows the same glance. */
export function deflectionSide(projectile: number): DeflectionSide {
  return (projectile & 1) === 0 ? 1 : -1;
}

/** Blocked arrow `d` at `age` sim ticks after its block, written to `out`. */
export function deflectionPose(d: Deflection, age: number, out: DeflectionPose): void {
  const t = clamp01(age / GLANCE_TICKS);
  const eased = 1 - (1 - t) * (1 - t);
  // Work on the ground plane, where "sideways" is square to the flight, then squash back to the screen.
  const gx = Math.cos(d.heading);
  const gy = Math.sin(d.heading) / WATER_PLANE_SQUASH;
  const norm = Math.hypot(gx, gy) || 1;
  const ux = gx / norm;
  const uy = gy / norm;
  const groundX = (-uy * d.side * SIDE_REACH_PX - ux * BACK_REACH_PX) * eased;
  const groundY = (ux * d.side * SIDE_REACH_PX - uy * BACK_REACH_PX) * eased;
  out.dx = groundX;
  out.dy = groundY * WATER_PLANE_SQUASH;
  out.lift = SHOT_STRIKE_HEIGHT_PX * (1 - t) + 4 * HOP_PX * t * (1 - t);
  out.spin = d.side * SPIN_RAD * eased;
  out.alpha = clamp01(1 - (age - GLANCE_TICKS - LIE_TICKS) / FADE_TICKS);
}

/** The arrow a shooter looses, by shooter id; undefined draws the authored frame. */
export type DeflectionShapeOf = (shooter: number) => ShotShape | undefined;

/**
 * The blocked arrows on show, oldest first, and the launch origins their headings are read from. Its
 * work follows the shots: one entry per launch until it lands, one per block until it fades.
 */
export class Deflections {
  private readonly launches = new Map<
    number,
    { readonly hx: number; readonly hy: number; readonly tick: number }
  >();
  private live: Deflection[] = [];
  /** Bumped whenever an arrow leaves the list, so a consumer retires its nodes only then. */
  revision = 0;

  get values(): readonly Deflection[] {
    return this.live;
  }

  ingest(events: readonly SimEvent[], tick: number, shapeOf?: DeflectionShapeOf): void {
    for (const [id, launch] of this.launches) {
      if (tick - launch.tick <= LAUNCH_MEMORY_TICKS) break;
      this.launches.delete(id);
    }
    for (const event of events) {
      if (event.kind === 'projectileLaunched') {
        this.launches.set(event.projectile, { ...event.at, tick });
        if (this.launches.size > MAX_LAUNCHES) {
          const oldest = this.launches.keys().next().value;
          if (oldest !== undefined) this.launches.delete(oldest);
        }
      } else if (event.kind === 'projectileHit' || event.kind === 'projectileMissed') {
        this.launches.delete(event.projectile);
      } else if (event.kind === 'arrowBlocked') {
        this.block(event, tick, shapeOf);
      }
    }
  }

  /** Drop the arrows faded out by `renderTime`. */
  expire(renderTime: number): void {
    const first = this.live[0];
    if (first === undefined || renderTime - first.spawnTick < DEFLECTION_TICKS) return;
    this.live = this.live.filter((d) => renderTime - d.spawnTick < DEFLECTION_TICKS);
    this.revision++;
  }

  clear(): void {
    this.launches.clear();
    this.live = [];
    this.revision++;
  }

  private block(
    event: Extract<SimEvent, { kind: 'arrowBlocked' }>,
    tick: number,
    shapeOf: DeflectionShapeOf | undefined,
  ): void {
    const { hx, hy } = event.at;
    const from = this.launches.get(event.projectile);
    this.launches.delete(event.projectile);
    const heading =
      from === undefined
        ? 0
        : Math.atan2(
            halfCellToScreenY(hy) - halfCellToScreenY(from.hy),
            halfCellToScreenX(hx, hy) - halfCellToScreenX(from.hx, from.hy),
          );
    if (this.live.length >= MAX_DEFLECTIONS) {
      this.live.shift();
      this.revision++;
    }
    this.live.push({
      projectile: event.projectile,
      munitionType: event.munitionType,
      hx,
      hy,
      heading,
      side: deflectionSide(event.projectile),
      shape: shapeOf?.(event.shooter),
      spawnTick: tick,
    });
  }
}
