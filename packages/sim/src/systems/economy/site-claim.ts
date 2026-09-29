import { Palisade, RoadSite, SiteAssignment, UnderConstruction } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';

// A one-builder site - a wall segment or a road site - carries an exclusive builder claim; an ordinary
// building keeps its multi-builder crew.

type Claim = null | { builder: Entity };

/** Whether `site` takes one builder at a time. */
export function isSoloSite(world: World, site: Entity): boolean {
  return world.has(site, Palisade) || world.has(site, RoadSite);
}

function rawClaimOf(world: World, site: Entity): Claim | undefined {
  return (world.tryGet(site, Palisade) ?? world.tryGet(site, RoadSite))?.reservation;
}

function writeClaim(world: World, site: Entity, claim: Claim): void {
  if (world.has(site, Palisade)) world.mut(site, Palisade).reservation = claim;
  else world.mut(site, RoadSite).reservation = claim;
}

/**
 * The builder holding the site's claim. A claim lives while its builder does and stays assigned to this
 * unfinished site; once the site's one strike has landed it holds until the site finishes, whoever then
 * holds it, so its flag stays up while a wall segment waits for its cells to clear.
 */
export function siteClaimHolder(world: World, site: Entity): Entity | null {
  const claim = rawClaimOf(world, site);
  const labor = world.tryGet(site, UnderConstruction)?.labor;
  if (claim === undefined || claim === null || labor === undefined) return null;
  const { builder } = claim;
  if (labor >= ONE) return builder;
  const assignment = world.tryGet(builder, SiteAssignment);
  return world.isAlive(builder) && assignment?.site === site ? builder : null;
}

/** Whether this builder may select `site`; ordinary buildings keep their multi-builder crew behavior. */
export function constructionSiteAvailableTo(world: World, site: Entity, builder: Entity): boolean {
  if (!isSoloSite(world, site)) return true;
  const holder = siteClaimHolder(world, site);
  return holder === null || holder === builder;
}

/** Take the site's exclusive token after SiteAssignment has been stamped. A building or a standing
 *  wall a crew mends takes no token. */
export function claimSite(world: World, site: Entity, builder: Entity): boolean {
  if (!isSoloSite(world, site) || !world.has(site, UnderConstruction)) return true;
  const current = siteClaimHolder(world, site);
  if (current !== null && current !== builder) return false;
  if (current === builder) return true;
  writeClaim(world, site, { builder });
  return true;
}

/** Only the claim holder brings a one-builder site its material and strikes it. */
export function holdsSiteClaim(world: World, site: Entity, builder: Entity): boolean {
  return siteClaimHolder(world, site) === builder;
}

/** Release the one site claimed by `builder`, unless its strike has landed. Call before removing or
 *  replacing its SiteAssignment. */
export function releaseSiteClaim(world: World, builder: Entity): void {
  const assigned = world.tryGet(builder, SiteAssignment)?.site;
  if (assigned === undefined || rawClaimOf(world, assigned)?.builder !== builder) return;
  if ((world.tryGet(assigned, UnderConstruction)?.labor ?? 0) >= ONE) return;
  writeClaim(world, assigned, null);
}

/** Clear a claim that lapsed without a release, so the raw claim the flag is drawn from never outlives
 *  it: its builder died, or a job change, a drill or a pin elsewhere took its assignment. */
export function dropLapsedClaim(world: World, site: Entity): void {
  const claim = rawClaimOf(world, site);
  if (claim === undefined || claim === null || siteClaimHolder(world, site) !== null) return;
  writeClaim(world, site, null);
}
