import { indexById } from '@vinland/data';
import { assertNever } from '../brand.js';
import type { Command } from '../commands.js';
import { Building, Position, Settler, Stockpile } from '../components/index.js';
import type { World } from '../ecs/world.js';
import { ONE, fx } from '../fixed.js';
import type { System, SystemContext } from './context.js';
import { buildingEnabled } from './progression.js';

/**
 * CommandSystem — the ONLY way sim state mutates from the outside. It runs first each tick, drains
 * the per-sim {@link CommandQueue} (`ctx.commands`), and applies each command in enqueue order,
 * appending it to the append-only command log (the save / replay / lockstep record). Every other
 * system reacts to the world these commands shape; nothing outside this seam pokes the world.
 *
 * Why a system and not a method: routing all mutation through one serializable command type (a
 * discriminated union, exhaustively handled via {@link assertNever}) is what makes "a save is a
 * command log" and lockstep multiplayer possible — the same commands replayed on the same ticks from
 * the same seed reproduce byte-identical state. Determinism: the queue is a plain FIFO array, so
 * apply order is exactly enqueue order — no Map/Set iteration, no wall-clock, no RNG.
 *
 * The four variants:
 *  - `placeBuilding` — create a {@link Building} of the given type at (x,y) for a tribe, with a
 *    {@link Stockpile} seeded from the building type's `stock` slots (`initial` amounts). Emits
 *    `buildingPlaced`. Gated by the tribe's `jobEnablesHouse` tech-graph (see {@link buildingEnabled}):
 *    a house locked behind a not-yet-present job is skipped. (Construction/material delivery is a
 *    Phase-3 ConstructionSystem; for the slice a placed, enabled building is immediately `built`.)
 *  - `spawnSettler` — create a {@link Settler} of the given job at (x,y) for a tribe. Emits
 *    `settlerBorn`.
 *  - `setProduction` — point a workplace's production at a good (currently a no-op marker until the
 *    recipe-selection slice; recorded in the log so replay stays faithful).
 *  - `demolish` — destroy a building entity (ids are never recycled).
 *
 * A command that references an unknown type id or a dead entity is a recoverable boundary failure
 * (bad UI input / a stale command), not a programmer bug: it is skipped (the log still records it,
 * so replay is faithful) rather than throwing — one bad command must not abort the tick.
 */
export const commandSystem: System = (world, ctx) => {
  for (const command of ctx.commands.drain()) {
    applyCommand(world, ctx, command);
    ctx.commands.record(ctx.tick, command);
  }
};

function applyCommand(world: World, ctx: SystemContext, command: Command): void {
  switch (command.kind) {
    case 'placeBuilding':
      placeBuilding(world, ctx, command);
      return;
    case 'spawnSettler':
      spawnSettler(world, ctx, command);
      return;
    case 'setProduction':
      // No state change yet: recipe/output selection is a later slice. The command is still logged
      // by the caller so a replay reaches the same state once this is implemented.
      return;
    case 'demolish':
      if (world.isAlive(command.building)) world.destroy(command.building);
      return;
    default:
      assertNever(command);
  }
}

function placeBuilding(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeBuilding' }>,
): void {
  const type = indexById(ctx.content.buildings).get(command.buildingType);
  if (type === undefined) return; // unknown building type — skip (recoverable bad input)

  // Tech-graph gate: a house may be locked until a settler of an enabling job exists in the tribe
  // (`jobEnablesHouse`). A gated-out placement is a recoverable boundary failure (a stale/illegal UI
  // command), so it is skipped here but still recorded by commandSystem — replay stays faithful.
  if (!buildingEnabled(world, ctx, command.tribe, command.buildingType)) return;

  const e = world.create();
  world.add(e, Position, { x: fx.fromInt(command.x), y: fx.fromInt(command.y) });
  // A freshly placed building is fully built for the slice — ConstructionSystem (Phase 3) will
  // instead start it at built=0 and advance as materials are delivered.
  world.add(e, Building, { buildingType: command.buildingType, tribe: command.tribe, built: ONE, level: 0 });
  // Seed the stockpile from the building type's stock slots (their `initial` amounts), so a
  // headquarters arrives with its starting goods — exactly as the tests construct one by hand.
  const amounts = new Map<number, number>();
  for (const slot of type.stock) {
    if (slot.initial > 0) amounts.set(slot.goodType, slot.initial);
  }
  world.add(e, Stockpile, { amounts });
  ctx.events.emit({ kind: 'buildingPlaced', entity: e, at: { x: command.x, y: command.y } });
}

function spawnSettler(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'spawnSettler' }>,
): void {
  // jobType 0 ("idle"/unemployed) is allowed; only an id absent from the job table is bad input.
  if (indexById(ctx.content.jobs).get(command.jobType) === undefined) return;

  const e = world.create();
  world.add(e, Position, { x: fx.fromInt(command.x), y: fx.fromInt(command.y) });
  world.add(e, Settler, {
    tribe: command.tribe,
    jobType: command.jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  ctx.events.emit({ kind: 'settlerBorn', entity: e });
}
