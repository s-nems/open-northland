import { BUILDING_KIND } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { hexDistance } from '../../../nav/halfcell.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { visibleEnemyFighters } from '../military/operations/raid-target.js';
import { runFerry } from './ferry.js';
import { colonists } from './founding.js';
import { forgetGarrison } from './garrison.js';
import { releaseRoute } from './route.js';
import { colonyBuildings } from './spot.js';
import { bringScoutHome, type ColonyEnv, type ColonyView } from './voyage.js';

/** How near the site, in hex nodes, a seen enemy overruns a colony with no store (authored: a tower's
 *  clearance, the reach at which a landing keeps away). */
const OVERRUN_RANGE_NODES = 30;

/** Whether the colony is lost: nobody stands there, or no store does and an enemy is seen near the site. */
export function overrun(env: ColonyEnv, colony: ColonyView): boolean {
  const { world, ctx, seat } = env;
  if (colonists(env).length === 0) return true;
  const buildings = contentIndex(ctx.content).buildings;
  const stands = colonyBuildings(env).some(
    (e) =>
      isBuilt(world, e) && buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
  );
  if (stands) return false;
  const site = { hx: colony.site.hx, hy: colony.site.hy };
  return visibleEnemyFighters(world, ctx, seat).some((f) => hexDistance(f.at, site) <= OVERRUN_RANGE_NODES);
}

/** The colony is given up for good. The people lists empty, as a survivor home again is home's; the garrison
 *  stays listed until it lands at home, as a fighter counts by his list alone. The land stays out of the home
 *  reads, and a ship comes for whoever is left. */
export function abandonColony(env: ColonyEnv): void {
  const live = env.edit();
  live.phase = 'abandoned';
  live.since = env.ctx.tick;
  live.people = [];
  live.rest = [];
  live.ship = null;
}

/**
 * An abandoned colony's last orders: the scout ship goes home, the trade route is let go, and the ferry
 * fetches survivors a load at a time and sets them ashore at home. Nothing is rebuilt. With no ship left they
 * stay where they are, out of the home reads.
 */
export function evacuate(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  forgetGarrison(env, colony, true);
  return [...bringScoutHome(env, colony), ...releaseRoute(env, colony), ...runFerry(env, env.colony)];
}
