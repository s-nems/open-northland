import {
  entityById,
  ONE,
  positionOfNode,
  components as simComponents,
  type WorldSnapshot,
} from '@open-northland/sim';
import { clamp01, lerp } from '../../math.js';
import { rowStagger } from '../../projection/iso.js';
import { readNumField } from '../../snapshot/index.js';
import { gfxDirToFacing } from '../../sprites/settler.js';
import type { MutableDrawItem, StaticDrawFields, VehicleDrawTask } from '../draw-item.js';
import { readJobType, readOwnerPlayer, readSettlerTribe } from './unit-readers.js';

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

function readAttackClipStart(components: Readonly<Record<string, unknown>>): number | undefined {
  const v = components.Vehicle as { attack?: unknown } | undefined;
  const clipStart = (v?.attack as { clipStart?: unknown } | null | undefined)?.clipStart;
  return typeof clipStart === 'number' ? clipStart : undefined;
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

function readMoored(components: Readonly<Record<string, unknown>>): boolean {
  const v = components.Vehicle as { moored?: unknown } | undefined;
  return v?.moored === true;
}

/**
 * The live vehicle fields on top of the static ones: its task, whether it lies moored, and its load. The
 * load is drawn as one good, the one with the most units aboard (approximation: the original's loaded
 * variants are palette rows of one cart body, not per-good art, so any good picks the same loaded look).
 */
export function readVehicleFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
): void {
  readVehicleStaticFields(item, components);
  const task = readVehicleTask(components);
  if (task !== undefined) item.task = task;
  const clipStart = readAttackClipStart(components);
  if (clipStart !== undefined) item.attackClipStart = clipStart;
  if (readMoored(components)) item.moored = true;
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
 * in world space (column plus the row's stagger), not in tile space: a diagonal leg out of an odd
 * half-row crosses the integer row where the stagger kinks, and a tile-space lerp would swing the hull
 * a quarter column sideways there, the swerve a walking settler avoids with its seam waypoint.
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
  const leftY = left.y / ONE;
  const row = lerp(leftY, tileY, t);
  const worldX = lerp(worldColumn(left.x / ONE, leftY), worldColumn(tileX, tileY), t);
  return { x: worldX - rowStagger(row) / 2, y: row };
}

/** A tile position's world column: its column plus the half-column stagger of its row. */
function worldColumn(tileX: number, tileY: number): number {
  return tileX + rowStagger(tileY) / 2;
}

/**
 * The commander riding inside the vehicle (the last seat, `inside`), read off his own `Settler`; nothing
 * while the seat is empty or its rider walks outside.
 */
export function readVehicleDriver(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  snapshot: WorldSnapshot,
): void {
  const v = components.Vehicle as { passengers?: unknown } | undefined;
  if (v === undefined || !Array.isArray(v.passengers)) return;
  const seat = v.passengers[v.passengers.length - 1] as { entity?: unknown; inside?: unknown } | null;
  if (seat === null || seat === undefined || seat.inside !== true || typeof seat.entity !== 'number') return;
  const rider = entityById(snapshot, seat.entity);
  const jobType = rider === undefined ? undefined : readJobType(rider.components);
  if (rider === undefined || jobType === undefined) return;
  const tribe = readSettlerTribe(rider.components);
  item.driver = tribe === undefined ? { jobType } : { jobType, tribe };
}
