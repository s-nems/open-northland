import {
  type Command,
  cellAnchorNode,
  components,
  type Entity,
  fx,
  type ResourceNodeSpec,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../../../catalog/felling.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../rules.js';
import { GATHERERS, type GathererSpec } from '../ids/index.js';
import { gatherMasteryExperience } from './mastery.js';

const { DeliveryFlag, Position, WorkFlag } = components;

/** Work radius in node-distance, a named approximation: the original's collector work-area size is
 *  unknown. */
export const GATHERER_WORK_RADIUS = components.DEFAULT_WORK_FLAG_RADIUS;

/** Turns the app's felling and deposit balance into a node spec; `x`/`y` are half-cell node coords. */
export function resourceSpecFor(g: GathererSpec, x: number, y: number): ResourceNodeSpec {
  switch (g.mode) {
    case 'fell':
      // Wood is the only felled good, so its yield and chops-to-fell stay catalog constants rather
      // than GathererSpec fields.
      return {
        good: g.good,
        x,
        y,
        remaining: WOOD_YIELD_PER_NODE,
        harvestAtomic: g.atomic,
        felling: { chopsLeft: WOOD_CHOPS_TO_FELL },
      };
    case 'mine': {
      const units = g.depositUnits ?? 0;
      if (units <= 0) throw new Error(`resourceSpecFor: '${g.id}' needs positive depositUnits`);
      const strikesPerUnit = g.strikesPerUnit ?? 0;
      if (strikesPerUnit <= 0) throw new Error(`resourceSpecFor: '${g.id}' needs positive strikesPerUnit`);
      return {
        good: g.good,
        x,
        y,
        remaining: units,
        harvestAtomic: g.atomic,
        deposit: { levels: g.depositLevels ?? 0, strikesPerUnit },
      };
    }
    case 'pick':
      return { good: g.good, x, y, remaining: 1, harvestAtomic: g.atomic };
  }
}

/** Direct scene assembly, valid pre-tick-0 only. A missing footprint throws here and is skipped by the
 *  runtime command. */
function placeResourceDirect(sim: Simulation, spec: ResourceNodeSpec, what: string): void {
  if (systems.createResourceNode(sim.world, sim.content, spec) === null) {
    throw new Error(`${what}: missing resource footprint for good ${spec.good}`);
  }
}

/**
 * Direct scene assembly, valid pre-tick-0 only. `x`/`y` are whole tiles and become the anchor node.
 * `unitsScale` multiplies the node's yield, and the visual shrink ladder scales with it.
 */
export function placeResourceNode(
  sim: Simulation,
  g: GathererSpec,
  x: number,
  y: number,
  opts: { readonly unitsScale?: number } = {},
): void {
  const node = cellAnchorNode(x, y);
  const spec = resourceSpecFor(g, node.hx, node.hy);
  const scale = opts.unitsScale ?? 1;
  placeResourceDirect(
    sim,
    scale === 1 ? spec : { ...spec, remaining: spec.remaining * scale },
    `placeResourceNode(${g.id})`,
  );
}

/** The `[GfxLandscape]` record index of "bush 01 fruits" (decoded `landscapes.cif`, logicType 11). */
export const BUSH_FRUITS_GFX = 806;

/**
 * Direct scene assembly, valid pre-tick-0 only. `x`/`y` are whole tiles and become the anchor node.
 * `gfxIndex` is a render-variant tag, inert headless. The bush spawns ripe.
 */
export function placeSandboxBerryBush(
  sim: Simulation,
  x: number,
  y: number,
  gfxIndex: number = BUSH_FRUITS_GFX,
): Entity {
  const node = cellAnchorNode(x, y);
  return systems.createBerryBush(sim.world, { x: node.hx, y: node.hy, gfxIndex });
}

/**
 * The runtime spawn path: the node is created through the mutation seam on the next tick, so a mid-run
 * placement stays replay-faithful. `x`/`y` are half-cell node coords. Null when the good has no
 * gatherer spec.
 */
export function resourceCommand(good: number, x: number, y: number): Command | null {
  const g = GATHERERS.find((gg) => gg.good === good);
  if (g === undefined) return null;
  return { kind: 'placeResource', ...resourceSpecFor(g, x, y) };
}

/** `x`/`y` are whole tiles and become the anchor node the command speaks in. */
export function dropSandboxGood(sim: Simulation, good: number, x: number, y: number, amount: number): void {
  const node = cellAnchorNode(x, y);
  sim.enqueueSetup({ kind: 'dropGood', good, x: node.hx, y: node.hy, amount });
}

/** A pure marker that stores nothing: the harvest piles around it as separate heaps, so moving the flag
 *  never moves the goods. */
export function placeFlag(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, DeliveryFlag, {});
  return e;
}

/**
 * Direct scene assembly, valid pre-tick-0 only: `WorkFlag` must reference the flag entity, and a
 * command-spawned settler has no known id until its command runs. `goodType` pins the gatherer to one
 * resource so neighbouring camps never poach each other's nodes.
 */
export function spawnBoundGatherer(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  flag: Entity,
  opts: { readonly radius?: number; readonly owner?: number; readonly goodType?: number } = {},
): Entity {
  const node = cellAnchorNode(x, y);
  const mastery = gatherMasteryExperience(sim);
  const e = systems.createSettler(sim.world, sim.content, sim.rng, {
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner: opts.owner ?? HUMAN_PLAYER,
    // A camp gatherer spawns a veteran: a fresh collector pinned to iron or gold would fail real
    // content's `needforgood` gate forever and stand beside its deposit.
    ...(mastery.length > 0 ? { experience: mastery } : {}),
  });
  if (e === null) throw new Error(`spawnBoundGatherer: unknown job ${jobType}`);
  sim.world.add(e, WorkFlag, {
    flag,
    radius: opts.radius ?? GATHERER_WORK_RADIUS,
    ...(opts.goodType !== undefined ? { goodType: opts.goodType } : {}),
  });
  return e;
}
