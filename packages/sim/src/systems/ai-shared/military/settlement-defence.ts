import {
  AiControl,
  Building,
  computerModuleRuns,
  isPlayerDead,
  MapAiDefence,
  type MapAiDefenceState,
  Owner,
  operationMembersOf,
  WaveMarch,
} from '../../../components/index.js';
import { aiCommand, type PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { leashedAttack, strikeParty } from '../../conflict/leash.js';
import { forgetOffenders, liveOffenders } from '../../conflict/offenders.js';
import { strikeBackLeash } from '../../conflict/strike-back.js';
import type { System, SystemContext } from '../../context.js';
import { peaceGroundFor } from '../../match/peace.js';
import { hexNodeDistance } from '../../spatial/metric.js';
import { entityNode } from '../../spatial/nodes.js';
import { militaryDecisionDue } from '../cadence.js';
import { ownedBuildings } from '../seat-roster.js';
import { type ArmyCensus, takeCensus } from './census.js';
import { assessSeatThreat, NO_THREAT, type SeatThreat } from './defence/danger.js';
import {
  alarmOrders,
  enlistOrders,
  MAP_AI_DEFENCE_REACH_POINTS,
  raidOnTheSettlement,
  seatRaiders,
  sortieOrders,
  towerPostOrders,
} from './defence/index.js';
import {
  type IntruderAnswer,
  type IntruderAnswers,
  intruderAnswers,
  NO_INTRUDER_ANSWERS,
} from './defence/intruder-answers.js';
import { musterMilitia } from './defence/militia.js';
import {
  type Raider,
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
  watchBandOf,
} from './defence/threat.js';
import { mapAiSoldierClaims } from './ownership.js';

export interface SettlementDefence {
  readonly commands: readonly PlayerCommand[];
  readonly army: ArmyCensus;
  readonly available: readonly Entity[];
  readonly raid: Raider | null;
  readonly mapSorties: readonly { entity: Entity; state: MapAiDefenceState }[];
  /** The computer seat's weighed zones; empty for a seat the map AI defends. */
  readonly threat: SeatThreat;
  /** The computer seat's answers to unarmed intruders, applied by the defence system itself, since a
   *  leashed attack order has no command; the scouts it has no soldier for go to its militia. */
  readonly intruders: IntruderAnswers;
}

/** The last plan per world, with everything it was derived from. The defence system and the computer
 *  player's military module plan the same seat on the same tick with nothing written in between, so the
 *  second asks for a plan of an unchanged world. */
interface PlanMemo {
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly tick: number;
  readonly mutationVersion: number;
  readonly player: number;
  readonly autonomous: boolean;
  readonly plan: SettlementDefence;
}

const lastPlans = new WeakMap<World, PlanMemo>();

/** One allocation for both callers: map tasks and marching campaigns keep their soldiers; towers
 * take their posts, a nearby raid takes the remaining home force, and autonomous planning gets the rest. */
export function planSettlementDefence(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  autonomous = computerModuleRuns(world, player, 'military'),
): SettlementDefence {
  const mutationVersion = world.mutationVersion;
  const memo = lastPlans.get(world);
  if (
    memo !== undefined &&
    memo.mutationVersion === mutationVersion &&
    memo.tick === ctx.tick &&
    memo.ctx === ctx &&
    memo.terrain === terrain &&
    memo.player === player &&
    memo.autonomous === autonomous
  ) {
    return memo.plan;
  }
  const plan = deriveSettlementDefence(world, ctx, terrain, player, autonomous);
  // A plan whose derivation wrote the world no longer matches the world a repeat call would see.
  if (world.mutationVersion === mutationVersion) {
    lastPlans.set(world, { ctx, terrain, tick: ctx.tick, mutationVersion, player, autonomous, plan });
  }
  return plan;
}

function deriveSettlementDefence(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  autonomous: boolean,
): SettlementDefence {
  const owned = ownedBuildings(world, player);
  const claimed = mapAiSoldierClaims(world, player);
  const census = takeCensus(world, ctx, player);
  const army = {
    ready: without(census.ready, claimed),
    awaitingWeapon: without(census.awaitingWeapon, claimed),
  };
  // The marching wave's men and those of the seat's other operations (a raid) stay theirs.
  const marching = autonomous ? operationMembersOf(world, player) : new Set<Entity>();
  if (autonomous) {
    for (const carrier of world.query(WaveMarch, Owner)) {
      if (world.get(carrier, Owner).player !== player) continue;
      for (const e of world.get(carrier, WaveMarch).men) marching.add(e);
    }
  }
  const home = without(army.ready, marching);
  const raiders = seatRaiders(world, ctx, terrain, player);
  const posts = towerPostOrders(
    world,
    ctx,
    terrain,
    owned,
    home,
    autonomous ? 'computer-player' : 'map-ai',
    () => raiders,
  );
  const free = without(home, posts.claimed);
  // A raider on a peace partner's ground draws no sortie: the peace refuses the walk, so he would hold the
  // whole home band in refused orders for as long as he stands there.
  const peace = peaceGroundFor(world, player);
  const raidable = peace === null ? raiders : raiders.filter((raider) => !peace.bars(raider.x, raider.y));
  const raid = raidOnTheSettlement(world, ctx, terrain, owned, raidable);
  const threat = autonomous
    ? assessSeatThreat(
        world,
        ctx,
        terrain,
        player,
        owned,
        raiders,
        liveOffenders(world, player, ctx.tick),
        new Set([...marching, ...claimed]),
      )
    : NO_THREAT;
  // A raid sends the whole free band, intruders among the raiders' targets.
  const answered =
    raid === null && threat.zones.length > 0
      ? intruderAnswers(world, ctx, terrain, player, threat, free)
      : NO_INTRUDER_ANSWERS;
  // Approximation: a map-controlled camp answers with nearby free soldiers, using the same reach
  // as its extra tower guards. A distant camp must not empty merely because both share a player.
  const threatened =
    raid === null
      ? []
      : owned.filter(
          (building) =>
            hexNodeDistance(
              terrain,
              entityNode(world, terrain, building),
              terrain.nodeAtClamped(raid.x, raid.y),
            ) <= watchBandOf(world, ctx, building),
        );
  const responders = autonomous
    ? free
    : free.filter((soldier) =>
        threatened.some(
          (building) =>
            hexNodeDistance(
              terrain,
              entityNode(world, terrain, soldier),
              entityNode(world, terrain, building),
            ) <= MAP_AI_DEFENCE_REACH_POINTS,
        ),
      );
  const sortie = raid === null ? [] : sortieOrders(world, terrain, responders, raid);
  const mapSorties: { entity: Entity; state: MapAiDefenceState }[] = [];
  if (!autonomous && raid !== null) {
    for (const command of sortie) {
      if (command.kind !== 'attackMoveUnit') continue;
      const here = entityNode(world, terrain, command.entity);
      let camp: Entity | undefined;
      let distance = Number.POSITIVE_INFINITY;
      for (const building of threatened) {
        const near = hexNodeDistance(terrain, here, entityNode(world, terrain, building));
        if (near < distance || (near === distance && (camp === undefined || building < camp))) {
          camp = building;
          distance = near;
        }
      }
      if (camp === undefined) continue;
      const centre = terrain.coordsOf(entityNode(world, terrain, camp));
      const home = terrain.coordsOf(here);
      mapSorties.push({
        entity: command.entity,
        state: {
          player,
          centre: { hx: centre.x, hy: centre.y },
          home: { hx: home.x, hy: home.y },
          radius: threatWatchNodes(ctx, world.get(camp, Building).tribe) + THREAT_STAND_DOWN_MARGIN_NODES,
          threat: raid.entity,
          returning: false,
        },
      });
    }
  }
  return {
    army,
    available: raid === null ? without(free, answered.claimed) : [],
    raid,
    mapSorties,
    threat,
    intruders: answered,
    commands: [
      ...enlistOrders(world, ctx, player),
      ...alarmOrders(world, ctx, terrain, owned, raiders),
      ...posts.commands,
      ...sortie,
    ],
  };
}

/** `men` less those in `taken`, in order; `men` itself when nothing is taken. */
function without(men: readonly Entity[], taken: ReadonlySet<Entity>): readonly Entity[] {
  return taken.size === 0 ? men : men.filter((e) => !taken.has(e));
}

/** Local protection remains active for map AI even when autonomous military planning is disabled. */
export const settlementDefenceSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  // Collected before planning, since a plan adds components; only the seats whose slot this is.
  const seats: { readonly player: number; readonly mapAiEnabled: boolean }[] = [];
  for (const e of world.query(AiControl)) {
    const seat = world.get(e, AiControl);
    if (militaryDecisionDue(ctx.tick, seat.player, seat.computerEnabled)) seats.push(seat);
  }
  seats.sort((a, b) => a.player - b.player);
  for (const seat of seats) {
    if (isPlayerDead(world, seat.player)) continue;
    const autonomous = computerModuleRuns(world, seat.player, 'military');
    if (!seat.mapAiEnabled && !autonomous) continue;
    if (autonomous) forgetOffenders(world, seat.player, ctx.tick);
    const plan = planSettlementDefence(world, ctx, terrain, seat.player, autonomous);
    for (const { entity, state } of plan.mapSorties) world.add(entity, MapAiDefence, state);
    for (const command of plan.commands) {
      ctx.commands.enqueue(aiCommand(seat.player, command, 'settlement-defence'));
    }
    answerIntruders(world, ctx, terrain, seat.player, plan.intruders.answers);
    if (autonomous) musterMilitia(world, ctx, terrain, seat.player, plan.threat, plan.intruders.scoutChases);
  }
};

/** Send the soldiers each answer names at its intruder on his zone's leash, or, with none, the first free
 *  civilians it lists on their own strike-back leash. */
function answerIntruders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  answers: readonly IntruderAnswer[],
): void {
  const origin = { player, source: 'settlement-defence' } as const;
  for (const { intruder, leash, soldiers, people } of answers) {
    for (const e of soldiers) leashedAttack(world, ctx, e, intruder, { ...leash }, origin);
    if (people.length > 0) {
      strikeParty(world, ctx, terrain, intruder, people, null, origin, (e) =>
        strikeBackLeash(world, terrain, e),
      );
    }
  }
}
