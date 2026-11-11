import type { BuildingType, LodgingWear } from '@open-northland/data';
import {
  Building,
  CurrentAtomic,
  HomeQuality,
  MakingLove,
  ownerOf,
  Residence,
  removeCurrentAtomic,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { heldIndoors, isInside, stepOut } from '../settlers/indoors.js';
import { homeQualityActive, homeQualityValue, lodgingUseFor, spendHomeQuality } from './home-quality.js';
import { builtHomeType, familiesOf, familyCountOf, isMinor } from './households.js';

// Owner's design, replacing the original's furniture rest bonus: furniture lets a home take
// `furnishedFamilies` more families (`homeFamilyCapacity`), and the extra families wear it out. Once it is
// gone or forbidden, the families above the home's base `homeSize` move out.

/** The household activity that wears a home's furniture. */
export type LodgingWearSource = keyof LodgingWear;

/**
 * Wear `home`'s furniture for one `source` activity there, while the home holds more families than its base
 * `homeSize` and its owner allows furniture: a home at or below base keeps its spare unworn. A partial last
 * payment empties the pool, and an emptied pool moves the extra families out ({@link moveOutAboveBase}).
 */
export function wearLodging(world: World, ctx: SystemContext, home: Entity, source: LodgingWearSource): void {
  const pool = homeQualityValue(world, home, 'lodging');
  if (pool <= 0) return;
  const furniture = lodgingUseFor(ctx);
  const type = builtHomeType(world, ctx, home);
  if (furniture === undefined || type === undefined || familyCountOf(world, home) <= type.homeSize) return;
  if (!homeQualityActive(world, ctx, home, 'lodging')) return;
  spendHomeQuality(world, home, 'lodging', Math.min(furniture.wear[source], pool));
  if (homeQualityValue(world, home, 'lodging') === 0) moveOutAboveBase(world, ctx, home, type);
}

/**
 * Forbidding furniture lifts its extra families at once: each of `player`'s homes moves out the families
 * above its base. Only a home that held furniture can have housed them.
 */
export function moveOutOfUnfurnishedHomes(world: World, ctx: SystemContext, player: number): void {
  for (const home of world.query(HomeQuality, Building)) {
    if (ownerOf(world, home) !== player) continue;
    const type = builtHomeType(world, ctx, home);
    if (type !== undefined) moveOutAboveBase(world, ctx, home, type);
  }
}

/** One family of a home, ranked for moving out. */
interface Household {
  readonly members: readonly Entity[];
  /** The lower adult id, or the child of a household with no adult. */
  readonly head: Entity;
  /** The earliest move-in tick among its adults: a spouse marrying in does not make the family new. */
  readonly since: number;
  /** Its wife holds the home's child session. */
  readonly makingLove: boolean;
}

/**
 * Unhouse the families of `home` above its base `homeSize`: the one that moved in last first, the higher
 * head id first on a tie, and a couple making a child there only when no other family is left. Each family
 * leaves with a `familyMovedOut` event.
 */
function moveOutAboveBase(world: World, ctx: SystemContext, home: Entity, type: BuildingType): void {
  const families = familiesOf(world, home);
  const excess = families.length - type.homeSize;
  if (excess <= 0) return;
  const wife = world.tryGet(home, MakingLove)?.wife;
  const ranked = families
    .map((members) => household(world, members, wife))
    .sort((a, b) => Number(a.makingLove) - Number(b.makingLove) || b.since - a.since || b.head - a.head);
  const player = ownerOf(world, home) ?? null;
  for (const family of ranked.slice(0, excess)) {
    for (const member of family.members) leaveHome(world, member, home);
    ctx.events.emit({ kind: 'familyMovedOut', entity: family.head, home, player });
  }
}

function household(world: World, members: readonly Entity[], wife: Entity | undefined): Household {
  const adults = members.filter((e) => !isMinor(world, e));
  const ranked = adults.length > 0 ? adults : members;
  let head = ranked[0] as Entity;
  let since = Number.POSITIVE_INFINITY;
  for (const e of ranked) {
    if (e < head) head = e;
    since = Math.min(since, world.get(e, Residence).since);
  }
  return { members, head, since, makingLove: wife !== undefined && members.includes(wife) };
}

/** Unhouse `e` and let it out of `home`: a sleep or a meal off the larder there ends with the stay. */
function leaveHome(world: World, e: Entity, home: Entity): void {
  world.remove(e, Residence);
  if (!isInside(world, e, home)) return;
  const effect = world.tryGet(e, CurrentAtomic)?.effect;
  if (effect?.kind === 'sleep' || (effect?.kind === 'eat' && effect.from === home))
    removeCurrentAtomic(world, e);
  if (!heldIndoors(world, e)) stepOut(world, e);
}
