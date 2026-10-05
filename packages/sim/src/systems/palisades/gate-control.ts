import {
  diplomacyStance,
  GateControl,
  Health,
  isAiPlayer,
  ownerOf,
  Palisade,
  Position,
  Settler,
  UnderConstruction,
  Vehicle,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { CombatIndex } from '../conflict/combat-index.js';
import type { System } from '../context.js';
import { setPalisadeGate } from './index.js';

/** Gameplay tuning: close at 12 map points (six visual cells along either map axis).
 * Living enemy settlers (civilians included) and vehicles count; buildings and wildlife do not. */
export const GATE_ENEMY_NEAR_POINTS = 12;

interface GateList {
  readonly feed: ChangeFeed;
  readonly gates: Entity[];
}
const lists = new WeakMap<World, GateList>();
const gateId = (e: Entity): number => e;

function gatesOf(world: World): readonly Entity[] {
  let list = lists.get(world);
  const derive = (): Entity[] =>
    world.canonicalQuery(Palisade).filter((e) => world.get(e, Palisade).gate !== null);
  if (list === undefined) {
    list = { feed: world.watchChanges([Palisade], []), gates: derive() };
    lists.set(world, list);
    world.registerCacheVerifier('controlledGateList', () => {
      const held = gatesOf(world),
        fresh = derive();
      return held.length === fresh.length && held.every((e, i) => e === fresh[i])
        ? []
        : ['controlledGateList is stale'];
    });
  }
  const { gates } = list;
  if (
    list.feed.drain((e) => {
      const gate = world.tryGet(e, Palisade)?.gate;
      removeSortedById(gates, e, gateId);
      if (gate != null) insertSortedById(gates, e, gateId);
    })
  )
    gates.splice(0, gates.length, ...derive());
  return gates;
}

export function setPalisadeGateMode(
  world: World,
  command: Extract<Command, { kind: 'setPalisadeGateMode' }>,
): void {
  const gate = world.tryGet(command.palisade, Palisade)?.gate;
  if (gate == null || world.has(command.palisade, UnderConstruction)) return;
  world.add(command.palisade, GateControl, { mode: command.mode });
}

/** AI adopts existing and newly built gates without a scripted handler or a first-turn gate limit.
 * An explicit order owns the policy from then on, including when an occupied passage must retry. */
export const gateControlSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return;
  let threats: CombatIndex | undefined;
  for (const e of gatesOf(world)) {
    if (world.has(e, UnderConstruction) || !world.has(e, Position)) continue;
    const owner = ownerOf(world, e);
    let control = world.tryGet(e, GateControl);
    if (control === undefined && owner !== undefined && isAiPlayer(world, owner)) {
      world.add(e, GateControl, { mode: 'automatic' });
      control = world.get(e, GateControl);
    }
    if (control === undefined) continue;
    let open = control.mode === 'open';
    if (control.mode === 'automatic') {
      open = true;
      if (owner !== undefined) {
        threats ??= new CombatIndex(world, ctx, ctx.terrain);
        const { hx, hy } = nodeOfPosition(world.get(e, Position).x, world.get(e, Position).y);
        open =
          threats.nearest(
            hx,
            hy,
            0,
            GATE_ENEMY_NEAR_POINTS,
            (candidate) => {
              const enemy = ownerOf(world, candidate);
              return (
                enemy !== undefined &&
                enemy !== owner &&
                diplomacyStance(world, enemy, owner) === 'enemy' &&
                (world.has(candidate, Settler) || world.has(candidate, Vehicle)) &&
                (world.tryGet(candidate, Health)?.hitpoints ?? 0) > 0
              );
            },
            owner,
            'hex',
          ) === null;
      }
    }
    if (world.get(e, Palisade).gate?.open !== open) {
      setPalisadeGate(world, ctx, { kind: 'setPalisadeGate', palisade: e, open }, true);
    }
  }
};
