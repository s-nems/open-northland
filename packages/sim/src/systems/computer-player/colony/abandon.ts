import { BUILDING_KIND } from '@open-northland/data';
import { Building, Female } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { hexDistance } from '../../../nav/halfcell.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { visibleEnemyFighters } from '../military/operations/raid-target.js';
import type { ColonyEnv, ColonyView } from './env.js';
import { releaseRoute } from './goods/route.js';
import { colonists, colonyBuildings } from './roster.js';
import { runFerry } from './settlement/ferry.js';
import { forgetGarrison } from './settlement/garrison.js';
import { bringScoutHome, COLONY_RETRY_TICKS } from './voyage/voyage.js';

/** How near the site, in hex nodes, a seen enemy fighter counts against a colony with no store (authored: a
 *  tower's clearance, the reach at which a landing keeps away). */
const OVERRUN_RANGE_NODES = 30;
/** The enemy fighters near the site each of the colony's men stands against (authored): a band that
 *  outnumbers its men overruns a colony with no store to hold, a passing soldier does not. */
const OVERRUN_FIGHTERS_PER_MAN = 1;

/** Whether the colony is lost: nobody stands there, or no store does and the enemy fighters seen near the
 *  site outnumber its men ({@link OVERRUN_FIGHTERS_PER_MAN}), its garrison among them. */
export function overrun(env: ColonyEnv, colony: ColonyView): boolean {
  const { world, ctx, seat } = env;
  const people = colonists(env);
  if (people.length === 0) return true;
  const buildings = contentIndex(ctx.content).buildings;
  const stands = colonyBuildings(env).some(
    (e) =>
      isBuilt(world, e) && buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
  );
  if (stands) return false;
  const site = { hx: colony.site.hx, hy: colony.site.hy };
  const enemies = visibleEnemyFighters(world, ctx, seat).filter(
    (f) => hexDistance(f.at, site) <= OVERRUN_RANGE_NODES,
  ).length;
  const men = people.filter((e) => !world.has(e, Female) && isAdultSettler(world, e)).length;
  return enemies > OVERRUN_FIGHTERS_PER_MAN * men;
}

/** The colony is given up for good. The people lists empty, as a survivor home again is home's; the garrison
 *  stays listed until it lands at home, as a fighter counts by his list alone. The land stays out of the home
 *  reads, a ship comes for whoever is left, and the seat's next voyage waits for its stores. */
export function abandonColony(env: ColonyEnv): void {
  env.editSeat().retryAt = env.ctx.tick + COLONY_RETRY_TICKS;
  const live = env.edit();
  live.phase = 'abandoned';
  live.since = env.ctx.tick;
  live.people = [];
  live.rest = [];
  live.ship = null;
}

/** Whether the colony is abandoned and wound up: its route let go, no ferry and no scout ship out for it. */
export function evacuated(colony: ColonyView): boolean {
  return (
    colony.phase === 'abandoned' && colony.route === null && colony.ferry === null && colony.scout === null
  );
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
