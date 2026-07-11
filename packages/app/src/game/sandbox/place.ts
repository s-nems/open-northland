import type { TerrainObjects } from '@vinland/data';
import {
  type Command,
  cellAnchorNode,
  components,
  type Entity,
  fx,
  type ResourceNodeSpec,
  type SettlerEquipment,
  type Simulation,
  systems,
} from '@vinland/sim';
import { resolveVikingBuilding } from '../../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../../catalog/felling.js';
import type { ContentIr } from '../../content/ir.js';
import {
  mapBerryBushSpawns,
  mapResourceSpawns,
  simResourceObjectNames,
} from '../../content/map-resources.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../rules.js';
import { GATHERERS, type GathererSpec, JOB_IDLE, weaponEquipmentFor } from './ids.js';

/** The goods a real gatherer trade exists for — the {@link GATHERERS} ids. A decoded-map object whose good
 *  is outside this set (a harvestable the app has no collector for yet) stays render-only decor. */
const SPAWNABLE_GOOD_IDS: ReadonlySet<string> = new Set(GATHERERS.map((g) => g.id));

/** A `goodId` string → its {@link GathererSpec} (the map-resource join returns pipeline goodId strings, the
 *  bridge across the IR's original good numbering and the app's clean-room ids). */
const GATHERER_BY_GOOD_ID: ReadonlyMap<string, GathererSpec> = new Map(GATHERERS.map((g) => [g.id, g]));

const { DeliveryFlag, Position, WorkFlag } = components;

/**
 * A gatherer's reasonable work radius around its flag (integer node-distance). Sourced from the sim's
 * {@link components.DEFAULT_WORK_FLAG_RADIUS} so a scene-bound flag and a `setWorkFlag`-placed flag share
 * one value — a named approximation (the original's collector work-area size is not decoded), and since each
 * gatherable good is unique per lane the job-atomic gate keeps a radius overlap from ever crossing trades.
 */
export const GATHERER_WORK_RADIUS = components.DEFAULT_WORK_FLAG_RADIUS;

/**
 * The sandbox world-population helpers scenes and the vertical slice share. Buildings, settlers and
 * resource nodes all go through the ONE command seam at RUNTIME (`placeBuilding` / `spawnSettler` /
 * `placeResource`) — the admin/debug palette and a future scenario editor spawn through them so a mid-run
 * placement stays replay-faithful. The `place*` helpers below instead build a node DIRECTLY (the
 * sanctioned `sim.world` exception): they run as scene SETUP, before tick 0, where the command log is
 * empty and determinism is unaffected — the same "authored fixture state" stance as a decoded map's
 * `sethouse`/landscape records. Do not copy the direct-store pattern into render glue or a mid-run path
 * (packages/app/AGENTS.md, one-way flow) — use {@link resourceCommand} there instead.
 */

/**
 * Place a viking building (by typeId or catalog id), fully built, via the `placeBuilding` command.
 * FORCED: scene setup is authored fixture state (like a decoded map's `sethouse` records), so it
 * loads as-is — the tech/collision gates govern the PLAYER's interactive placements, not the fixture
 * a scene is defined to start from (a scene author placing two huts adjacently means it).
 */
export function placeSandboxBuilding(
  sim: Simulation,
  ref: number | string,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
  opts: { readonly underConstruction?: boolean } = {},
): void {
  // Scenes author in whole tiles; the command seam speaks half-cell nodes.
  const node = cellAnchorNode(x, y);
  sim.enqueue({
    kind: 'placeBuilding',
    buildingType: resolveVikingBuilding(ref).typeId,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner,
    force: true,
    // A construction site starts as a grey foundation a builder raises (default: fully built).
    ...(opts.underConstruction ? { underConstruction: true } : {}),
  });
}

/** Spawn a settler with the given job via the `spawnSettler` command. */
export function spawnSandboxSettler(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
  opts: {
    readonly hitpoints?: number;
    readonly weaponTypeId?: number;
    readonly equipment?: SettlerEquipment;
  } = {},
): void {
  const node = cellAnchorNode(x, y);
  // A warrior with no explicit loadout still gets its class weapon in the equipment slot (so its Broń
  // row + drawn weapon match), derived from the job; an explicit `equipment` wins untouched.
  const equipment = opts.equipment ?? weaponEquipmentFor(jobType);
  sim.enqueue({
    kind: 'spawnSettler',
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner,
    ...(opts.hitpoints !== undefined ? { hitpoints: opts.hitpoints } : {}),
    ...(opts.weaponTypeId !== undefined ? { weaponTypeId: opts.weaponTypeId } : {}),
    ...(equipment !== undefined ? { equipment } : {}),
  });
}

/**
 * Spawn an UNEMPLOYED settler (jobType null) DIRECTLY (scene setup, pre-tick-0) and return it. Unlike
 * {@link spawnSandboxSettler} (which spawns a settler already doing a named job), an idle settler is the
 * one the JobSystem's SECOND pass employs — it binds an idle settler to the first canonical building with an
 * open worker slot (lowest job id first). This is how a passive store's carrier slots get staffed: a
 * warehouse/HQ is NOT adopted by a settler standing at its door (adopt only pins recipe workshops + farms),
 * so its haulers arrive as idle settlers the JobSystem assigns. Built via {@link systems.createSettler} then
 * re-idled, because the `spawnSettler` command has no null-job form.
 */
export function spawnIdleSettler(
  sim: Simulation,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createSettler(sim.world, sim.content, {
    jobType: JOB_IDLE,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner,
  });
  if (e === null) throw new Error('spawnIdleSettler: createSettler failed');
  sim.world.get(e, components.Settler).jobType = null; // re-idle so the JobSystem's assign pass employs it
  return e;
}

/**
 * Resolve a gatherer's resource-node {@link ResourceNodeSpec} at a HALF-CELL NODE (`x`/`y` are node
 * coords, like every sim command) — the ONE place the app's felling/deposit balance constants become a
 * node's starting yield + harvest lifecycle marker. Shared by the pre-tick-0 direct helper (which
 * converts its scene tile to a node first) and the runtime {@link resourceCommand} (whose caller already
 * holds node coords), so a scene-placed tree and a debug-spawned tree are the same node. A `fell` good is
 * a chop-it-down tree, a `mine` good a finite deposit, a `pick` good a pluck-whole node.
 */
function resourceSpecFor(g: GathererSpec, x: number, y: number): ResourceNodeSpec {
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
      return {
        good: g.good,
        x,
        y,
        remaining: units,
        harvestAtomic: g.atomic,
        deposit: { levels: g.depositLevels ?? 0 },
      };
    }
    case 'pick':
      return { good: g.good, x, y, remaining: 1, harvestAtomic: g.atomic };
  }
}

/** Create a resource node DIRECTLY (scene setup, pre-tick-0). Throws on a good with no footprint —
 *  a scene setup bug, not recoverable — unlike the runtime command which skips it. */
function placeResourceDirect(sim: Simulation, spec: ResourceNodeSpec, what: string): void {
  if (systems.createResourceNode(sim.world, sim.content, spec) === null) {
    throw new Error(`${what}: missing resource footprint for good ${spec.good}`);
  }
}

/**
 * The object EditNames this app spawns as sim resources — the set the STATIC collision join must skip
 * ({@link import('../../content/collision.js').buildCollisionTerrain} `skipObjectNames`), so a felled
 * node's blocking vanishes with its dynamic footprint instead of being baked into the grid forever.
 */
export function mapResourceObjectNames(ir: ContentIr): ReadonlySet<string> {
  return simResourceObjectNames(ir, SPAWNABLE_GOOD_IDS);
}

/** What {@link spawnMapResources} made: the node count plus each spawned ENTITY's placement ordinal in
 *  `objects.placements` — the join back to the static layer's drawn sprite for the same placement, so the
 *  `?map=` entry can hand a first-worked node from the built-once static layer to the live sprite pool. */
export interface MapResourceSpawnResult {
  readonly spawned: number;
  readonly placementByEntity: ReadonlyMap<Entity, number>;
}

/**
 * Spawn every harvestable resource node a decoded map's placed objects define (trees → wood, ore outcrops →
 * iron/gold, clay/stone → mud/stone) as real `Resource` sim nodes — the SAME component set the admin
 * `placeResource` builds (Position + Resource + footprint + Felling|MineDeposit), assembled DIRECTLY here as
 * scene setup pre-tick-0 (the sanctioned exception, like {@link placeResourceNode}). This is what makes a
 * map's own trees hoverable + gatherable (plan `gathering-economy.md` step 6); before it, only an
 * admin-spawned node was ever a real sim entity.
 *
 * The nodes are created in the map's native placement order, so ids are minted deterministically. Yields
 * and fell/mine parameters reuse the gatherer catalog defaults (`resourceSpecFor`) — the map's per-placement
 * growth `levels` lane is not yet mapped to a starting amount (a named approximation, same defaults an
 * admin-spawned node uses). Each spawn carries its placement's OWN harvest-stage `gfxIndex` (the species
 * variant), so a node the sprite pool draws (a worked/handed-over one) keeps the exact original graphic. A
 * placement whose good has no gatherer trade or whose good has no footprint is skipped, not fatal (unlike
 * the throwing scene helper).
 */
export function spawnMapResources(
  sim: Simulation,
  objects: TerrainObjects,
  ir: ContentIr,
): MapResourceSpawnResult {
  let spawned = 0;
  let unspawnable = 0;
  const placementByEntity = new Map<Entity, number>();
  for (const { goodId, gfxIndex, hx, hy, placement } of mapResourceSpawns(objects, ir, SPAWNABLE_GOOD_IDS)) {
    const g = GATHERER_BY_GOOD_ID.get(goodId);
    if (g === undefined) continue; // filtered by SPAWNABLE_GOOD_IDS already, but keep the type honest
    const spec = { ...resourceSpecFor(g, hx, hy), gfxIndex };
    const e = systems.createResourceNode(sim.world, sim.content, spec);
    if (e !== null) {
      spawned++;
      placementByEntity.set(e, placement);
    } else {
      unspawnable++;
    }
  }
  if (unspawnable > 0) {
    // A latent collision hole: these placements were SKIPPED from the static collision bake
    // (mapResourceObjectNames) on the promise of a dynamic footprint that never materialised (the
    // good has no footprint record in the sim content) — a drawn object settlers walk through.
    console.warn(
      `spawnMapResources: ${unspawnable} harvestable placements failed to spawn (no sim-content footprint) — they block nothing`,
    );
  }
  return { spawned, placementByEntity };
}

/**
 * Spawn every forageable berry bush a decoded map's placed objects define (fruited-bush objects →
 * ripe {@link components.BerryBush} entities), assembled DIRECTLY here as pre-tick-0 scene setup (the
 * sanctioned exception, like {@link spawnMapResources}). This is what makes a map's own bushes actual
 * wild food a hungry settler forages; before it, "bush NN fruits" was pure render decor.
 *
 * Bushes carry no footprint (walkable in the original), so — unlike {@link spawnMapResources} — nothing
 * is skipped from the static collision bake; the placement join is purely for the render handover (the
 * static layer keeps drawing the fruited bush until it is first foraged). Created in native placement
 * order, so ids mint deterministically. Each carries its placement's fruited-bush `gfxIndex`.
 */
export function spawnMapBerryBushes(
  sim: Simulation,
  objects: TerrainObjects,
  ir: ContentIr,
): MapResourceSpawnResult {
  let spawned = 0;
  const placementByEntity = new Map<Entity, number>();
  for (const { gfxIndex, hx, hy, placement } of mapBerryBushSpawns(objects, ir)) {
    const e = systems.createBerryBush(sim.world, { x: hx, y: hy, gfxIndex });
    placementByEntity.set(e, placement);
    spawned++;
  }
  return { spawned, placementByEntity };
}

/**
 * Place a gatherer's resource node DIRECTLY (scene setup, pre-tick-0) — a felled tree, a mined deposit,
 * or a pluck-whole node, chosen from the gatherer's own {@link GathererSpec.mode} by `resourceSpecFor`
 * (so the caller doesn't re-dispatch on the mode). Scenes author in whole TILES (`x`/`y`), so the tile is
 * converted to its anchor node before assembly — the same tile→node seam `spawnSandboxSettler` uses.
 * Throws on a good with no footprint (a scene-setup bug), unlike the runtime {@link resourceCommand}.
 */
export function placeResourceNode(sim: Simulation, g: GathererSpec, x: number, y: number): void {
  const node = cellAnchorNode(x, y);
  placeResourceDirect(sim, resourceSpecFor(g, node.hx, node.hy), `placeResourceNode(${g.id})`);
}

/**
 * Place a wild berry bush DIRECTLY (scene setup, pre-tick-0) and return it — the bush twin of
 * {@link placeResourceNode}. Scenes author in whole TILES (`x`/`y`); the tile is converted to its anchor
 * node before assembly. `gfxIndex` is the render-variant tag (a real fruited-bush `[GfxLandscape]` index,
 * so the browser scene draws real bush art through the {@link buildBerryBushBinding} join); it is inert in
 * the headless test (no render). The bush spawns RIPE — a caller wanting a bare/regrowing bush mutates the
 * returned entity's {@link components.BerryBush} directly (still pre-tick-0 authored state).
 */
export function placeSandboxBerryBush(sim: Simulation, x: number, y: number, gfxIndex?: number): Entity {
  const node = cellAnchorNode(x, y);
  return systems.createBerryBush(sim.world, {
    x: node.hx,
    y: node.hy,
    ...(gfxIndex !== undefined ? { gfxIndex } : {}),
  });
}

/**
 * Build a `placeResource` command for a good at a HALF-CELL NODE — the RUNTIME spawn path (the
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
 * TILES; the command speaks half-cell nodes. The pile is the felled-trunk shape (Stockpile + GroundDrop),
 * so with no carriers on the map it simply sits where it lands.
 */
export function dropSandboxGood(sim: Simulation, good: number, x: number, y: number, amount: number): void {
  const node = cellAnchorNode(x, y);
  sim.enqueue({ kind: 'dropGood', good, x: node.hx, y: node.hy, amount });
}

/** A drop-off flag: a pure {@link DeliveryFlag} marker at the given tile (it stores nothing — the harvest
 *  piles on the GROUND around it as separate heaps, so moving the flag never moves the goods). Returns the
 *  flag entity so a gatherer can be bound to it ({@link spawnBoundGatherer}). */
export function placeFlag(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, DeliveryFlag, {}); // a designated collection point → render draws its flag above the heaps
  return e;
}

/**
 * Spawn a gatherer bound to its own `flag` DIRECTLY (scene setup, pre-tick-0) and return it. A bound
 * gatherer must be assembled directly — via {@link systems.createSettler}, the settler twin of the
 * `placeResourceNode` helper — rather than through the `spawnSettler` command, because its {@link WorkFlag}
 * has to reference the flag entity, and a command-spawned settler's id is not known until the command runs.
 * With the binding it harvests only within `radius` of the flag, carries only what it dug, and banks it at
 * the flag. Throws on an unknown job (a scene-setup bug, like {@link placeResourceNode}).
 */
export function spawnBoundGatherer(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  flag: Entity,
  radius: number = GATHERER_WORK_RADIUS,
  owner: number = HUMAN_PLAYER,
): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createSettler(sim.world, sim.content, {
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner,
  });
  if (e === null) throw new Error(`spawnBoundGatherer: unknown job ${jobType}`);
  sim.world.add(e, WorkFlag, { flag, radius });
  return e;
}
