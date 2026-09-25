import { Palisade, SiteAssignment, UnderConstruction } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * The builder holding the segment's claim. A claim lives while its builder does and stays assigned to this
 * unfinished segment; once the segment's one strike has landed it holds until the wall stands, whoever
 * then holds it, so its flag stays up while the segment waits for its cells to clear.
 */
export function palisadeReservedBy(world: World, site: Entity): Entity | null {
  const wall = world.tryGet(site, Palisade);
  const labor = world.tryGet(site, UnderConstruction)?.labor;
  if (wall === undefined || wall.reservation === null || labor === undefined) return null;
  const { builder } = wall.reservation;
  if (labor >= ONE) return builder;
  const assignment = world.tryGet(builder, SiteAssignment);
  return world.isAlive(builder) && assignment?.site === site ? builder : null;
}

/** Whether this builder may select `site`; ordinary buildings keep their multi-builder crew behavior. */
export function constructionSiteAvailableTo(world: World, site: Entity, builder: Entity): boolean {
  const wall = world.tryGet(site, Palisade);
  if (wall === undefined) return true;
  const reserved = palisadeReservedBy(world, site);
  return reserved === null || reserved === builder;
}

/** Take the segment's exclusive token after SiteAssignment has been stamped. A building or a standing
 *  wall a crew mends takes no token. */
export function claimPalisade(world: World, site: Entity, builder: Entity): boolean {
  if (!world.has(site, Palisade) || !world.has(site, UnderConstruction)) return true;
  const current = palisadeReservedBy(world, site);
  if (current !== null && current !== builder) return false;
  if (current === builder) return true;
  world.mut(site, Palisade).reservation = { builder };
  return true;
}

/** Only the claim holder brings a segment its wood and strikes it. */
export function holdsPalisadeClaim(world: World, site: Entity, builder: Entity): boolean {
  return palisadeReservedBy(world, site) === builder;
}

/** Release the one segment claimed by `builder`, unless its strike has landed. Call before removing or
 *  replacing its SiteAssignment. */
export function releasePalisadeReservation(world: World, builder: Entity): void {
  const assigned = world.tryGet(builder, SiteAssignment)?.site;
  if (assigned === undefined || world.tryGet(assigned, Palisade)?.reservation?.builder !== builder) return;
  if ((world.tryGet(assigned, UnderConstruction)?.labor ?? 0) >= ONE) return;
  world.mut(assigned, Palisade).reservation = null;
}

/** Clear a claim that lapsed without a release, so the raw claim the flag is drawn from never outlives
 *  it: its builder died, or a job change, a drill or a pin elsewhere took its assignment. */
export function dropLapsedClaim(world: World, site: Entity): void {
  const wall = world.tryGet(site, Palisade);
  if (wall === undefined || wall.reservation === null || palisadeReservedBy(world, site) !== null) return;
  world.mut(site, Palisade).reservation = null;
}
