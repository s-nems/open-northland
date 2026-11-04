import { Building } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import { TOWER_POST_STRENGTH } from '../../../ai-shared/military/census.js';
import { buildingCombatClass } from '../../../readviews/index.js';
import type { Share } from '../../difficulty.js';
import { knownDefendingPoints } from '../enemy-strength.js';
import { launchRatioReached } from '../plan.js';
import {
  type BelievedLand,
  type BelievedTarget,
  believedFireAt,
  believedLands,
  coverAt,
  landingObjective,
} from './landing-target.js';
import type { OperationEnv } from './lifecycle.js';
import { RAID_TOWER_DEFENCE, visibleEnemyFighters } from './raid-target.js';

// Where a landing sails and whom it takes (owner ruling): every land the seat believes holds an enemy
// building is a candidate, the lands of a rival's headquarters first, where the whole wave goes, then his
// colonies, raided by a band sized to the defence the seat has seen there. A landing that clearly outweighs
// what defends a settlement storms it even where towers cover every building. Every figure is authored.

/** The least a landing outweighs what the seat believes defends its target when no building there lies
 *  clear of the towers and shelters: the believed army plus the fire and the towers' own weight
 *  ({@link RAID_TOWER_DEFENCE} each) at the objective. Authored: twice, so a wave that loses half its men to
 *  the towers on the way in still holds its edge. */
export const LANDING_STORM_EDGE: Share = { num: 2, den: 1 };

/** The least a landing outweighs the believed defence of a target clear of every tower: the edge of
 *  `landing.ts` for a known army. Authored: observed on arabskie_wyspy_wolna_gra_mieszana, a landing at
 *  parity with a rival's soldiers all fell within minutes for far fewer of his. */
export const LANDING_EDGE: Share = { num: 3, den: 2 };

/** The fewest men a raid on a rival's colony sets out with, however little the seat saw defend it: half a
 *  small ship's load, enough to fell a store before an unseen garrison gathers. */
export const COLONY_RAID_LEAST_MEN = 10;

/** A man the seat could send, with his points. */
export interface RankedMan {
  readonly entity: Entity;
  readonly points: number;
}

/** Where a landing sails and with whom. */
export interface LandingAim {
  readonly land: number;
  /** The owner of the headquarters there, else of most of the buildings the seat believes stand there. */
  readonly owner: number;
  /** The rival's headquarters stands on the land: the whole wave goes. Else it is a colony raid. */
  readonly headquarters: boolean;
  /** Where the ships seek their shores: the headquarters, else the building nearest the seat. */
  readonly towards: HalfCellNode;
  /** The building at {@link towards}. */
  readonly entity: Entity;
  readonly believed: BelievedLand;
  /** No building there lies clear: the landing strikes covered ground ({@link landingObjective}). */
  readonly storm: boolean;
  /** The wave, strongest first. */
  readonly men: readonly Entity[];
}

/** What the ships the landing may take hold. */
export interface LandingRoom {
  /** The seats of every free ship. */
  readonly seats: number;
  /** Enough ships and men for a big landing on a headquarters (`landing.ts`). */
  readonly bigLanding: boolean;
}

/** One candidate land as the seat believes it. */
interface Candidate {
  readonly land: number;
  readonly owner: number;
  readonly headquarters: BelievedTarget | null;
  readonly towards: BelievedTarget;
  readonly believed: BelievedLand;
}

function atLeast(a: Share, b: Share): Share {
  return a.num * b.den >= b.num * a.den ? a : b;
}

/**
 * The land the seat lands on and the wave it sends, or null while no land is worth it: the candidates
 * ({@link candidatesOf}) in turn, each rival's headquarters land first, nearest `from` first, then the
 * colonies the same way; the first the `ranked` men can take within `room` wins. On a headquarters land the
 * whole wave goes once `ratio` (the posture's launch edge) holds over the believed defence; on a colony the
 * strongest men go, as many as outweigh the defence seen there by {@link LANDING_EDGE}, at least
 * {@link COLONY_RAID_LEAST_MEN}. Costs the believed buildings and, with a colony to weigh, the enemies'
 * fighters.
 */
export function landingAim(
  env: OperationEnv,
  home: number,
  from: HalfCellNode,
  ranked: readonly RankedMan[],
  ratio: Share,
  room: LandingRoom,
): LandingAim | null {
  let fighters: LandFighters | null = null;
  for (const c of candidatesOf(env, home, from)) {
    if (c.headquarters !== null) {
      if (!room.bigLanding) continue;
      const aim = headquartersAim(env, c, ranked.slice(0, room.seats), ratio);
      if (aim !== null) return aim;
      continue;
    }
    fighters ??= landFighters(env);
    const aim = colonyAim(env, c, ranked, ratio, room.seats, fighters);
    if (aim !== null) return aim;
  }
  return null;
}

/** The enemy lands other than `home`, headquarters lands first, each group nearest `from` first. */
function candidatesOf(env: OperationEnv, home: number, from: HalfCellNode): Candidate[] {
  const { ctx } = env;
  const candidates: (Candidate & { readonly distance: number })[] = [];
  for (const [land, believed] of believedLands(env)) {
    if (land === home || believed.targets.length === 0) continue;
    let headquarters: BelievedTarget | null = null;
    let nearest: BelievedTarget | null = null;
    const owned = new Map<number, number>();
    for (const t of believed.targets) {
      owned.set(t.owner, (owned.get(t.owner) ?? 0) + 1);
      if (
        buildingCombatClass(ctx, t.buildingType) === 'hq' &&
        (headquarters === null || t.entity < headquarters.entity)
      )
        headquarters = t;
      if (nearest === null || nodeManhattan(t.at, from) < nodeManhattan(nearest.at, from)) nearest = t;
    }
    const towards = headquarters ?? nearest;
    if (towards === null) continue;
    let owner = headquarters?.owner ?? -1;
    if (owner < 0) {
      let most = 0;
      for (const [o, count] of [...owned].sort((a, b) => a[0] - b[0])) {
        if (count > most) {
          owner = o;
          most = count;
        }
      }
    }
    candidates.push({
      land,
      owner,
      headquarters,
      towards,
      believed,
      distance: nodeManhattan(towards.at, from),
    });
  }
  const group = (c: Candidate): number => (c.headquarters === null ? 1 : 0);
  return candidates.sort((a, b) => group(a) - group(b) || a.distance - b.distance || a.land - b.land);
}

function pointsOf(men: readonly RankedMan[]): number {
  let points = 0;
  for (const m of men) points += m.points;
  return points;
}

/** The tribe whose house bow a believed building's shelter fires, read off the building while it stands. */
function tribeOf(env: OperationEnv, target: BelievedTarget | null): number | undefined {
  return target === null ? undefined : env.world.tryGet(target.entity, Building)?.tribe;
}

/** The fire the seat believes covers `at`, 0 without a tribe to arm it. */
function fireAt(
  env: OperationEnv,
  believed: BelievedLand,
  at: HalfCellNode,
  tribe: number | undefined,
): number {
  return tribe === undefined ? 0 : believedFireAt(env.ctx, believed.sources, at, tribe);
}

/**
 * The whole wave on a rival's headquarters land: to a clear objective once it reaches `ratio`, at least
 * {@link LANDING_EDGE} against an army the seat knows, of the believed army plus the fire there (an unknown
 * army counts at parity, so the fire alone must not outweigh it); with none clear, it storms once it reaches
 * {@link LANDING_STORM_EDGE} of that plus the covering towers' weight.
 */
function headquartersAim(
  env: OperationEnv,
  c: Candidate,
  wave: readonly RankedMan[],
  ratio: Share,
): LandingAim | null {
  const { world, ctx, seat } = env;
  if (wave.length === 0) return null;
  const points = pointsOf(wave);
  const known = knownDefendingPoints(world, ctx, seat, c.owner);
  const edge = known === null ? ratio : atLeast(ratio, LANDING_EDGE);
  const tribe = tribeOf(env, c.headquarters);
  const aim = (storm: boolean): LandingAim => ({
    land: c.land,
    owner: c.owner,
    headquarters: true,
    towards: c.towards.at,
    entity: c.towards.entity,
    believed: c.believed,
    storm,
    men: wave.map((m) => m.entity),
  });
  const clear = landingObjective(ctx, c.believed, c.towards.at);
  if (clear !== null) {
    const fire = fireAt(env, c.believed, clear.at, tribe);
    const opposing = known === null ? Math.max(points, fire) : known + fire;
    return launchRatioReached(points, opposing, edge) ? aim(false) : null;
  }
  const storm = landingObjective(ctx, c.believed, c.towards.at, true);
  if (storm === null) return null;
  const opposing =
    (known ?? points) +
    fireAt(env, c.believed, storm.at, tribe) +
    coverAt(c.believed.sources, storm.at) * RAID_TOWER_DEFENCE;
  return launchRatioReached(points, opposing, atLeast(edge, LANDING_STORM_EDGE)) ? aim(true) : null;
}

/** The points of the enemy fighters the seat sees, by the land they stand on. */
type LandFighters = ReadonlyMap<number, number>;

function landFighters(env: OperationEnv): LandFighters {
  const { world, ctx, terrain, seat } = env;
  const byLand = new Map<number, number>();
  for (const f of visibleEnemyFighters(world, ctx, seat)) {
    if (!terrain.inBounds(f.at.hx, f.at.hy)) continue;
    const land = terrain.componentOf(terrain.nodeAt(f.at.hx, f.at.hy));
    byLand.set(land, (byLand.get(land) ?? 0) + f.points);
  }
  return byLand;
}

/** What the seat believes defends a colony land: each believed tower's weight ({@link RAID_TOWER_DEFENCE})
 *  and the posts last seen on it, and the enemy fighters it sees there now. */
function colonyDefence(
  env: OperationEnv,
  believed: BelievedLand,
  land: number,
  fighters: LandFighters,
): number {
  let points = fighters.get(land) ?? 0;
  for (const t of believed.targets) {
    if (buildingCombatClass(env.ctx, t.buildingType) === 'tower')
      points += RAID_TOWER_DEFENCE + t.postedPoints * TOWER_POST_STRENGTH;
  }
  return points;
}

/**
 * A raid on a rival's colony: the strongest of `ranked`, as many as reach {@link LANDING_EDGE} (or `ratio`
 * when larger, {@link LANDING_STORM_EDGE} when no building there lies clear) over its believed defence
 * ({@link colonyDefence}) plus the fire at its objective, at least {@link COLONY_RAID_LEAST_MEN}, all within
 * `seats`; null when the men at home cannot.
 */
function colonyAim(
  env: OperationEnv,
  c: Candidate,
  ranked: readonly RankedMan[],
  ratio: Share,
  seats: number,
  fighters: LandFighters,
): LandingAim | null {
  const clear = landingObjective(env.ctx, c.believed, c.towards.at);
  const goal = clear ?? landingObjective(env.ctx, c.believed, c.towards.at, true);
  if (goal === null) return null;
  const edge = atLeast(ratio, clear === null ? LANDING_STORM_EDGE : LANDING_EDGE);
  const target = c.believed.targets.find((t) => t.entity === goal.entity) ?? null;
  const opposing =
    colonyDefence(env, c.believed, c.land, fighters) + fireAt(env, c.believed, goal.at, tribeOf(env, target));
  const wave: Entity[] = [];
  let points = 0;
  for (const m of ranked) {
    if (wave.length >= COLONY_RAID_LEAST_MEN && launchRatioReached(points, opposing, edge)) break;
    if (wave.length >= seats) return null;
    wave.push(m.entity);
    points += m.points;
  }
  if (wave.length < COLONY_RAID_LEAST_MEN || !launchRatioReached(points, opposing, edge)) return null;
  return {
    land: c.land,
    owner: c.owner,
    headquarters: false,
    towards: c.towards.at,
    entity: c.towards.entity,
    believed: c.believed,
    storm: clear === null,
    men: wave,
  };
}

/**
 * The objective men landed on `believed` and standing at `from` storm when nothing there lies clear, or
 * null: the storm's objective once their `points` reach {@link LANDING_STORM_EDGE} of what the seat believes
 * defends it, the owner's known army plus the covering towers' weight on his headquarters land, else the
 * colony's believed defence ({@link colonyDefence}), with the fire at the objective either way.
 */
export function stormObjective(
  env: OperationEnv,
  believed: BelievedLand,
  land: number,
  owner: number | null,
  from: HalfCellNode,
  points: number,
): ReturnType<typeof landingObjective> {
  const goal = landingObjective(env.ctx, believed, from, true);
  if (goal === null) return null;
  const { world, ctx, seat } = env;
  const target = believed.targets.find((t) => t.entity === goal.entity) ?? null;
  const headquarters =
    believed.targets.find((t) => buildingCombatClass(ctx, t.buildingType) === 'hq') ?? null;
  const defence =
    headquarters !== null && owner !== null
      ? (knownDefendingPoints(world, ctx, seat, owner) ?? 0) +
        coverAt(believed.sources, goal.at) * RAID_TOWER_DEFENCE
      : colonyDefence(env, believed, land, landFighters(env));
  const opposing = defence + fireAt(env, believed, goal.at, tribeOf(env, target ?? headquarters));
  return launchRatioReached(points, opposing, LANDING_STORM_EDGE) ? goal : null;
}
