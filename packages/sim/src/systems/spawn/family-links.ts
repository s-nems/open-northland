import { Female, JobAssignment, Marriage, Person, Position, Residence } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistance, nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { isAdultSettler, mayMarry } from '../family/index.js';
import { settlersByNode, spawnLanding } from '../movement/evict.js';

type MarryPlaced = Extract<Command, { kind: 'marryPlaced' }>;
type ParentPlacedChild = Extract<Command, { kind: 'parentPlacedChild' }>;

/**
 * A decoded map's `marry` line: wed the most recently placed woman who may marry among the humans placed
 * on `woman` to the most recently placed such man on `man`, at once and with no wedding walk. Original
 * behavior: the loader looks no further than those two nodes, takes the woman from the first, checks
 * neither player nor tribe, and settles the couple in a home by {@link houseCouple}.
 */
export function marryPlaced(world: World, ctx: SystemContext, command: MarryPlaced): void {
  const wife = placedOn(world, ctx, command.woman).find(
    (e) => world.has(e, Female) && mayMarry(world, ctx.content, e),
  );
  if (wife === undefined) return;
  const husband = placedOn(world, ctx, command.man).find(
    (e) => !world.has(e, Female) && mayMarry(world, ctx.content, e),
  );
  if (husband === undefined) return;
  // A woman can only hold a child inside a marriage here, so she brings none to it.
  world.add(wife, Marriage, { spouse: husband, child: null });
  world.add(husband, Marriage, { spouse: wife, child: null });
  houseCouple(world, wife, husband);
}

/**
 * A decoded map's `childOfWoman` line: make the most recently placed child on `child` that has no parents
 * the child of the most recently placed woman on `woman` who raises none, and of her husband. Original behavior:
 * the child also moves into her home. Approximation: a child is held only by a couple, so an unmarried
 * woman only takes the child into her home.
 */
export function parentPlacedChild(world: World, ctx: SystemContext, command: ParentPlacedChild): void {
  const placedChild = placedOn(world, ctx, command.child).find(
    (e) => world.has(e, Person) && !isAdultSettler(world, e) && !hasParents(world, e),
  );
  if (placedChild === undefined) return;
  const mother = placedOn(world, ctx, command.woman).find(
    (e) => world.has(e, Female) && (world.tryGet(e, Marriage)?.child ?? null) === null,
  );
  if (mother === undefined) return;
  const spouse = world.tryGet(mother, Marriage)?.spouse;
  if (spouse !== undefined && world.isAlive(spouse)) {
    world.mut(mother, Marriage).child = placedChild;
    world.mut(spouse, Marriage).child = placedChild;
    houseCouple(world, mother, spouse);
    return;
  }
  const home = world.tryGet(mother, Residence)?.home;
  if (home !== undefined) world.add(placedChild, Residence, { home });
}

/**
 * Original behavior: a homeless wife leaves the couple where they live. Otherwise a homeless husband
 * moves in with her, one without a workplace takes her into his home, and one with a workplace keeps the
 * home nearer to it, his own on a tie. Neither move checks the home's capacity, and her child follows
 * her.
 */
function houseCouple(world: World, wife: Entity, husband: Entity): void {
  const wifeHome = world.tryGet(wife, Residence)?.home;
  if (wifeHome === undefined) return;
  const husbandHome = world.tryGet(husband, Residence)?.home;
  const workplace = world.tryGet(husband, JobAssignment)?.workplace;
  const husbandJoins =
    husbandHome === undefined ||
    (workplace !== undefined &&
      distance(world, workplace, wifeHome) < distance(world, workplace, husbandHome));
  const home = husbandJoins ? wifeHome : husbandHome;
  world.add(husbandJoins ? husband : wife, Residence, { home });
  const child = world.get(wife, Marriage).child;
  if (child !== null && world.isAlive(child)) world.add(child, Residence, { home });
}

/** The half-cell hex distance between two buildings' anchors. */
function distance(world: World, a: Entity, b: Entity): number {
  const pa = world.get(a, Position);
  const pb = world.get(b, Position);
  return hexDistance(nodeOfPosition(pa.x, pa.y), nodeOfPosition(pb.x, pb.y));
}

/** Whether some couple's {@link Marriage} already holds `e` as its child; a setup-time scan. */
function hasParents(world: World, e: Entity): boolean {
  for (const parent of world.query(Marriage)) {
    if (world.get(parent, Marriage).child === e) return true;
  }
  return false;
}

/**
 * The settlers on the node a `spawnSettler` naming `node` left its human on, the most recently placed
 * first: `node` itself, or where the blocked-spawn push landed it. Original behavior: a node lists its
 * newest arrival first. Approximation: the original leaves a placed human on its node, so there a
 * settler pushed onto the same landing from another node is no candidate.
 */
function placedOn(world: World, ctx: SystemContext, node: { x: number; y: number }): readonly Entity[] {
  const terrain = ctx.terrain;
  const inBounds = terrain !== undefined && terrain.inBounds(node.x, node.y);
  const landing = inBounds
    ? (spawnLanding(world, ctx, terrain, terrain.nodeAt(node.x, node.y), 'land') ??
      terrain.nodeAt(node.x, node.y))
    : undefined;
  const settlers =
    terrain === undefined || landing === undefined
      ? settlersByNode(world).at(node.x, node.y)
      : settlersByNode(world).at(terrain.xOf(landing), terrain.yOf(landing));
  // Entity ids ascend in placement order.
  return [...settlers].reverse();
}
