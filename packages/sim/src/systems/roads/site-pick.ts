import { footprintCellDx } from '@open-northland/data';
import { ownerOf, Position, Stockpile } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { HEX_NEIGHBOUR_OFFSETS, nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { siteClaimHolder } from '../economy/site-claim.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../spatial/metric.js';
import { roadSitesByNode } from './site-index.js';

/**
 * Manhattan radius, in half-cell nodes, around the nearest workable road site within which a builder
 * weighs the other sites. Bounds the pick to about 2r² nodes whatever the number of sites. Tuning choice.
 */
const ROAD_PICK_RADIUS = 8;

interface Candidate {
  readonly site: Entity;
  /** 0 beside a site another builder claimed, whose stone paves this one for free; 1 otherwise. */
  readonly tier: number;
  /** Pending neighbours this site's stone would pave that no claimed site's stone already will. */
  readonly coverage: number;
  readonly distance: number;
}

/**
 * The road site a builder should claim next, given `nearest`, the nearest one it `accepts`. A finished
 * site's stone also paves each unclaimed, unstocked neighbour of its owner, so among the sites near
 * `nearest` the builder prefers one whose stone paves the most neighbours that no other builder's claimed
 * site will pave, and it avoids a site beside another builder's claim. Then the nearer, then the lower id.
 * Falls back to `nearest`. Project rule, an improvement over the original's plain nearest pick.
 */
export function pickRoadSite(
  world: World,
  terrain: TerrainGraph,
  builder: Entity,
  here: NodeId,
  nearest: Entity,
  accepts: (site: Entity) => boolean,
): Entity {
  const sites = roadSitesByNode(world, terrain);
  const owner = ownerOf(world, nearest);
  const origin = world.get(nearest, Position);
  const { hx: ax, hy: ay } = nodeOfPosition(origin.x, origin.y);
  const hereX = terrain.xOf(here);
  const hereY = terrain.yOf(here);

  const ownSiteAt = (hx: number, hy: number): Entity | undefined => {
    if (!terrain.inBounds(hx, hy)) return undefined;
    const site = sites.get(terrain.nodeAt(hx, hy));
    return site !== undefined && ownerOf(world, site) === owner ? site : undefined;
  };
  const claimedByOther = (site: Entity): boolean => {
    const holder = siteClaimHolder(world, site);
    return holder !== null && holder !== builder;
  };
  const besideClaim = new Map<NodeId, boolean>();
  const isBesideClaim = (hx: number, hy: number): boolean => {
    const node = terrain.nodeAtClamped(hx, hy);
    let beside = besideClaim.get(node);
    if (beside === undefined) {
      beside = someNeighbour(hx, hy, (nx, ny) => {
        const site = ownSiteAt(nx, ny);
        return site !== undefined && claimedByOther(site);
      });
      besideClaim.set(node, beside);
    }
    return beside;
  };

  const candidates: Candidate[] = [];
  for (let d = 0; d <= ROAD_PICK_RADIUS; d++) {
    const offsets = ringOffsetCount(d);
    for (let i = 0; i < offsets; i++) {
      const x = ax + ringOffsetDx(d, i);
      const y = ay + ringOffsetDy(d, i);
      const site = ownSiteAt(x, y);
      if (site === undefined || claimedByOther(site)) continue;
      let coverage = 0;
      someNeighbour(x, y, (nx, ny) => {
        const neighbour = ownSiteAt(nx, ny);
        if (neighbour !== undefined && pending(world, neighbour) && !isBesideClaim(nx, ny)) coverage++;
        return false;
      });
      candidates.push({
        site,
        tier: isBesideClaim(x, y) ? 0 : 1,
        coverage,
        distance: Math.abs(x - hereX) + Math.abs(y - hereY),
      });
    }
  }
  candidates.sort(
    (a, b) => b.tier - a.tier || b.coverage - a.coverage || a.distance - b.distance || a.site - b.site,
  );
  for (const candidate of candidates) {
    if (candidate.site === nearest || accepts(candidate.site)) return candidate.site;
  }
  return nearest;
}

/** Whether `test` holds for one of the six lattice neighbours of `(hx, hy)`. */
function someNeighbour(hx: number, hy: number, test: (nx: number, ny: number) => boolean): boolean {
  for (const c of HEX_NEIGHBOUR_OFFSETS) {
    if (test(hx + footprintCellDx(hy, c), hy + c.dy)) return true;
  }
  return false;
}

/** A site a neighbour's stone would pave: unclaimed and holding nothing. */
function pending(world: World, site: Entity): boolean {
  if (siteClaimHolder(world, site) !== null) return false;
  for (const amount of world.get(site, Stockpile).amounts.values()) if (amount > 0) return false;
  return true;
}
