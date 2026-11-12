import { Health, Owner, Settler, Vehicle } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isShipVehicle, WEAPON_MAIN_TYPE } from '../readviews/index.js';
import { looseSettlerShot } from '../settlers/atomics/effects/combat/index.js';
import { entityNode } from '../spatial/nodes.js';
import { playerSeesEntity } from '../vision/index.js';
import type { CombatIndex } from './combat-index.js';
import { visitDeckArchers } from './deck-archers.js';
import { PICK_CANDIDATES, PICK_SPREAD_NODES, PICK_TIER_RANKS, tierRank } from './engagement.js';
import { isValidTarget } from './targeting.js';
import { attackClipTiming, type MissileWeapon, missileOf } from './weapons.js';

// Deck fire, a named addition (owner rule): bow soldiers aboard a warship loose arrows from its deck at the
// enemies its owner sees, so a landing fleet is not helpless, yet weaker than the same men ashore.

/** How many map points short of its reach ashore a bow carries from a deck. Owner rule. */
export const DECK_RANGE_PENALTY_POINTS = 2;

/** How many nodes wider than the bowman's own aim a deck shot scatters, so even a veteran lands at most one
 *  arrow in four on a lone man. Owner rule: a rolling deck makes a poor stand. */
export const DECK_SCATTER_NODES = 1;

/** How many times its clip a bowman waits between shots on a deck, as a fraction: half as long again as
 *  ashore. Owner rule: a deck is a slower stand as well as a worse one. */
const DECK_SHOT_INTERVAL_NUMERATOR = 3;
const DECK_SHOT_INTERVAL_DENOMINATOR = 2;

/** Ticks between a deck bowman's shots, for an attack clip of `clipTicks` ashore. */
export function deckShotIntervalTicks(clipTicks: number): number {
  return Math.ceil((clipTicks * DECK_SHOT_INTERVAL_NUMERATOR) / DECK_SHOT_INTERVAL_DENOMINATOR);
}

/** The rank an enemy ship takes ahead of every land archer's {@link tierRank}: it shoots back. */
const SHIP_RANK = 0;

/**
 * Loose this tick's arrows from every warship's deck. Each bowman shoots slower than his own attack clip
 * ashore, staggered by seat, at the best enemy in his deck reach. Walks the seats of the vehicles the combat
 * pass already walks; only a bowman due a shot near an enemy searches for a target.
 */
export function fireFromDecks(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
  vehicles: readonly Entity[],
): void {
  const volley = new DeckVolley(world, ctx, terrain, index);
  for (const ship of vehicles) volley.fireFrom(ship);
}

/** One tick's deck fire, re-aimed per ship so a seat walk allocates nothing. */
class DeckVolley {
  private ship = 0 as Entity;
  private owner = 0;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    private readonly index: CombatIndex,
  ) {}

  fireFrom(ship: Entity): void {
    if ((this.world.tryGet(ship, Health)?.hitpoints ?? 0) <= 0) return;
    const owner = this.world.tryGet(ship, Owner)?.player;
    if (owner === undefined) return;
    this.ship = ship;
    this.owner = owner;
    visitDeckArchers(this.world, this.ctx, ship, this.visit);
  }

  private readonly visit = (archer: Entity, seat: number, bow: MissileWeapon): boolean => {
    const settler = this.world.get(archer, Settler);
    const clip = Math.max(1, attackClipTiming(this.ctx.content, settler).length);
    if ((this.ctx.tick + seat) % deckShotIntervalTicks(clip) === 0) this.shoot(archer, bow);
    return false;
  };

  private shoot(archer: Entity, bow: MissileWeapon): void {
    const { world, ctx, terrain, index, ship, owner } = this;
    const from = entityNode(world, terrain, ship);
    const x = terrain.xOf(from);
    const y = terrain.yOf(from);
    const maxRange = bow.maxRange - DECK_RANGE_PENALTY_POINTS;
    if (maxRange < bow.minRange || !index.othersWithin(owner, x, y, maxRange)) return;
    const identity = world.get(archer, Settler);
    const accept = (t: Entity): boolean =>
      t !== ship &&
      isValidTarget(world, ctx, archer, identity, t) &&
      playerSeesEntity(world, ctx.fog, owner, t);
    const rank = (t: Entity): number => {
      const vehicle = world.tryGet(t, Vehicle);
      const type =
        vehicle === undefined ? undefined : contentIndex(ctx.content).vehicles.get(vehicle.vehicleType);
      return type !== undefined && isShipVehicle(type) ? SHIP_RANK : 1 + tierRank(world, ctx, index, t);
    };
    const found = index.nearestFewOfBestRank(
      x,
      y,
      bow.minRange,
      maxRange,
      rank,
      PICK_TIER_RANKS + 1,
      accept,
      PICK_CANDIDATES,
      owner,
      PICK_SPREAD_NODES,
      'hex',
    );
    // As a land pick, draw nothing when nothing is in reach: an idle deck leaves the stream alone.
    if (found.length === 0) return;
    const pick = found.length === 1 ? found[0] : found[ctx.rng.int(found.length)];
    if (pick === undefined) return;
    looseSettlerShot(
      world,
      ctx,
      archer,
      ship,
      pick.entity,
      missileOf(bow),
      WEAPON_MAIN_TYPE.BOW,
      DECK_SCATTER_NODES,
    );
  }
}
