import type { ContentSet } from '@open-northland/data';
import { Position, Settler } from '../../components/index.js';
import { MAX_UNIT_ORDER_MEMBERS } from '../../core/commands/unit-orders.js';
import type { Entity, World } from '../../ecs/world.js';
import { formationNodes } from '../../nav/formation.js';
import { type HalfCellNode, nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { walkBlockMask } from '../footprint/walk-block-mask.js';
import { routeStartCell } from '../movement/route-start.js';
import { commandedVehicleOf } from '../vehicles/commander.js';

/** Foot members share a land component; each vehicle commander keeps the click in its own group. */
export interface FormationSlotGroup {
  readonly members: readonly Entity[];
  readonly slots: readonly HalfCellNode[];
  /** The vehicle this singleton commander directs, even if the presentation mirror is behind. */
  readonly commandedVehicle?: Entity;
}

/** The player's group-order slots: {@link formationSlotGroups} behind the order's own input bounds. */
export function formationSlotsFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  target: HalfCellNode,
  members: readonly Entity[],
  rowSpacing: 1 | 2,
): readonly FormationSlotGroup[] | null {
  if (
    members.length > MAX_UNIT_ORDER_MEMBERS ||
    !Number.isSafeInteger(target.hx) ||
    !Number.isSafeInteger(target.hy) ||
    (rowSpacing !== 1 && rowSpacing !== 2)
  )
    throw new RangeError('invalid formation query');
  if (terrain === undefined) return null;
  return formationSlotGroups(world, content, terrain, target, members, rowSpacing, settlersStanding);
}

/** Which nodes a group's slots must avoid, given the group's own members. */
export type Occupancy = (
  world: World,
  terrain: TerrainGraph,
  movers: ReadonlySet<Entity>,
) => (node: NodeId) => boolean;

/** Every node another settler stands on: one scan of the population, fit for a click. */
const settlersStanding: Occupancy = (world, terrain, movers) => {
  const occupied = new Set<NodeId>();
  for (const entity of world.query(Settler, Position)) {
    if (movers.has(entity)) continue;
    const position = world.get(entity, Position);
    const { hx, hy } = nodeOfPosition(position.x, position.y);
    if (terrain.inBounds(hx, hy)) occupied.add(terrain.nodeAt(hx, hy));
  }
  return (node) => occupied.has(node);
};

/** One open slot around `target` per member, on the land component the member stands on and off the
 *  nodes `occupancy` names. */
export function formationSlotGroups(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  target: HalfCellNode,
  members: readonly Entity[],
  rowSpacing: 1 | 2,
  occupancy: Occupancy,
): FormationSlotGroup[] {
  const seat = {
    hx: Math.max(0, Math.min(terrain.width - 1, target.hx)),
    hy: Math.max(0, Math.min(terrain.height - 1, target.hy)),
  };
  const result: FormationSlotGroup[] = [];
  const groups = new Map<number, { members: Entity[]; slots: HalfCellNode[]; remaining: number }>();
  const movers = new Set<Entity>();
  for (const entity of [...new Set(members)].sort((a, b) => a - b)) {
    if (!Number.isSafeInteger(entity) || entity <= 0 || !world.has(entity, Settler)) continue;
    // A captain still walking to board already directs its vehicle. Let that vehicle judge the
    // clicked surface and clearance, instead of turning a water click into a foot destination.
    const commandedVehicle = commandedVehicleOf(world, entity);
    if (commandedVehicle !== null) {
      result.push({ members: [entity], slots: [{ ...seat }], commandedVehicle });
      continue;
    }
    const position = world.tryGet(entity, Position);
    if (position === undefined) continue;
    const { hx, hy } = nodeOfPosition(position.x, position.y);
    if (!terrain.inBounds(hx, hy)) continue;
    const start = routeStartCell(terrain, position.x, position.y);
    if (!terrain.isWalkable(start)) continue;
    const component = terrain.componentOf(start);
    let group = groups.get(component);
    if (group === undefined) {
      group = { members: [], slots: [], remaining: 0 };
      groups.set(component, group);
      result.push({ members: group.members, slots: group.slots });
    }
    group.members.push(entity);
    group.remaining++;
    movers.add(entity);
  }
  if (movers.size === 0) return result;
  const occupied = occupancy(world, terrain, movers);
  const blocked = walkBlockMask(world, { content }, terrain).levelled();
  const chosen = new Set<NodeId>();
  const unavailable = (hx: number, hy: number): boolean => {
    const node = terrain.nodeAt(hx, hy);
    if (chosen.has(node) || !terrain.isWalkable(node) || blocked.has(node) || occupied(node)) return true;
    const group = groups.get(terrain.componentOf(node));
    if (group === undefined || group.remaining === 0) return true;
    group.remaining--;
    chosen.add(node);
    return false;
  };
  const slots = formationNodes(seat, movers.size, terrain.width, terrain.height, unavailable, rowSpacing);
  // Wider military rows are preferred spacing, not a walkability rule. A narrow bank may only have
  // the opposite row parity, or less room than the selected army; fill any deficit with legal gaps.
  if (rowSpacing === 2 && slots.length < movers.size) {
    slots.push(
      ...formationNodes(seat, movers.size - slots.length, terrain.width, terrain.height, unavailable),
    );
  }
  for (const slot of slots)
    groups.get(terrain.componentOf(terrain.nodeAt(slot.hx, slot.hy)))?.slots.push(slot);
  return result;
}
