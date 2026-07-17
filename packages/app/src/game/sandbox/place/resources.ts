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

/**
 * A gatherer's reasonable work radius around its flag (integer node-distance). Sourced from the sim's
 * {@link components.DEFAULT_WORK_FLAG_RADIUS} so a scene-bound flag and a `setWorkFlag`-placed flag share
 * one value — a named approximation (the original's collector work-area size is not decoded), and since each
 * gatherable good is unique per lane the job-atomic gate keeps a radius overlap from ever crossing trades.
 */
export const GATHERER_WORK_RADIUS = components.DEFAULT_WORK_FLAG_RADIUS;

/**
 * Resolve a gatherer's resource-node {@link ResourceNodeSpec} at a half-cell node (`x`/`y` are node
 * coords, like every sim command) — the one place the app's felling/deposit balance constants become a
 * node's starting yield + harvest lifecycle marker. Shared by the pre-tick-0 direct helper (which
 * converts its scene tile to a node first) and the runtime {@link resourceCommand} (whose caller already
 * holds node coords), so a scene-placed tree and a debug-spawned tree are the same node. A `fell` good is
 * a chop-it-down tree, a `mine` good a finite deposit, a `pick` good a pluck-whole node.
 * Exported for the decoded-map spawner ({@link import('../map-spawn.js')}), which resolves the same node
 * spec for a map's placed objects.
 */
export function resourceSpecFor(g: GathererSpec, x: number, y: number): ResourceNodeSpec {
  switch (g.mode) {
    case 'fell':
      // Wood is the only felled good; its per-node yield + chops-to-fell are catalog constants (not
      // carried on the GathererSpec), so the fell branch reads them directly.
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

/** Create a resource node directly (scene setup, pre-tick-0). Throws on a good with no footprint —
 *  a scene setup bug, not recoverable — unlike the runtime command which skips it. */
function placeResourceDirect(sim: Simulation, spec: ResourceNodeSpec, what: string): void {
  if (systems.createResourceNode(sim.world, sim.content, spec) === null) {
    throw new Error(`${what}: missing resource footprint for good ${spec.good}`);
  }
}

/**
 * Place a gatherer's resource node directly (scene setup, pre-tick-0) — a felled tree, a mined deposit,
 * or a pluck-whole node, chosen from the gatherer's own {@link GathererSpec.mode} by `resourceSpecFor`
 * (so the caller doesn't re-dispatch on the mode). Scenes author in whole tiles (`x`/`y`), so the tile is
 * converted to its anchor node before assembly — the same tile→node seam `spawnSandboxSettler` uses.
 * Throws on a good with no footprint (a scene-setup bug), unlike the runtime {@link resourceCommand}.
 * `unitsScale` multiplies the node's yield (a testing scene sizing a deposit to outlast a long session);
 * the visual shrink ladder scales with it (a deposit's `initial` is its starting `remaining`).
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

/** The `[GfxLandscape]` record index of "bush 01 fruits" (decoded `landscapes.cif`, logicType 11 =
 *  `bush with fruits`) — the default fruited-bush look every berry scene shares. */
export const BUSH_FRUITS_GFX = 806;

/**
 * Place a wild berry bush directly (scene setup, pre-tick-0) and return it — the bush twin of
 * {@link placeResourceNode}. Scenes author in whole tiles (`x`/`y`); the tile is converted to its anchor
 * node before assembly. `gfxIndex` is the render-variant tag (a real `[GfxLandscape]` index, defaulting to
 * {@link BUSH_FRUITS_GFX}, so the browser scene draws real bush art through the
 * {@link buildBerryBushBinding} join); it is inert in the headless test (no render). The bush spawns ripe —
 * a caller wanting a bare/regrowing bush mutates the returned entity's {@link components.BerryBush}
 * directly (still pre-tick-0 authored state).
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
 * Build a `placeResource` command for a good at a half-cell node — the runtime spawn path (the
 * admin/debug palette, a future scenario editor): the node is created through the mutation seam on the
 * next tick, so a mid-run placement stays replay-faithful (unlike the direct helper, sound only before
 * tick 0). `x`/`y` are node coords, the space the UI's `clientToTile` already resolves to. Returns null
 * for a good with no gatherer spec (not a spawnable resource).
 */
export function resourceCommand(good: number, x: number, y: number): Command | null {
  const g = GATHERERS.find((gg) => gg.good === good);
  if (g === undefined) return null;
  return { kind: 'placeResource', ...resourceSpecFor(g, x, y) };
}

/**
 * Drop a loose good pile on the ground via the `dropGood` command (the runtime mutation seam, so a
 * scene-authored drop and a player-tool drop are the same replay-faithful path). Scenes author in whole
 * tiles; the command speaks half-cell nodes. The pile is the felled-trunk shape (Stockpile + GroundDrop),
 * so with no carriers on the map it simply sits where it lands.
 */
export function dropSandboxGood(sim: Simulation, good: number, x: number, y: number, amount: number): void {
  const node = cellAnchorNode(x, y);
  sim.enqueue({ kind: 'dropGood', good, x: node.hx, y: node.hy, amount });
}

/** A drop-off flag: a pure {@link DeliveryFlag} marker at the given tile (it stores nothing — the harvest
 *  piles on the ground around it as separate heaps, so moving the flag never moves the goods). Returns the
 *  flag entity so a gatherer can be bound to it ({@link spawnBoundGatherer}). */
export function placeFlag(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, DeliveryFlag, {}); // a designated collection point → render draws its flag above the heaps
  return e;
}

/**
 * Spawn a gatherer bound to its own `flag` directly (scene setup, pre-tick-0) and return it. A bound
 * gatherer must be assembled directly — via {@link systems.createSettler}, the settler twin of the
 * `placeResourceNode` helper — rather than through the `spawnSettler` command, because its {@link WorkFlag}
 * has to reference the flag entity, and a command-spawned settler's id is not known until the command runs.
 * With the binding it harvests only within `radius` of the flag, carries only what it dug, and banks it at
 * the flag. An optional `goodType` pins the gatherer to one resource (the same filter the `setGatherGood`
 * command sets), so neighbouring camps of different goods never poach each other's nodes. Throws on an
 * unknown job (a scene-setup bug, like {@link placeResourceNode}).
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
    // A camp gatherer spawns a veteran (see gatherMasteryExperience) — a fresh collector pinned to
    // iron/gold would fail real content's `needforgood` gate forever and stand beside its deposit.
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
