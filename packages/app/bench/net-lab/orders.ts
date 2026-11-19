/**
 * The orders a lab client issues for its own seat, built the way the HUD builds them: from the seat's
 * entities as the snapshot indexes hold them, checked against the sim's own placement, formation and
 * profession queries first, so every order is one the sim accepts. A kind with nothing to act on yet
 * (no free site, no profession to change to) returns null and is counted as skipped.
 */
import {
  components,
  type Entity,
  nodeHxOfPosition,
  nodeHyOfPosition,
  type PlayerCommand,
  type Simulation,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  isJobLocked,
  isPlayerControllable,
  isWildlife,
  positionOf,
  type SnapshotEntity,
  settlerJobType,
  settlersOwnedBy,
} from '../../src/game/snapshot/base.js';

export interface OrderContext {
  readonly sim: Simulation;
  readonly seat: number;
  /** The seat's view of the world at the tick the order is issued on. */
  readonly snapshot: WorldSnapshot;
  /** Uniform in [0, 1), seeded per client. */
  readonly random: () => number;
}

interface OrderSpec {
  /** Share of the mix before `--mix` overrides it. */
  readonly weight: number;
  readonly build: (context: OrderContext) => PlayerCommand | null;
}

/** The most units one move order selects: a player's typical drag box, not an army. */
const MAX_GROUP = 8;
/** The share of move orders that select the seat's fighters, when it has any. */
const FIGHTER_GROUP_SHARE = 0.5;
/** Formation rows a fighter group keeps between ranks, as the HUD asks for fighters. */
const FIGHTER_ROW_SPACING = 2;
const CIVILIAN_ROW_SPACING = 1;
/** Building types tried per placement order before it is skipped. */
const BUILD_TYPE_ATTEMPTS = 4;
/** How far, in half-cell nodes, a placement searches around the settler it starts from. */
const BUILD_SEARCH_RADIUS = 12;
/** The highest assistant counter value an order sets: a few births or drills, not a flood. */
const MAX_COUNTER_VALUE = 5;
/** Settlers one profession order retrains. */
const MAX_RETRAINED = 3;

function pick<T>(items: readonly T[], random: () => number): T | undefined {
  return items[Math.floor(random() * items.length)];
}

/** The seat's people who stand on the map and take its orders. */
function people(context: OrderContext): SnapshotEntity[] {
  return settlersOwnedBy(context.snapshot, context.seat).filter(
    (entity) => !isWildlife(entity) && isPlayerControllable(entity) && positionOf(entity) !== undefined,
  );
}

function nodeOf(entity: SnapshotEntity): { readonly hx: number; readonly hy: number } | null {
  const position = positionOf(entity);
  if (position === undefined) return null;
  return { hx: nodeHxOfPosition(position.x, position.y), hy: nodeHyOfPosition(position.x, position.y) };
}

/** A contiguous run of up to `MAX_GROUP` of the seat's settlers, or its fighters when the coin says so
 *  and it has some, walked in formation to where another of its people stands. */
function moveOrder(context: OrderContext): PlayerCommand | null {
  const crowd = people(context);
  const { content } = context.sim;
  const fighters = crowd.filter((entity) => systems.isFighterJob(content, settlerJobType(entity) ?? null));
  const military = fighters.length > 0 && context.random() < FIGHTER_GROUP_SHARE;
  const pool = military ? fighters : crowd;
  if (pool.length === 0 || crowd.length < 2) return null;
  const size = 1 + Math.floor(context.random() * Math.min(MAX_GROUP, pool.length));
  const start = Math.floor(context.random() * (pool.length - size + 1));
  const group = pool.slice(start, start + size);
  const ids = new Set(group.map((entity) => entity.id));
  const anchor = pick(
    crowd.filter((entity) => !ids.has(entity.id)),
    context.random,
  );
  const target = anchor === undefined ? null : nodeOf(anchor);
  if (target === null) return null;
  const members = group.map((entity) => entity.id as Entity);
  const slots = context.sim.formationSlots(
    target,
    members,
    military ? FIGHTER_ROW_SPACING : CIVILIAN_ROW_SPACING,
  );
  if (slots === null) return null;
  const destinations = slots.flatMap((slotGroup) =>
    slotGroup.members.flatMap((entity, i) => {
      const slot = slotGroup.slots[i];
      return slot === undefined ? [] : [{ entity, x: slot.hx, y: slot.hy }];
    }),
  );
  return destinations.length === 0 ? null : { kind: 'moveUnitGroup', members: destinations };
}

/** A construction site of a type the seat may build, on the first free anchor around one of its people. */
function buildOrder(context: OrderContext): PlayerCommand | null {
  const { sim, seat, random } = context;
  const tribe = sim.buildTribes(seat)[0];
  const anchor = pick(people(context), random);
  const centre = anchor === undefined ? null : nodeOf(anchor);
  if (tribe === undefined || centre === null) return null;
  const types = sim.content.buildings.filter((type) => {
    if (type.construction.length === 0 || type.kind === 'wonder') return false;
    const status = sim.unlockStatus('house', type.typeId, tribe, seat);
    return status.allowed && status.enabled;
  });
  for (let attempt = 0; attempt < BUILD_TYPE_ATTEMPTS; attempt++) {
    const type = pick(types, random);
    const probe = type === undefined ? null : sim.placementProbe(type.typeId, { player: seat, tribe });
    if (type === undefined || probe === null) continue;
    for (let radius = 1; radius <= BUILD_SEARCH_RADIUS; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = centre.hx + dx;
          const y = centre.hy + dy;
          if (!probe.canPlace(x, y)) continue;
          return {
            kind: 'placeBuilding',
            buildingType: type.typeId,
            x,
            y,
            tribe,
            owner: seat,
            underConstruction: true,
          };
        }
      }
    }
  }
  return null;
}

function assistantOrder(context: OrderContext): PlayerCommand | null {
  const counter = pick(components.ASSISTANT_COUNTER_KINDS, context.random);
  if (counter === undefined) return null;
  return {
    kind: 'setAssistantCounter',
    player: context.seat,
    counter,
    value: Math.floor(context.random() * (MAX_COUNTER_VALUE + 1)),
    infinite: false,
  };
}

/** Retrain up to `MAX_RETRAINED` settlers to one profession the first of them may take. */
function jobOrder(context: OrderContext): PlayerCommand | null {
  const { sim, random } = context;
  const crowd = people(context).filter((entity) => !isJobLocked(entity));
  const first = pick(crowd, random);
  if (first === undefined) return null;
  const current = settlerJobType(first);
  const choices = sim.content.jobs.filter(
    (job) => job.typeId !== current && sim.canChooseJob(first.id as Entity, job.typeId),
  );
  const job = pick(choices, random);
  if (job === undefined) return null;
  const members = [first, ...crowd.filter((entity) => entity.id !== first.id)]
    .filter((entity) => sim.canChooseJob(entity.id as Entity, job.typeId))
    .slice(0, MAX_RETRAINED)
    .map((entity) => ({ entity: entity.id as Entity }));
  return { kind: 'unitActionGroup', members, action: { kind: 'setJob', jobType: job.typeId } };
}

/** The order mix. A new kind is one row here; `--mix` names it by its key. */
export const ORDER_TABLE = {
  move: { weight: 5, build: moveOrder },
  build: { weight: 1, build: buildOrder },
  assistant: { weight: 2, build: assistantOrder },
  job: { weight: 2, build: jobOrder },
} as const satisfies Record<string, OrderSpec>;

export type OrderKind = keyof typeof ORDER_TABLE;
export const ORDER_KINDS = Object.keys(ORDER_TABLE) as OrderKind[];
export const DEFAULT_ORDER_WEIGHTS = Object.fromEntries(
  ORDER_KINDS.map((kind) => [kind, ORDER_TABLE[kind].weight]),
) as Readonly<Record<OrderKind, number>>;

/** The kind `random` draws under `weights`. */
export function drawOrderKind(weights: Readonly<Record<OrderKind, number>>, random: () => number): OrderKind {
  const total = ORDER_KINDS.reduce((sum, kind) => sum + weights[kind], 0);
  let roll = random() * total;
  for (const kind of ORDER_KINDS) {
    roll -= weights[kind];
    if (roll < 0) return kind;
  }
  return ORDER_KINDS.at(-1) ?? 'move';
}

export function buildOrderOf(kind: OrderKind, context: OrderContext): PlayerCommand | null {
  return ORDER_TABLE[kind].build(context);
}
