import {
  ComputerColony,
  type ComputerColonyState,
  mapBriefOf,
  SettlerNeeds,
} from '../../../components/index.js';
import type { DeepReadonly } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { everySettlerOf, homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { civilianCount } from '../../ai-shared/workforce/pool.js';
import { needLevel } from '../../lifecycle/needs/index.js';
import { NEED_CRITICAL_THRESHOLD } from '../../lifecycle/needs/scale.js';
import { seatBaseOf } from '../base.js';
import { LATE_GAME_FROM_TICKS, minutesToTicks } from '../game-phase.js';
import { freeShips } from '../military/operations/landing.js';
import { evacuated } from './abandon.js';
import { colonists, colonyOrigin } from './founding.js';
import { homeSupply } from './home-supply.js';
import { pickParty } from './people.js';
import { LAND_GOOD_IDS, type LandGood, landHolds } from './provision.js';
import { colonyBuildings } from './spot.js';
import { type ColonySite, ROOMY_SITE_NODES, siteOffers, siteRoom, surveyColonySite } from './survey.js';
import {
  type ColonyEnv,
  type ColonyView,
  colonyEnv,
  homeLandOf,
  openColony,
  type SeatEnv,
} from './voyage.js';

// When a seat opens one more colony (owner ruling: it is not limited to one as time goes on). Every figure is
// authored from games observed on arabskie_wyspy_wolna_gra_mieszana with one colony and with none.

/** First colonies open in the middle game, so the late game is when the earliest has shown what it brings. */
const NEXT_COLONY_FROM_TICKS = LATE_GAME_FROM_TICKS;
/** A seat carries a colony per this many people: a colony holds about a fifth of a late seat's people, and
 *  past this share home's own economy goes short. */
const SETTLERS_PER_COLONY = 100;
/** Fighters at home a civilian there asks for: about what seats without a colony reach late. Seats with one
 *  colony that lost most fighters stood under it, and those stay at home until the army has caught up, as
 *  another party would be recruits it never gets. */
const FIGHTERS_PER_CIVILIAN = 1;
/** How long a colony's last unloading counts: about two of a trader's rounds. */
const DELIVERY_FRESH_TICKS = minutesToTicks(30);
/** The free ships at home that spare one for a scout and still leave the next landing a hull. */
const FREE_SHIPS_LEAST = 2;
/** A colony counts as fed while at most one mouth in this many is past the hunger that sends a settler to eat
 *  at any cost. Its stores say little: food passes straight through them, and a colony that held its people
 *  was seen with almost nothing in store. */
const MOUTHS_PER_HUNGRY = 10;
/** A later site is looked for over the whole survey: by then the rivals' colonies rule out the first ones, and
 *  a seat was seen to find none of its best few clear with many more on offer. */
const NEXT_SITE_CANDIDATES = Number.POSITIVE_INFINITY;

/** The cheap reads of whether a seat may look for one more site. */
export interface NextColonyRead {
  readonly tick: number;
  /** The tick the seat may try again. */
  readonly retryAt: number;
  /** Its colonies, a given-up one among them: a lost colony counts, so a seat does not bleed itself on them. */
  readonly colonies: number;
  /** Everyone it holds, and at home those who fight and those who do not. */
  readonly settlers: number;
  readonly fighters: number;
  readonly civilians: number;
  /** Whether every live colony runs on its trade route and nothing else of the seat's colonies is under
   *  way. */
  readonly settled: boolean;
  /** Whether the newest colony eats, and the tick its trader last unloaded at either stop. */
  readonly fed: boolean;
  readonly delivered: number | null;
  readonly freeShips: number;
}

/** Whether a seat may look past the colonies it holds. */
export function mayLookFurther(read: NextColonyRead): boolean {
  return (
    read.tick >= NEXT_COLONY_FROM_TICKS &&
    read.tick >= read.retryAt &&
    read.colonies < Math.floor(read.settlers / SETTLERS_PER_COLONY) &&
    read.fighters >= FIGHTERS_PER_CIVILIAN * read.civilians &&
    read.settled &&
    read.fed &&
    read.delivered !== null &&
    read.tick - read.delivered <= DELIVERY_FRESH_TICKS &&
    read.freeShips >= FREE_SHIPS_LEAST
  );
}

/** Whether nothing of the seat's colonies is under way but a running colony's route and ferry. */
function settled(colonies: readonly ColonyView[]): boolean {
  return colonies.every((colony) =>
    colony.phase === 'abandoned'
      ? evacuated(colony)
      : colony.phase === 'running' &&
        (colony.route?.ship ?? null) !== null &&
        colony.scout === null &&
        colony.ship === null,
  );
}

/** Whether the colony's people eat ({@link MOUTHS_PER_HUNGRY}). */
function colonyFed(env: ColonyEnv): boolean {
  const { world, ctx } = env;
  const people = colonists(env);
  const hungry = people.filter((e) => {
    const needs = world.tryGet(e, SettlerNeeds);
    return needs !== undefined && needLevel(needs, 'hunger', ctx.tick) > NEED_CRITICAL_THRESHOLD;
  });
  return MOUTHS_PER_HUNGRY * hungry.length <= people.length;
}

function nextColonyRead(
  env: SeatEnv,
  state: DeepReadonly<ComputerColonyState>,
  newest: ColonyEnv,
): NextColonyRead {
  const { world, ctx, seat } = env;
  const civilians = civilianCount(world, ctx, seat);
  return {
    tick: ctx.tick,
    retryAt: state.retryAt,
    colonies: state.colonies.length,
    settlers: everySettlerOf(world, seat).length,
    fighters: homeSettlers(world, ctx, seat).length - civilians,
    civilians,
    settled: settled(state.colonies),
    fed: colonyFed(newest),
    delivered: newest.colony.delivered,
    freeShips: freeShips(env, homeLandOf(env)).length,
  };
}

/** The land goods home runs short of and neither its land nor a live colony's holds. */
function lackedGoods(env: SeatEnv, colonies: readonly ColonyEnv[]): LandGood[] {
  const { world, ctx, seat } = env;
  const base = seatBaseOf(world, ctx, seat);
  const home = base === null ? null : anchorNodeOf(world, base);
  if (home === null) return [];
  const origins = [home];
  for (const colony of colonies) {
    const origin = colonyOrigin(colony, colony.colony, colonyBuildings(colony));
    if (origin !== null) origins.push(origin);
  }
  const supply = homeSupply(env);
  return LAND_GOOD_IDS.filter((id) => {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    if (good === undefined || supply.lackToComfort(good) <= 0) return false;
    return !origins.some((from) => landHolds(env, from, good));
  });
}

/**
 * The minute's look past the colonies a seat holds. It opens one more once {@link mayLookFurther} holds, the
 * home can spare a party, and a site on a land of no colony of its gives home a good it lacks or room for homes,
 * whose people sail home to fight (owner ruling); the survey ranks a site for people alone after every site
 * with resources.
 */
export function openNextColony(env: SeatEnv): void {
  const { world, ctx, seat, carrier } = env;
  const state = world.get(carrier, ComputerColony);
  const live = state.colonies
    .filter((colony) => colony.phase !== 'abandoned')
    .map((colony) => colonyEnv(env, colony));
  const newest = live.at(-1);
  if (newest === undefined || !mayLookFurther(nextColonyRead(env, state, newest))) return;
  const brief = mapBriefOf(world);
  if (brief === null || pickParty(world, ctx, seat, homeLandOf(env)).length === 0) return;
  const held = new Set(state.colonies.map((colony) => colony.land));
  const lacked = lackedGoods(env, live);
  const wanted = (site: ColonySite): boolean =>
    !held.has(site.land) &&
    (lacked.some((id) => siteOffers(brief, site, id)) ||
      siteRoom(world, { land: site.land, site: site.centre }) >= ROOMY_SITE_NODES);
  const site = surveyColonySite(world, ctx, seat, state.rejected, wanted, NEXT_SITE_CANDIDATES);
  if (site !== null) openColony(env, site);
}
