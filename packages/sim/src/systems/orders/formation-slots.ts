import type { ContentSet } from '@open-northland/data';
import { Position, Rider, Settler } from '../../components/index.js';
import { MAX_UNIT_ORDER_MEMBERS } from '../../core/commands/unit-orders.js';
import type { Entity, World } from '../../ecs/world.js';
import { formationNodes } from '../../nav/formation.js';
import { type HalfCellNode, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import { hasOpenSide } from '../../nav/nearest.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import { buildingDoorwayNodes } from '../footprint/building-blocked-cache.js';
import { walkBlockMask } from '../footprint/walk-block-mask.js';
import { routeStartCell } from '../movement/route-start.js';
import { CLICK_SIDES_RADIUS, type ClickSides, clickSides } from '../movement/structure-route.js';
import { commandedVehicleOf } from '../vehicles/commander.js';
import { landingOf } from '../vehicles/crew.js';

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
  order: FormationOrder,
): readonly FormationSlotGroup[] | null {
  if (
    members.length > MAX_UNIT_ORDER_MEMBERS ||
    !Number.isSafeInteger(target.hx) ||
    !Number.isSafeInteger(target.hy) ||
    (rowSpacing !== 1 && rowSpacing !== 2) ||
    (order !== 'move' && order !== 'attackMove')
  )
    throw new RangeError('invalid formation query');
  if (terrain === undefined) return null;
  return formationSlotGroups(
    world,
    content,
    terrain,
    target,
    members,
    rowSpacing,
    settlersStanding,
    order,
    true,
  );
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

/** The walk a group order sends its members on. A move keeps every member on its own side of the walls
 *  around the click; an attack-move takes slots past a wall, which its walkers breach. */
export type FormationOrder = 'move' | 'attackMove';

/** A foot member's start: its land component and its standable start node, null when blocked. */
interface MemberStart {
  readonly entity: Entity;
  readonly component: number;
  readonly anchor: NodeId | null;
}

/** Members sharing a land component and the sides of the walls around the click they reach. */
interface SlotGroup {
  readonly component: number;
  /** A member's standable start node, standing in for every member of the group; null for members
   *  starting on a blocked node, which group by land component alone. */
  readonly anchor: NodeId | null;
  readonly key: string;
  readonly members: Entity[];
  readonly slots: HalfCellNode[];
  remaining: number;
}

/**
 * One open slot around `target` per member, on the land component the member stands on and off the
 * nodes `occupancy` names. A move also keeps each member on its side of every closed gate or wall.
 *
 * With `crossIslandRaw`, a move-order member standing on another land component than the click keeps
 * the raw clicked node as its own singleton slot: its order is no formation but the crossing itself,
 * which the sim's move order judges - the ferry booking, or the plain refusal when no ship takes it -
 * instead of the fan re-aiming the member at its own coast. Scripts keep the projection.
 */
export function formationSlotGroups(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  target: HalfCellNode,
  members: readonly Entity[],
  rowSpacing: 1 | 2,
  occupancy: Occupancy,
  order: FormationOrder,
  crossIslandRaw = false,
): FormationSlotGroup[] {
  const seat = {
    hx: Math.max(0, Math.min(terrain.width - 1, target.hx)),
    hy: Math.max(0, Math.min(terrain.height - 1, target.hy)),
  };
  const ctx = { content };
  const blocked = walkBlockMask(world, ctx, terrain).levelled();
  const clicked = terrain.nodeAt(seat.hx, seat.hy);
  /** Members in entity order; a vehicle commander stands as its finished singleton group. */
  const entries: (MemberStart | FormationSlotGroup)[] = [];
  const movers = new Set<Entity>();
  for (const entity of [...new Set(members)].sort((a, b) => a - b)) {
    if (!Number.isSafeInteger(entity) || entity <= 0 || !world.has(entity, Settler)) continue;
    // A captain still walking to board already directs its vehicle. Let that vehicle judge the
    // clicked surface and clearance, instead of turning a water click into a foot destination.
    const commandedVehicle = commandedVehicleOf(world, entity);
    if (commandedVehicle !== null) {
      entries.push({ members: [entity], slots: [{ ...seat }], commandedVehicle });
      continue;
    }
    let position = world.tryGet(entity, Position);
    if (position === undefined) {
      const rider = world.tryGet(entity, Rider);
      const landing = rider === undefined ? null : landingOf(world, { content, terrain }, rider.vehicle);
      if (landing !== null) position = positionOfNode(landing.hx, landing.hy);
    }
    if (position === undefined) continue;
    const { hx, hy } = nodeOfPosition(position.x, position.y);
    if (!terrain.inBounds(hx, hy)) continue;
    // With `blocked`, a member mid-step beside a wall starts from the open node on its own side.
    const start = routeStartCell(terrain, position.x, position.y, 'land', blocked);
    if (!terrain.isWalkable(start)) continue;
    // A move order across the water is the member's own crossing, not a fan seat: the raw click goes
    // through, so the move order's ferry booking (or its refusal) judges it. Only a click that names
    // walkable ground keeps this - a water or unwalkable click still fans its banks as before.
    const clickedComponent = terrain.componentOf(clicked);
    if (
      crossIslandRaw &&
      order === 'move' &&
      terrain.isWalkable(clicked) &&
      clickedComponent !== NO_COMPONENT &&
      terrain.componentOf(start) !== clickedComponent
    ) {
      entries.push({ members: [entity], slots: [{ ...seat }] });
      continue;
    }
    entries.push({
      entity,
      component: terrain.componentOf(start),
      anchor: blocked.has(start) ? null : start,
    });
    movers.add(entity);
  }
  const occupied = movers.size === 0 ? () => false : occupancy(world, terrain, movers);
  const doorways = buildingDoorwayNodes(world, ctx, terrain);

  /** Slots by `sides`, or by land component alone without them; `fits` is false when a slot of a split
   *  click lies outside the box `sides` judged. */
  const place = (sides: ClickSides | null): { result: FormationSlotGroup[]; fits: boolean } => {
    const result: FormationSlotGroup[] = [];
    const groups: SlotGroup[] = [];
    for (const entry of entries) {
      if (!('entity' in entry)) {
        result.push(entry);
        continue;
      }
      const { entity, component, anchor } = entry;
      // A blocked start shares the empty key with every member of an unsplit click.
      const key = sides === null || anchor === null ? '' : sides.keyOf(anchor);
      let group = groups.find((g) => g.component === component && g.key === key);
      if (group === undefined) {
        group = { component, anchor, key, members: [], slots: [], remaining: 0 };
        groups.push(group);
        result.push({ members: group.members, slots: group.slots });
      }
      group.members.push(entity);
      group.remaining++;
    }
    if (movers.size === 0) return { result, fits: true };
    const chosen = new Map<NodeId, SlotGroup>();
    const unavailable = (hx: number, hy: number): boolean => {
      const node = terrain.nodeAt(hx, hy);
      if (chosen.has(node) || !terrain.isWalkable(node) || blocked.has(node) || occupied(node)) return true;
      // The clicked node is the player's own stand, unless a wall beside it parts it from the group; a
      // slot fanned out around it never takes a doorway or seals a member in. Source basis: authored.
      if (node !== clicked && (doorways.has(node) || !hasOpenSide(terrain, node, blocked))) return true;
      const component = terrain.componentOf(node);
      const group = groups.find(
        (g) =>
          g.component === component &&
          g.remaining > 0 &&
          (sides === null || g.anchor === null || sides.reaches(g.anchor, node)),
      );
      if (group === undefined) return true;
      group.remaining--;
      chosen.set(node, group);
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
    let fits = true;
    for (const slot of slots) {
      const node = terrain.nodeAt(slot.hx, slot.hy);
      chosen.get(node)?.slots.push(slot);
      if (sides?.split === true && !sides.contains(node)) fits = false;
    }
    return { result, fits };
  };

  if (order === 'attackMove') return place(null).result;
  // A fan wider than the judged box would hand far-side ground outside it to anyone, so a split click
  // doubles the box until the fan fits inside it or the box spans the map.
  const span = Math.max(terrain.width, terrain.height);
  for (let radius = CLICK_SIDES_RADIUS; ; radius *= 2) {
    const sides = clickSides(world, ctx, terrain, clicked, blocked, radius);
    const placed = place(sides);
    if (placed.fits || radius >= span) return placed.result;
  }
}
