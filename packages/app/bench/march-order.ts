import { halfCellToScreen } from '@open-northland/render';
import {
  adminCommand,
  components,
  type Entity,
  type HalfCellNode,
  nodeOfPosition,
  playerCommand,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { pairFormation } from '../src/view/unit-controls/orders/formation.js';
import { intEnv } from './knobs.js';
import type { Measurement } from './measure.js';
import { summarizeSegment } from './report/index.js';

/**
 * The player's mass order no computer seat issues: one seat's army selected as one group and sent with
 * the attack-move a browser click enqueues (`attackMoveUnitGroup`, slots from `Simulation.formationSlots`)
 * across the map. Headless it is a seat envelope for the army's own seat, so admission narrows it exactly
 * as it narrows the browser's. Members pair to slots through the app's own `pairFormation`, from the
 * centre of the node each stands on rather than its exact feet.
 *
 * `ON_BENCH_MARCH_SPAWN` fighters join the seat's army from `ON_BENCH_MARCH_SPAWN_LEAD` ticks before the
 * order, through the debug panel's `spawnSettler` command, copying the seat's own fighters' class and kit
 * (weapon, armor and worn equipment, all fresh) onto free formation slots round the army's centre.
 *
 * `ON_BENCH_MARCH_COUNT=0` is the control run: no order, the same spawn and phase table.
 */

const { Armor, Building, Equipment, Owner, Position, Settler, PathFollow, PathRoute, Weapon } = components;

const DEFAULT_MARCH_MEMBERS = 300;
/** Ticks after the order counted as the march; the rest of the run is arrival and combat. */
const DEFAULT_MARCH_PHASE_TICKS = 1500;
/** Ticks after the order reported on their own: where the order's follow-up work (lanes, replans) lands. */
const ORDER_WAKE_TICKS = 50;
/** Ticks the spawned fighters stand in the world before the order, so their first plans have run. */
const DEFAULT_SPAWN_LEAD_TICKS = 300;

/** Military rows, as the app spaces a group that holds a fighter. */
const MILITARY_ROW_SPACING = 2;
/** Systems each phase line names, heaviest mean first. */
const PHASE_SYSTEMS = 8;

export interface MarchKnobs {
  /** The absolute tick the order applies on. */
  readonly applyTick: number;
  readonly members: number;
  /** Null picks the seat with the most fighters. */
  readonly seat: number | null;
  /** Null aims at the other seat's headquarters farthest from the army. */
  readonly target: HalfCellNode | null;
  readonly phaseTicks: number;
  /** Fighters added to the seat's army before the order. */
  readonly spawn: number;
  readonly spawnLeadTicks: number;
}

/** `ON_BENCH_MARCH_TICK` and its companions, or null when no march phase was asked for. */
export function marchKnobs(): MarchKnobs | null {
  const applyTick = intEnv('ON_BENCH_MARCH_TICK', 0, 0);
  if (applyTick === 0) return null;
  const seat = intEnv('ON_BENCH_MARCH_SEAT', -1, 0);
  const raw = process.env.ON_BENCH_MARCH_TARGET?.trim() ?? '';
  let target: HalfCellNode | null = null;
  if (raw !== '') {
    const [hx, hy, ...rest] = raw.split(',').map((part) => Number(part.trim()));
    if (
      hx === undefined ||
      hy === undefined ||
      rest.length > 0 ||
      !Number.isInteger(hx) ||
      !Number.isInteger(hy)
    ) {
      throw new Error(`ON_BENCH_MARCH_TARGET must be a half-cell node 'hx,hy', got '${raw}'`);
    }
    target = { hx, hy };
  }
  return {
    applyTick,
    members: intEnv('ON_BENCH_MARCH_COUNT', DEFAULT_MARCH_MEMBERS, 0),
    seat: seat === -1 ? null : seat,
    target,
    phaseTicks: intEnv('ON_BENCH_MARCH_PHASE', DEFAULT_MARCH_PHASE_TICKS, 1),
    spawn: intEnv('ON_BENCH_MARCH_SPAWN', 0, 0),
    spawnLeadTicks: intEnv('ON_BENCH_MARCH_SPAWN_LEAD', DEFAULT_SPAWN_LEAD_TICKS, 1),
  };
}

export function marchKnobRecord(knobs: MarchKnobs | null): Readonly<Record<string, string>> {
  if (knobs === null) return {};
  return {
    ON_BENCH_MARCH_TICK: `${knobs.applyTick}`,
    ON_BENCH_MARCH_COUNT: `${knobs.members}`,
    ON_BENCH_MARCH_SEAT: knobs.seat === null ? '' : `${knobs.seat}`,
    ON_BENCH_MARCH_TARGET: knobs.target === null ? '' : `${knobs.target.hx},${knobs.target.hy}`,
    ON_BENCH_MARCH_PHASE: `${knobs.phaseTicks}`,
    ON_BENCH_MARCH_SPAWN: `${knobs.spawn}`,
    ON_BENCH_MARCH_SPAWN_LEAD: `${knobs.spawnLeadTicks}`,
  };
}

interface Marcher {
  readonly entity: Entity;
  readonly slot: HalfCellNode;
}

function nodeOf(sim: Simulation, e: Entity): HalfCellNode | null {
  const p = sim.world.tryGet(e, Position);
  return p === undefined ? null : nodeOfPosition(p.x, p.y);
}

function fightersBySeat(sim: Simulation): Map<number, Entity[]> {
  const bySeat = new Map<number, Entity[]>();
  for (const e of sim.world.canonicalQuery(Settler, Owner, Position)) {
    if (!systems.isFighterJob(sim.content, sim.world.get(e, Settler).jobType)) continue;
    const seat = sim.world.get(e, Owner).player;
    const list = bySeat.get(seat) ?? [];
    list.push(e);
    bySeat.set(seat, list);
  }
  return bySeat;
}

function centroid(nodes: readonly HalfCellNode[]): HalfCellNode {
  let hx = 0;
  let hy = 0;
  for (const node of nodes) {
    hx += node.hx;
    hy += node.hy;
  }
  return { hx: Math.round(hx / nodes.length), hy: Math.round(hy / nodes.length) };
}

const squaredDistance = (a: HalfCellNode, b: HalfCellNode): number => (a.hx - b.hx) ** 2 + (a.hy - b.hy) ** 2;

/** The headquarters of a seat at war with `seat` farthest from `from`, ties to the lower entity id. */
function farthestEnemyHeadquarters(sim: Simulation, seat: number, from: HalfCellNode): HalfCellNode | null {
  const hqTypes = new Set(
    sim.content.buildings.filter((b) => b.id === systems.HEADQUARTERS_BUILDING_ID).map((b) => b.typeId),
  );
  const enemies = components.enemyPlayerMask(sim.world, seat);
  let best: HalfCellNode | null = null;
  let bestDistance = -1;
  for (const e of sim.world.canonicalQuery(Building, Owner, Position)) {
    if ((enemies & (1 << sim.world.get(e, Owner).player)) === 0) continue;
    if (!hqTypes.has(sim.world.get(e, Building).buildingType)) continue;
    const node = nodeOf(sim, e);
    if (node === null) continue;
    const distance = squaredDistance(node, from);
    if (distance > bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/** The asked seat, or the one with the most fighters, ties to the lower seat. */
function marchSeat(bySeat: ReadonlyMap<number, readonly Entity[]>, asked: number | null): number {
  let seat = asked;
  if (seat === null) {
    let most = -1;
    for (const [candidate, list] of [...bySeat].sort((a, b) => a[0] - b[0])) {
      if (list.length > most) {
        seat = candidate;
        most = list.length;
      }
    }
  }
  if (seat === null || (bySeat.get(seat)?.length ?? 0) === 0) {
    throw new Error('march: no seat has a fighter to order');
  }
  return seat;
}

function armyNodes(sim: Simulation, army: readonly Entity[]): Map<Entity, HalfCellNode> {
  const nodes = new Map<Entity, HalfCellNode>();
  for (const e of army) {
    const node = nodeOf(sim, e);
    if (node !== null) nodes.set(e, node);
  }
  return nodes;
}

/** A worn item as the spawn command takes it: the good alone, so a copy starts unworn. */
const freshItem = (slot: { readonly goodType: number } | null): { goodType: number } | null =>
  slot === null ? null : { goodType: slot.goodType };

/**
 * Enqueues up to `count` fighters for `seat`'s army, on the slots a click at the army's centre would give
 * its original fighters, less the nodes those fighters stand on (the click treats them as movers), so no
 * spawn lands on a building, a resource or a standing settler. Each copies the class, tribe, weapon,
 * armor and worn equipment of those fighters in turn, ascending id. Returns how many it enqueued: the
 * caller repeats it next tick, once these stand in the world, until the count is met.
 */
function spawnFighters(sim: Simulation, army: readonly Entity[], seat: number, count: number): number {
  const nodes = armyNodes(sim, army);
  const centre = centroid([...nodes.values()]);
  const standing = new Set([...nodes.values()].map(({ hx, hy }) => `${hx},${hy}`));
  const groups = sim.formationSlots(centre, army, MILITARY_ROW_SPACING) ?? [];
  const slots = groups
    .flatMap((group) => (group.commandedVehicle === undefined ? group.slots : []))
    .filter(({ hx, hy }) => !standing.has(`${hx},${hy}`));
  const spawned = Math.min(count, slots.length);
  for (let i = 0; i < spawned; i++) {
    const template = army[i % army.length];
    const at = slots[i];
    if (template === undefined || at === undefined) break;
    const { jobType, tribe } = sim.world.get(template, Settler);
    if (jobType === null) throw new Error(`march: fighter ${template} has no job to copy`);
    const weapon = sim.world.tryGet(template, Weapon);
    const armor = sim.world.tryGet(template, Armor);
    const kit = sim.world.tryGet(template, Equipment);
    sim.enqueue(
      adminCommand({
        kind: 'spawnSettler',
        jobType,
        tribe,
        owner: seat,
        x: at.hx,
        y: at.hy,
        ...(weapon === undefined ? {} : { weaponTypeId: weapon.weaponTypeId }),
        ...(armor === undefined ? {} : { armorClass: armor.armorClass }),
        ...(kit === undefined
          ? {}
          : {
              equipment: {
                boots: freshItem(kit.boots),
                tool: freshItem(kit.tool),
                weapon: freshItem(kit.weapon),
                armor: freshItem(kit.armor),
                misc: kit.misc.map(freshItem),
              },
            }),
      }),
    );
  }
  return spawned;
}

/** Selects the army and enqueues the order; returns the members the click sent. */
function issueMarch(
  sim: Simulation,
  knobs: MarchKnobs,
  seat: number,
): { lines: string[]; marchers: Marcher[] } {
  const army = fightersBySeat(sim).get(seat) ?? [];
  // The fighters nearest the army's centre, as a box drawn over the main body would take them.
  const nodes = armyNodes(sim, army);
  const centre = centroid([...nodes.values()]);
  const selected = [...nodes]
    .sort((a, b) => squaredDistance(a[1], centre) - squaredDistance(b[1], centre) || a[0] - b[0])
    .slice(0, knobs.members);
  const selectedCentre = centroid(selected.map(([, node]) => node));
  const target = knobs.target ?? farthestEnemyHeadquarters(sim, seat, selectedCentre);
  if (target === null) throw new Error(`march: seat ${seat} has no enemy headquarters to aim at`);

  // The slot query a click sends the sim worker, outside the tick: timed here since no system meter sees it.
  const slotsStartMs = performance.now();
  const groups =
    sim.formationSlots(
      target,
      selected.map(([e]) => e),
      MILITARY_ROW_SPACING,
    ) ?? [];
  const slotsMs = performance.now() - slotsStartMs;
  const marchers: Marcher[] = [];
  const seatTile = { col: target.hx, row: target.hy };
  for (const group of groups) {
    const units = group.members.flatMap((e) => {
      const node = nodes.get(e);
      return node === undefined ? [] : [{ ref: e, ...halfCellToScreen(node.hx, node.hy) }];
    });
    const slots = group.slots.map(({ hx, hy }) => ({ col: hx, row: hy }));
    for (const order of pairFormation(units, seatTile, slots)) {
      marchers.push({ entity: order.ref as Entity, slot: { hx: order.tile.col, hy: order.tile.row } });
    }
  }
  marchers.sort((a, b) => a.entity - b.entity);
  sim.enqueue(
    playerCommand(seat, {
      kind: 'attackMoveUnitGroup',
      members: marchers.map(({ entity, slot }) => ({ entity, x: slot.hx, y: slot.hy })),
    }),
  );
  const distance = Math.round(Math.sqrt(squaredDistance(selectedCentre, target)));
  return {
    marchers,
    lines: [
      `march: seat ${seat} (${army.length} fighters) sends ${marchers.length} of ${selected.length} selected ` +
        `from node ${selectedCentre.hx},${selectedCentre.hy} to ${target.hx},${target.hy} ` +
        `(${distance} nodes), applying at tick ${knobs.applyTick}; slot query ${slotsMs.toFixed(1)} ms`,
    ],
  };
}

/** Where the marchers stand: alive, still walking, and median distance to their slot. */
function marcherStatus(sim: Simulation, marchers: readonly Marcher[]): string {
  let alive = 0;
  let walking = 0;
  const distances: number[] = [];
  const stopsLeft: number[] = [];
  for (const { entity, slot } of marchers) {
    if (!sim.world.isAlive(entity)) continue;
    alive++;
    const follow = sim.world.tryGet(entity, PathFollow);
    if (follow !== undefined) {
      walking++;
      stopsLeft.push((sim.world.tryGet(entity, PathRoute)?.waypoints.length ?? 0) - follow.index);
    }
    const node = nodeOf(sim, entity);
    if (node !== null) distances.push(Math.sqrt(squaredDistance(node, slot)));
  }
  const median = (values: number[]): number =>
    values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  return (
    `alive ${alive}/${marchers.length}, walking ${walking}, median ${median(distances).toFixed(0)} nodes ` +
    `from slot, ${median(stopsLeft)} route stops left`
  );
}

export interface MarchProbe {
  /** Call after every step, outside the timed interval. */
  readonly afterStep: () => void;
  /** The phase table over a finished measurement. */
  readonly report: (measurement: Measurement) => readonly string[];
}

/** Arms the order for `knobs.applyTick`; `startTick` is where the world stands before any step. */
export function marchProbe(sim: Simulation, knobs: MarchKnobs, startTick: number): MarchProbe {
  if (knobs.applyTick <= startTick) {
    throw new Error(`ON_BENCH_MARCH_TICK ${knobs.applyTick} must be after the start tick ${startTick}`);
  }
  const spawnTick = knobs.applyTick - knobs.spawnLeadTicks;
  if (knobs.spawn > 0 && spawnTick <= startTick) {
    throw new Error(
      `ON_BENCH_MARCH_SPAWN needs the order ${knobs.spawnLeadTicks} ticks after the start tick ${startTick}`,
    );
  }
  const lines: string[] = [];
  let marchers: Marcher[] = [];
  let seat: number | null = null;
  const seatOnce = (): number => {
    seat ??= marchSeat(fightersBySeat(sim), knobs.seat);
    return seat;
  };
  const marchEnd = knobs.applyTick + knobs.phaseTicks;
  let toSpawn = knobs.spawn;
  let originals: readonly Entity[] = [];
  const afterStep = (): void => {
    if (toSpawn > 0 && sim.tick >= spawnTick - 1 && sim.tick < knobs.applyTick - 1) {
      const spawnSeat = seatOnce();
      if (originals.length === 0) {
        originals = fightersBySeat(sim).get(spawnSeat) ?? [];
        const line = `march: seat ${spawnSeat} (${originals.length} fighters) gains ${toSpawn} spawned from tick ${sim.tick + 1}`;
        lines.push(line);
        console.log(line);
      }
      toSpawn -= spawnFighters(sim, originals, spawnSeat, toSpawn);
    }
    if (sim.tick === knobs.applyTick - 1) {
      const orderSeat = seatOnce();
      if (knobs.members === 0) lines.push(`march: control run, no order at tick ${knobs.applyTick}`);
      else {
        const issued = issueMarch(sim, knobs, orderSeat);
        marchers = issued.marchers;
        lines.push(...issued.lines);
      }
      if (toSpawn > 0) lines.push(`march: ${toSpawn} fighters found no slot before the order`);
      for (const line of lines.slice(knobs.spawn > 0 ? 1 : 0)) console.log(line);
    }
    if (marchers.length > 0 && (sim.tick === knobs.applyTick || sim.tick === marchEnd)) {
      const line = `march at tick ${sim.tick}: ${marcherStatus(sim, marchers)}`;
      lines.push(line);
      console.log(line);
    }
  };
  afterStep();

  const report = (measurement: Measurement): readonly string[] => {
    const last = measurement.firstTick + measurement.tickSamples.length - 1;
    if (knobs.applyTick < measurement.firstTick || knobs.applyTick > last) {
      return [`march: order tick ${knobs.applyTick} falls outside the measured ticks`];
    }
    const out = [...lines];
    if (marchers.length > 0) out.push(`march at end (tick ${last}): ${marcherStatus(sim, marchers)}`);
    const phase = (name: string, from: number, to: number): void => {
      const lo = Math.max(from, measurement.firstTick) - measurement.firstTick;
      const hi = Math.min(to, last) - measurement.firstTick + 1;
      if (hi <= lo) return;
      const perSystem = new Map<string, Float64Array>();
      for (const [system, samples] of measurement.perSystem) perSystem.set(system, samples.subarray(lo, hi));
      const { tickMs, systems: rows } = summarizeSegment(perSystem, measurement.tickSamples.subarray(lo, hi));
      const top = rows
        .slice(0, PHASE_SYSTEMS)
        .map((row) => `${row.name} ${row.meanMs.toFixed(2)}`)
        .join(', ');
      out.push(
        `${name} ticks ${lo + measurement.firstTick}..${hi - 1 + measurement.firstTick}: median ` +
          `${tickMs.medianMs.toFixed(2)} p99 ${tickMs.p99Ms.toFixed(2)} max ${tickMs.maxMs.toFixed(2)} ms; ` +
          `mean ms ${top}`,
      );
    };
    phase('before', measurement.firstTick, knobs.applyTick - 1);
    phase('order', knobs.applyTick, knobs.applyTick);
    phase('wake', knobs.applyTick + 1, knobs.applyTick + ORDER_WAKE_TICKS);
    phase('march', knobs.applyTick + 1, marchEnd);
    phase('after', marchEnd + 1, last);
    return out;
  };
  return { afterStep, report };
}
