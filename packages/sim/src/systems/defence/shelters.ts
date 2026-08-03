import {
  Building,
  DefenceMode,
  Owner,
  Position,
  Sheltering,
  UnderConstruction,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { shelterCapacityOf } from '../readviews/index.js';
import { canonicalById } from '../spatial/nodes.js';

/** One building standing on alarm: where it is and how many civilians it still has room for once the
 *  claims already made against it are counted. */
export interface ShelterSite {
  readonly entity: Entity;
  readonly hx: number;
  readonly hy: number;
  /** Places left after the live {@link Sheltering} claims - the drive decrements it as it hands them out. */
  free: number;
}

/** The alarm-raised buildings a civilian may still run to, grouped by owning player and in canonical
 *  (ascending entity-id) order, with this tick's standing claims already subtracted. */
export type ShelterSites = ReadonlyMap<number, readonly ShelterSite[]>;

/**
 * Read the tick's shelter ledger. Built once per planner pass and shared by every settler it plans, so
 * the seats are handed out first-come-first-served instead of each settler re-deriving the same counts
 * (see {@link Sheltering} for why the claim, not the arrival, is what capacity counts).
 *
 * A building drops out the moment it stops holding a garrison ({@link shelterStillHolds}); the
 * DefenceSystem sheds the claims it still held, so the two readings can never disagree.
 */
export function collectShelters(world: World, ctx: SystemContext): ShelterSites {
  const byPlayer = new Map<number, ShelterSite[]>();
  const byEntity = new Map<Entity, ShelterSite>();
  for (const e of canonicalById(world.query(DefenceMode))) {
    if (!shelterStillHolds(world, ctx, e)) continue;
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const site: ShelterSite = {
      entity: e,
      hx,
      hy,
      free: shelterCapacityOf(ctx.content, world.get(e, Building).buildingType),
    };
    byEntity.set(e, site);
    const player = world.get(e, Owner).player;
    const list = byPlayer.get(player);
    if (list === undefined) byPlayer.set(player, [site]);
    else list.push(site);
  }
  if (byEntity.size === 0) return byPlayer;
  for (const e of world.query(Sheltering)) {
    const site = byEntity.get(world.get(e, Sheltering).shelter);
    if (site !== undefined) site.free--;
  }
  return byPlayer;
}

/**
 * Whether `shelter` still holds a garrison: alive, owned, positioned, on alarm, standing finished, and of
 * a type the content gives a `shelterCapacity`. The one reading behind both the ledger above and the
 * DefenceSystem's release pass - a building that fails it releases everyone claiming it.
 */
export function shelterStillHolds(world: World, ctx: SystemContext, shelter: Entity): boolean {
  if (!world.isAlive(shelter) || !world.has(shelter, DefenceMode)) return false;
  if (world.has(shelter, UnderConstruction)) return false;
  const b = world.tryGet(shelter, Building);
  if (b === undefined || !world.has(shelter, Owner) || !world.has(shelter, Position)) return false;
  return shelterCapacityOf(ctx.content, b.buildingType) > 0;
}
