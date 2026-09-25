import type { BuildingFootprint, FootprintCell } from '@open-northland/data';
import {
  Health,
  Palisade,
  PalisadeBlocking,
  Position,
  Stockpile,
  stampOwner,
  UnderConstruction,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { ScriptLandscapeType, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { translatedCells } from '../footprint/geometry.js';
import { placementBlockerGrid } from '../footprint/placement/blocker-grid.js';
import { canPlacePalisadeAnchor, type PlacementProbe } from '../footprint/placement/index.js';

function wallFootprint(type: ScriptLandscapeType, body: readonly FootprintCell[]): BuildingFootprint {
  const reservedByKey = new Map<string, FootprintCell>();
  for (const cell of type.build) reservedByKey.set(`${cell.dx},${cell.dy}`, cell);
  if (reservedByKey.size === 0) reservedByKey.set('0,0', { dx: 0, dy: 0 });
  return {
    blocked: body.map((cell) => ({ ...cell })),
    familyBody: body.map((cell) => ({ ...cell })),
    reserved: [...reservedByKey.values()].map((cell) => ({ ...cell })),
  };
}

export function palisadeType(terrain: TerrainGraph, gfxIndex: number): ScriptLandscapeType | undefined {
  const type = terrain.landscapes?.types.find((candidate) => candidate.typeId === gfxIndex);
  return type?.wall === undefined ? undefined : type;
}

function placementWalkOf(terrain: TerrainGraph, type: ScriptLandscapeType): readonly FootprintCell[] {
  const gate = type.wall?.gate;
  if (gate?.open !== true) return type.walk;
  const closed = palisadeType(terrain, gate.counterpartGfxIndex);
  return closed?.wall?.gate?.open === false ? closed.walk : type.walk;
}

/** A reusable placement query shared by the UI ghost and command application. */
export function palisadePlacementProbe(
  world: World,
  content: SystemContext['content'],
  terrain: TerrainGraph,
  gfxIndex: number,
): PlacementProbe | null {
  const type = palisadeType(terrain, gfxIndex);
  if (type === undefined) return null;
  const footprint = wallFootprint(type, placementWalkOf(terrain, type));
  const grid = placementBlockerGrid(world, content, terrain);
  return { canPlace: (x, y) => canPlacePalisadeAnchor(grid, footprint, x, y) };
}

/** Assemble a wall segment from one validated map-catalog row. Used by the command and authored map boot. */
export function createPalisade(
  world: World,
  type: ScriptLandscapeType,
  spec: {
    readonly x: number;
    readonly y: number;
    readonly tribe: number;
    readonly owner?: number;
    readonly underConstruction: boolean;
    readonly valency?: number;
    readonly placementWalk?: readonly FootprintCell[];
  },
): Entity | null {
  const wall = type.wall;
  if (wall === undefined || wall.maxHitpoints <= 0 || wall.repairPerStrike <= 0) return null;
  const hitpoints = spec.underConstruction
    ? 1
    : Math.min(wall.maxHitpoints, Math.max(1, spec.valency ?? wall.maxHitpoints));
  const e = world.create();
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, Palisade, {
    gfxIndex: type.typeId,
    tribe: spec.tribe,
    built: spec.underConstruction
      ? fx.fromInt(0)
      : fx.div(fx.fromInt(hitpoints), fx.fromInt(wall.maxHitpoints)),
    walk: type.walk.map((cell) => ({ ...cell })),
    placementWalk: (spec.placementWalk ?? type.walk).map((cell) => ({ ...cell })),
    build: type.build.map((cell) => ({ ...cell })),
    construction: wall.construction.map((line) => ({ ...line })),
    repairPerStrike: wall.repairPerStrike,
    repairing: false,
    gate: wall.gate === undefined ? null : { ...wall.gate },
  });
  world.add(e, Health, {
    hitpoints,
    max: wall.maxHitpoints,
  });
  world.add(e, Stockpile, { amounts: new Map<number, number>() });
  if (spec.underConstruction) world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  else world.add(e, PalisadeBlocking, {});
  stampOwner(world, e, spec.owner);
  return e;
}

/** Open or close a completed gate by swapping to its paired data row. Closing is refused while any other
 * positioned entity occupies a cell the closed footprint would block. */
export function setPalisadeGate(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setPalisadeGate' }>,
): void {
  const terrain = ctx.terrain;
  const current = world.tryGet(command.palisade, Palisade);
  if (
    terrain === undefined ||
    current === undefined ||
    current.gate === null ||
    world.has(command.palisade, UnderConstruction)
  )
    return;
  if (current.gate.open === command.open) return;
  const target = palisadeType(terrain, current.gate.counterpartGfxIndex);
  if (target?.wall?.gate === undefined || target.wall.gate.open !== command.open) return;
  if (!command.open && palisadeBlockingCellsOccupied(world, terrain, command.palisade, target.walk)) return;

  // Remove + add so footprint journals see the source-record swap as a topology change.
  const blocking = world.has(command.palisade, PalisadeBlocking);
  if (blocking) world.remove(command.palisade, PalisadeBlocking);
  world.remove(command.palisade, Palisade);
  world.add(command.palisade, Palisade, {
    gfxIndex: target.typeId,
    tribe: current.tribe,
    built: current.built,
    walk: target.walk.map((cell) => ({ ...cell })),
    placementWalk: current.placementWalk.map((cell) => ({ ...cell })),
    build: target.build.map((cell) => ({ ...cell })),
    construction: target.wall.construction.map((line) => ({ ...line })),
    repairPerStrike: target.wall.repairPerStrike,
    repairing: current.repairing,
    gate: { ...target.wall.gate },
  });
  const health = world.tryMut(command.palisade, Health);
  if (health !== undefined && health.max !== target.wall.maxHitpoints) {
    health.hitpoints = Math.min(health.hitpoints, target.wall.maxHitpoints);
    health.max = target.wall.maxHitpoints;
  }
  if (blocking) world.add(command.palisade, PalisadeBlocking, {});
}

export function palisadeBlockingCellsOccupied(
  world: World,
  terrain: TerrainGraph,
  gate: Entity,
  walk: readonly FootprintCell[],
): boolean {
  const at = world.get(gate, Position);
  const anchor = nodeOfPosition(at.x, at.y);
  const closed = new Set(translatedCells(terrain, walk, anchor.hx, anchor.hy));
  for (const e of world.query(Position)) {
    if (e === gate) continue;
    const p = world.get(e, Position);
    const node = terrain.nodeAtClamped(nodeOfPosition(p.x, p.y).hx, nodeOfPosition(p.x, p.y).hy);
    if (closed.has(node)) return true;
  }
  return false;
}

/** Re-open a damaged finished segment as a builder job. Repairs consume no goods and restore the readable
 * transition-9 amount per hammer strike. */
export function repairPalisade(world: World, command: Extract<Command, { kind: 'repairPalisade' }>): void {
  const wall = world.tryMut(command.palisade, Palisade);
  const health = world.tryGet(command.palisade, Health);
  if (wall === undefined || health === undefined || health.hitpoints <= 0 || health.hitpoints >= health.max)
    return;
  if (world.has(command.palisade, UnderConstruction)) return;
  wall.repairing = true;
  world.add(command.palisade, UnderConstruction, {
    labor: fx.div(fx.fromInt(health.hitpoints), fx.fromInt(health.max)),
  });
}

export function placePalisade(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placePalisade' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const type = palisadeType(terrain, command.gfxIndex);
  if (type === undefined) return;
  if (command.force !== true) {
    const probe = palisadePlacementProbe(world, ctx.content, terrain, command.gfxIndex);
    if (probe === null || !probe.canPlace(command.x, command.y)) return;
  }
  const entity = createPalisade(world, type, {
    x: command.x,
    y: command.y,
    tribe: command.tribe,
    ...(command.owner !== undefined ? { owner: command.owner } : {}),
    underConstruction: command.underConstruction === true,
    ...(command.valency !== undefined ? { valency: command.valency } : {}),
    placementWalk: placementWalkOf(terrain, type),
  });
  if (entity !== null)
    ctx.events.emit({ kind: 'palisadePlaced', entity, at: { hx: command.x, hy: command.y } });
}
