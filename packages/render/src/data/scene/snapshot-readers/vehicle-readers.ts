import { components as simComponents, ONE, positionOfNode } from '@open-northland/sim';
import { clamp01, lerp } from '../../math.js';
import { readNumField } from '../../snapshot/index.js';
import { gfxDirToFacing } from '../../sprites/settler.js';
import type { MutableDrawItem, StaticDrawFields, VehicleDrawTask } from '../draw-item.js';
import { readOwnerPlayer } from './unit-readers.js';

const { NODE_PROGRESS_FULL } = simComponents;

/** The `Vehicle.task` names, transcribed so the reader narrows an unknown string to a task or drops it. */
const VEHICLE_TASKS: ReadonlySet<string> = new Set<VehicleDrawTask>([
  'none',
  'docks',
  'attacks',
  'waitsForHuman',
  'waitsForAnimal',
  'interrupted',
  'boardsShip',
]);

function readVehicleTask(components: Readonly<Record<string, unknown>>): VehicleDrawTask | undefined {
  const v = components.Vehicle as { task?: unknown } | undefined;
  const task = v?.task;
  return typeof task === 'string' && VEHICLE_TASKS.has(task) ? (task as VehicleDrawTask) : undefined;
}

/**
 * The fields a vehicle keeps through the fog: its type and tribe (the binding key), its owner's colour
 * and its heading. `Vehicle.facing` is one of the six map-point directions, whose order matches the
 * source's `<dir>` ring, so the same remap the frame lists use turns it into a render facing.
 */
export function readVehicleStaticFields(
  target: StaticDrawFields,
  components: Readonly<Record<string, unknown>>,
): void {
  const typeId = readNumField(components, 'Vehicle', 'vehicleType');
  if (typeId !== undefined) target.typeId = typeId;
  const tribe = readNumField(components, 'Vehicle', 'tribe');
  if (tribe !== undefined) target.tribe = tribe;
  const facing = readNumField(components, 'Vehicle', 'facing');
  if (facing !== undefined) target.facing = gfxDirToFacing(facing);
  const player = readOwnerPlayer(components);
  if (player !== undefined) target.player = player;
}

/** One `VehicleStock.lines` entry as the snapshot clones it: `[goodType, { current, ... }]`. */
function isStockLine(pair: unknown): pair is readonly [number, { current?: unknown }] {
  return (
    Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'object' && pair[1] !== null
  );
}

/**
 * The live vehicle fields on top of the static ones: its task and its load. The load is drawn as one
 * good, the one with the most units aboard (approximation: the original's loaded variants are palette
 * rows of one cart body, not per-good art, so any good picks the same loaded look).
 */
export function readVehicleFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
): void {
  readVehicleStaticFields(item, components);
  const task = readVehicleTask(components);
  if (task !== undefined) item.task = task;
  const stock = components.VehicleStock as { lines?: unknown } | undefined;
  if (stock === undefined || !Array.isArray(stock.lines)) return;
  let best: number | undefined;
  let most = 0;
  for (const line of stock.lines) {
    if (!isStockLine(line)) continue;
    const current = line[1].current;
    if (typeof current !== 'number' || current <= most) continue;
    most = current;
    best = line[0];
  }
  if (best === undefined) return;
  item.carrying = true;
  item.carryGood = best;
}

/** Whether the vehicle is driving: it carries a `VehicleDrive`, between legs as well as on one. */
export function readVehicleDriving(components: Readonly<Record<string, unknown>>): boolean {
  return 'VehicleDrive' in components;
}

/**
 * The tile a driving vehicle draws at. The sim moves the anchor onto a leg's node as the leg starts and
 * counts `progress` toward `NODE_PROGRESS_FULL` on it, so the drawn tile slides from `from`, the node
 * the leg left, to the anchor by that fraction; between legs and while standing it is the anchor. Lerped
 * in Position space, the same line a walking settler's steps follow.
 */
export function vehicleDrawTile(
  components: Readonly<Record<string, unknown>>,
  pos: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  const tileX = pos.x / ONE;
  const tileY = pos.y / ONE;
  const drive = components.VehicleDrive as { from?: unknown; progress?: unknown } | undefined;
  const from = drive?.from as { hx?: unknown; hy?: unknown } | null | undefined;
  if (from === null || from === undefined) return { x: tileX, y: tileY }; // between legs, or standing
  if (typeof from.hx !== 'number' || typeof from.hy !== 'number') return { x: tileX, y: tileY };
  const progress = typeof drive?.progress === 'number' ? drive.progress : 0;
  const t = clamp01(progress / NODE_PROGRESS_FULL);
  const left = positionOfNode(from.hx, from.hy);
  return { x: lerp(left.x / ONE, tileX, t), y: lerp(left.y / ONE, tileY, t) };
}

/** The entity ids seated in this vehicle's crew, aboard or still walking to it, or none for a
 *  non-vehicle. A seat is `{ entity, inside }`; a null slot is free. */
export function readVehicleCrew(components: Readonly<Record<string, unknown>>): readonly number[] {
  const v = components.Vehicle as { passengers?: unknown } | undefined;
  if (v === undefined || !Array.isArray(v.passengers)) return [];
  const crew: number[] = [];
  for (const seat of v.passengers) {
    const entity = (seat as { entity?: unknown } | null)?.entity;
    if (typeof entity === 'number') crew.push(entity);
  }
  return crew;
}
