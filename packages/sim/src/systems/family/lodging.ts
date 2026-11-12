import type { LodgingWear } from '@open-northland/data';
import {
  Building,
  CurrentAtomic,
  Evicted,
  Lodgings,
  ownerOf,
  Residence,
  removeCurrentAtomic,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { heldIndoors, isInside, stepOut } from '../settlers/indoors.js';
import {
  homeQualityAllowed,
  type LodgingHomeQuality,
  lodgingPieces,
  lodgingUseFor,
  spendHomeQuality,
} from './home-quality.js';
import { builtHomeType, familiesOf, homeTypeOf, isMinor } from './households.js';

// Owner's design, replacing the original's furniture rest bonus: a piece of furniture houses one family
// above a home's base `homeSize`, up to its `furnishedFamilies`. The families that moved in last are the
// extra ones; each wears its own piece, and the home's stored furniture replaces a piece that wears out.
// A family whose piece is gone with no spare, or whose owner forbids furniture, moves out.

/** The household activity that wears a family's furniture. */
export type LodgingWearSource = keyof LodgingWear;

/**
 * Wear the piece `settler`'s family lives on for one `source` activity in `home`, when the family is one of
 * the home's extra ones and the owner allows furniture; a base family wears nothing. A worn-out piece is
 * replaced from the home's store, and with none there the family moves out. The piece a child empties
 * stays at nothing until the family's next sleep or meal, so the couple is not put out mid-session.
 */
export function wearLodging(
  world: World,
  ctx: SystemContext,
  home: Entity,
  settler: Entity,
  source: LodgingWearSource,
): void {
  const furniture = lodgingUseFor(ctx);
  const type = builtHomeType(world, ctx, home);
  if (furniture === undefined || type === undefined || type.furnishedFamilies === 0) return;
  if (!homeQualityAllowed(world, home, 'lodging')) return;
  const families = rankedFamilies(world, home);
  const lodger = families.findIndex((family) => family.members.includes(settler)) - type.homeSize;
  if (lodger < 0) return;
  const pieces = seatLodgers(world, home, furniture, families.length - type.homeSize);
  const left = pieces[lodger];
  if (left === undefined) return;
  const worn = Math.max(0, left - furniture.wear[source]);
  if (worn > 0) {
    world.mut(home, Lodgings).pieces[lodger] = worn;
  } else if (spendHomeQuality(world, home, 'lodging', furniture.deliveryValue)) {
    world.mut(home, Lodgings).pieces[lodger] = furniture.deliveryValue;
  } else if (source === 'child') {
    world.mut(home, Lodgings).pieces[lodger] = 0;
  } else {
    world.mut(home, Lodgings).pieces.splice(lodger, 1);
    moveOut(world, ctx, home, families[lodger + type.homeSize] as Household);
  }
}

/**
 * Put a spare piece under each of `home`'s `extraFamilies` that has none yet, while the store holds whole
 * ones, and return the pieces in use.
 */
function seatLodgers(
  world: World,
  home: Entity,
  furniture: LodgingHomeQuality,
  extraFamilies: number,
): readonly number[] {
  while (
    lodgingPieces(world, home).length < extraFamilies &&
    spendHomeQuality(world, home, 'lodging', furniture.deliveryValue)
  ) {
    const lodgings = world.tryMut(home, Lodgings);
    if (lodgings === undefined) world.add(home, Lodgings, { pieces: [furniture.deliveryValue] });
    else lodgings.pieces.push(furniture.deliveryValue);
  }
  return lodgingPieces(world, home);
}

/**
 * Forbidding furniture lifts its extra families at once: each of `player`'s homes moves out the families
 * above its base, a home under upgrade included, since nothing is worn there afterwards. The pieces stay
 * for when furniture is allowed again.
 */
export function moveOutOfUnfurnishedHomes(world: World, ctx: SystemContext, player: number): void {
  for (const home of world.query(Building)) {
    if (ownerOf(world, home) !== player) continue;
    const type = homeTypeOf(world, ctx, home);
    if (type === undefined || type.furnishedFamilies === 0) continue;
    for (const family of rankedFamilies(world, home).slice(type.homeSize)) moveOut(world, ctx, home, family);
  }
}

/** One family of a home, ranked by when it moved in. */
interface Household {
  readonly members: readonly Entity[];
  /** The lower adult id, or the child of a household with no adult. */
  readonly head: Entity;
  /** The earliest move-in tick among its adults: a spouse marrying in does not make the family new. */
  readonly since: number;
}

/**
 * The families of `home`, the one that moved in first first and the lower head id first on a tie: those
 * past the home's base `homeSize` are its extra families, in the order of their pieces.
 */
function rankedFamilies(world: World, home: Entity): Household[] {
  return familiesOf(world, home)
    .map((members) => household(world, members))
    .sort((a, b) => a.since - b.since || a.head - b.head);
}

/** Unhouse `family` from `home` with a `familyMovedOut` event and an {@link Evicted} mark on each member,
 *  so the assistant can re-house it. */
function moveOut(world: World, ctx: SystemContext, home: Entity, family: Household): void {
  for (const member of family.members) leaveHome(world, member, home);
  ctx.events.emit({
    kind: 'familyMovedOut',
    entity: family.head,
    home,
    player: ownerOf(world, home) ?? null,
  });
}

function household(world: World, members: readonly Entity[]): Household {
  const adults = members.filter((e) => !isMinor(world, e));
  const ranked = adults.length > 0 ? adults : members;
  let head = ranked[0] as Entity;
  let since = Number.POSITIVE_INFINITY;
  for (const e of ranked) {
    if (e < head) head = e;
    since = Math.min(since, world.get(e, Residence).since);
  }
  return { members, head, since };
}

/** Unhouse `e` and let it out of `home`: a sleep or a meal off the larder there ends with the stay. */
function leaveHome(world: World, e: Entity, home: Entity): void {
  world.remove(e, Residence);
  world.add(e, Evicted, { evicted: true });
  if (!isInside(world, e, home)) return;
  const effect = world.tryGet(e, CurrentAtomic)?.effect;
  if (effect?.kind === 'sleep' || (effect?.kind === 'eat' && effect.from === home))
    removeCurrentAtomic(world, e);
  if (!heldIndoors(world, e)) stepOut(world, e);
}
