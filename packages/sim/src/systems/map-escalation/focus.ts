import type { MapEscalation } from '@open-northland/data';
import {
  Age,
  AttackOrder,
  Building,
  Engagement,
  hasMissionBehaviour,
  isPlayerDead,
  type MapEscalationFocusRecord,
  MISSION_BEHAVIOUR,
  mapEscalationProgress,
  Owner,
  Person,
  PlayerOrder,
  Position,
  Rider,
  Stance,
  setMissionBehaviour,
  writeMapEscalation,
} from '../../components/index.js';
import { aiCommand, type PlayerCommand } from '../../core/commands/index.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween, nodeManhattan, nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../ai-shared/seat-roster.js';
import type { SystemContext } from '../context.js';
import { houseFootprintOf, translatedCells } from '../footprint/geometry.js';
import { MILITARY_MODE } from '../readviews/index.js';

type Target = MapEscalation['attacks']['targets'][number];
type Focus = Pick<MapEscalationFocusRecord, 'kind' | 'entity'>;

/** Within this many map points of the aim a man strikes it itself; farther out he attack-moves on it. */
const STRIKE_REACH = 12;
/** A march whose goal lies within this many half-cell nodes of the aim's point is already on it: the
 *  walk order re-aims a blocked point to reachable ground beside it. */
const MARCH_SLACK = 8;

// Each targeted seat's aim: its headquarters first, then a random other building of the seat, re-drawn
// when that one falls, and once none stands one of its people nearest the attack's men. The escalation
// orders every attack man itself, the land band and the landed alike: an attack-move to the aim, the
// order a player's attack-move issues, so he walks at his pace and fights what he meets, then a strike
// on the aim once he stands beside it. Its men are no scripted handler's soldiers (`enlistAttackMan`).
// The aim costs its seat's rosters only when it moves.

/**
 * Re-aim every seat whose aim fell and order its attack men onto the aim, those left standing from
 * earlier attacks included. A man fighting is left to it. Returns the seats with men ashore and nothing
 * left to aim at: counted out, or without a building or a person.
 */
export function focusTurn(world: World, ctx: SystemContext, config: MapEscalation): ReadonlySet<number> {
  const spent = new Set<number>();
  const terrain = ctx.terrain;
  if (terrain === undefined) return spent;
  const held = mapEscalationProgress(world).focus;
  const next: MapEscalationFocusRecord[] = [];
  let changed = false;
  for (const target of config.attacks.targets) {
    const own = held.find((record) => record.seat === target.seat);
    const band = attackMen(world, target.raider);
    if (band.length === 0) {
      if (own !== undefined) next.push({ ...own });
      continue;
    }
    let aim: DeepReadonly<Focus> | null = null;
    if (!isPlayerDead(world, target.seat))
      aim =
        own !== undefined && stands(world, target.seat, own) ? own : pickFocus(world, ctx, target, own, band);
    if (aim !== (own ?? null)) changed = true;
    if (aim === null) {
      spent.add(target.seat);
      continue;
    }
    next.push({ seat: target.seat, kind: aim.kind, entity: aim.entity });
    for (const command of bandOrders(world, terrain, band, aim.entity))
      ctx.commands.enqueue(aiCommand(target.raider, command, 'map-ai'));
  }
  if (changed)
    writeMapEscalation(world, (progress) => {
      progress.focus = next;
    });
  return spent;
}

/** Make `e` an attack man: beyond every scripted handler's list, so only the escalation orders him. */
export function enlistAttackMan(world: World, e: Entity): void {
  setMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE, true);
}

/** The raider's attack men standing on the map: the escalation's own, not riding. */
function attackMen(world: World, raider: number): Entity[] {
  return ownedSettlers(world, raider).filter(
    (e) =>
      world.has(e, Position) &&
      !world.has(e, Rider) &&
      hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE),
  );
}

/** Whether the aim is still the seat's: its building, or its living person. */
function stands(world: World, seat: number, aim: DeepReadonly<Focus>): boolean {
  if (!world.isAlive(aim.entity) || world.tryGet(aim.entity, Owner)?.player !== seat) return false;
  return aim.kind === 'person' ? world.has(aim.entity, Person) : world.has(aim.entity, Building);
}

/**
 * The seat's next aim: its headquarters, the building on the target point, on the first look; then a
 * random finished building, else a random site; else the seat's grown person nearest the band. Null
 * for a seat with nothing left.
 */
function pickFocus(
  world: World,
  ctx: SystemContext,
  target: Target,
  previous: DeepReadonly<Focus> | undefined,
  band: readonly Entity[],
): Focus | null {
  const buildings = ownedBuildings(world, target.seat).filter((e) => world.has(e, Position));
  if (previous === undefined) {
    const headquarters = buildingOnPoint(world, ctx, buildings, target);
    if (headquarters !== null) return { kind: 'headquarters', entity: headquarters };
  }
  const finished = buildings.filter((e) => isBuilt(world, e));
  const pool = finished.length > 0 ? finished : buildings;
  const drawn = pool.length === 0 ? undefined : pool[ctx.rng.int(pool.length)];
  if (drawn !== undefined) return { kind: 'building', entity: drawn };
  const person = nearestPerson(world, target.seat, bandCentre(world, band));
  return person === null ? null : { kind: 'person', entity: person };
}

/** The seat's building whose body covers the target point or whose anchor is on it, the way the
 *  raider's Attack task finds the house it attacks. */
function buildingOnPoint(
  world: World,
  ctx: SystemContext,
  buildings: readonly Entity[],
  point: { x: number; y: number },
): Entity | null {
  const terrain = ctx.terrain;
  if (terrain === undefined || !terrain.inBounds(point.x, point.y)) return null;
  const node = terrain.nodeAt(point.x, point.y);
  for (const e of buildings) {
    const at = pointOf(world, e);
    if (at.hx === point.x && at.hy === point.y) return e;
    const cells = houseFootprintOf(ctx.content, world.get(e, Building))?.blocked ?? [];
    if (translatedCells(terrain, cells, at.hx, at.hy).includes(node)) return e;
  }
  return null;
}

function bandCentre(world: World, band: readonly Entity[]): HalfCellNode {
  let hx = 0;
  let hy = 0;
  for (const e of band) {
    const at = pointOf(world, e);
    hx += at.hx;
    hy += at.hy;
  }
  return { hx: Math.trunc(hx / band.length), hy: Math.trunc(hy / band.length) };
}

/** The seat's grown person standing nearest `from`, the lower id on a tie: a child takes no attack
 *  order, so a band aimed at one would stand beside it. */
function nearestPerson(world: World, seat: number, from: HalfCellNode): Entity | null {
  let best: Entity | null = null;
  let closest = Number.POSITIVE_INFINITY;
  for (const e of ownedSettlers(world, seat)) {
    if (!world.has(e, Position) || world.has(e, Age)) continue;
    const at = pointOf(world, e);
    const d = hexDistanceBetween(from.hx, from.hy, at.hx, at.hy);
    if (d < closest) {
      closest = d;
      best = e;
    }
  }
  return best;
}

/**
 * Each man's order onto the aim, when he needs a new one: an attack-move toward it while he is far and
 * not already marching on it, a strike once he stands within {@link STRIKE_REACH}. A man fighting, or
 * whose march waits out a fight to resume, gets none; a man not in the attack stance takes it first.
 */
function bandOrders(
  world: World,
  terrain: TerrainGraph,
  band: readonly Entity[],
  aim: Entity,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const goal = pointOf(world, aim);
  for (const e of band) {
    if (world.has(e, Engagement) || world.tryGet(e, AttackOrder)?.target === aim) continue;
    const at = pointOf(world, e);
    let order: PlayerCommand;
    if (hexDistanceBetween(at.hx, at.hy, goal.hx, goal.hy) <= STRIKE_REACH) {
      order = { kind: 'attackUnit', entity: e, target: aim, assault: true };
    } else {
      const march = world.tryGet(e, PlayerOrder)?.attackMove;
      if (march !== undefined && nodeManhattan(nodeOfId(terrain, march.goal), goal) <= MARCH_SLACK) continue;
      const { x, y } = terrain.coordsOf(terrain.nodeAtClamped(goal.hx, goal.hy));
      order = { kind: 'attackMoveUnit', entity: e, x, y };
    }
    if (world.tryGet(e, Stance)?.mode !== MILITARY_MODE.ATTACK)
      commands.push({ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    commands.push(order);
  }
  return commands;
}

function nodeOfId(terrain: TerrainGraph, node: NodeId): HalfCellNode {
  const { x, y } = terrain.coordsOf(node);
  return { hx: x, hy: y };
}

function pointOf(world: World, e: Entity): HalfCellNode {
  const at = world.get(e, Position);
  return nodeOfPosition(at.x, at.y);
}
