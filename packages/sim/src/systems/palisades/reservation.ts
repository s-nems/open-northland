import { Palisade, SiteAssignment, UnderConstruction } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/** A live claim belongs to one living builder still assigned to this unfinished segment. */
export function palisadeReservedBy(world: World, site: Entity): Entity | null {
  const wall = world.tryGet(site, Palisade);
  if (wall === undefined || wall.reservation === null || !world.has(site, UnderConstruction)) return null;
  const reservation = wall.reservation;
  const assignment = world.tryGet(reservation.builder, SiteAssignment);
  if (world.isAlive(reservation.builder) && assignment?.site === site) return reservation.builder;
  return null;
}

/** Whether this builder may select `site`; ordinary buildings keep their multi-builder crew behavior. */
export function constructionSiteAvailableTo(world: World, site: Entity, builder: Entity): boolean {
  const wall = world.tryGet(site, Palisade);
  if (wall === undefined || wall.repairing) return true;
  const reserved = palisadeReservedBy(world, site);
  return reserved === null || reserved === builder;
}

/** Take the segment's exclusive token after SiteAssignment has been stamped. */
export function claimPalisade(world: World, site: Entity, builder: Entity): boolean {
  const wall = world.tryGet(site, Palisade);
  if (wall === undefined) return true;
  if (wall.repairing) return true;
  if (!world.has(site, UnderConstruction)) return false;
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

/** Release the one segment claimed by `builder`. Call before removing its SiteAssignment. */
export function releasePalisadeReservation(world: World, builder: Entity): void {
  const assigned = world.tryGet(builder, SiteAssignment)?.site;
  if (assigned === undefined) return;
  const wall = world.tryMut(assigned, Palisade);
  if (wall?.reservation?.builder === builder) wall.reservation = null;
}
