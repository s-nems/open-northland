import {
  Building,
  GroundDrop,
  ownerOf,
  ownersCompatible,
  Position,
  Stockpile,
  setStockAmount,
  stampOwner,
  Vehicle,
} from '../../../../../components/index.js';
import type { Fixed } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../../nav/halfcell.js';
import { stockpilesAtNode } from '../../../../spatial/stockpiles.js';
import { isYardHeap, lowestStockedGood, MAX_GROUND_STACK } from '../../../../stores/index.js';

// Loose ground piles: create a haulable drop, hand-stack a placed pile, stack a carried load onto a
// yard heap, and reap a pile a pickup emptied. The shared on-the-ground shapes the harvest, carry, and
// store-transfer effects all route through - defined once so the drop sites can't drift apart.

/**
 * Create a bare ground pile at (x,y) - a {@link Stockpile}+{@link Position}+{@link GroundDrop} holding `amount`
 * of `goodType`. The one on-the-ground drop shape a felled trunk and a chipped ore unit both take, so the
 * pickup/porter/delivery machinery (and `reapEmptyGroundDrop`) handle either unchanged - defining it once keeps
 * the two drop sites ({@link fellNode}, {@link dropMinedOre}) from drifting apart. Returns the new entity so a
 * caller can announce it.
 *
 * Also the assembly the `dropGood` command routes through (via `command/`), so a harvest-dropped pile and a
 * player-dropped pile are byte-identical entities.
 */
export function dropGroundPile(world: World, x: Fixed, y: Fixed, goodType: number, amount: number): Entity {
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[goodType, amount]]) });
  world.add(pile, GroundDrop, { goodType });
  return pile;
}

/**
 * Drop `amount` of `goodType` as a loose ground pile at (x,y), stacking onto an existing loose pile of the same
 * good already on that tile (up to {@link MAX_GROUND_STACK}) instead of littering a fresh entity per drop - the
 * assembly the `dropGood` command routes through (a player/admin placing goods by hand, one unit per click). A
 * loose pile is a bare {@link Stockpile}+{@link Position} with no {@link GroundDrop}/{@link Building} marker: it
 * draws as a per-fill heap that grows with its contents and just rests there (neither a felled-trunk pickup
 * source nor a building delivery sink), so placed goods stay put and visibly pile up - distinct from
 * {@link dropGroundPile}'s haulable felled-trunk shape.
 *
 * Determinism: the pile to stack onto is the first match in ascending id order over the tile's stockpiles
 * ({@link stockpilesAtNode}), a which-entity-wins pick that must be canonical. Only a pile holding this good (or
 * nothing) is merged - a heap of a different good on the same tile is left alone, so no good is ever
 * overwritten. Returns the stacked/created pile.
 */
export function dropOrStackGood(world: World, x: Fixed, y: Fixed, goodType: number, amount: number): Entity {
  const at = nodeOfPosition(x, y);
  for (const e of stockpilesAtNode(world, at.hx, at.hy)) {
    if (world.has(e, GroundDrop) || world.has(e, Building)) continue; // a trunk / a building store - not ours
    const stock = world.get(e, Stockpile); // indexed on (Stockpile, Position) - both are present
    const pos = world.get(e, Position);
    if (pos.x !== x || pos.y !== y) continue; // the same node, a different exact Position
    const have = stock.amounts.get(goodType) ?? 0;
    if (have <= 0 && stock.amounts.size > 0) continue; // holds a different good - never overwrite it
    setStockAmount(world, e, goodType, Math.min(MAX_GROUND_STACK, have + amount));
    return e;
  }
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[goodType, Math.min(MAX_GROUND_STACK, amount)]]) });
  return pile;
}

/**
 * Stack up to `want` units of `good` onto the loose ground heap at exactly `(x, y)`, capped at
 * {@link MAX_GROUND_STACK}; create the heap when none is there yet. Returns how many units were actually placed
 * - `0` when the tile is full or already holds a different good (never overwritten; the caller then carries the
 * remainder to the next tile). A loose heap is a bare {@link Stockpile}+{@link Position} with no
 * {@link GroundDrop}/{@link Building}/{@link DeliveryFlag} marker - the yard tile a gatherer stacks onto,
 * distinct from an uncollected trunk, a building store, and the flag marker itself (all excluded).
 *
 * Determinism: the heap to stack onto is the first match in ascending id order over the tile's stockpiles
 * ({@link stockpilesAtNode}), a which-entity-wins pick that must be canonical. The felled-trunk-free twin of
 * {@link dropOrStackGood} - the difference is the overflow policy: this reports the placed count so the caller
 * can carry the remainder to the next tile, where `dropOrStackGood` (a hand-placed pile) silently drops it.
 *
 * `owner` is the dropping settler's player: a FRESH heap is stamped with it ({@link stampOwner}), so a
 * gatherer's yard heap / a porter's shed load stays on its own side and a rival cannot fetch it. An
 * EXISTING heap merges only when its side is compatible ({@link ownersCompatible}) - a rival's same-good
 * heap counts as a full tile (returns 0, the load walks on), so a drop never feeds the other side. A
 * compatible merge leaves the heap's owner untouched, so an owned settler topping up a NEUTRAL heap
 * keeps it neutral (fetchable by either side).
 */
export function stackOntoTile(
  world: World,
  x: Fixed,
  y: Fixed,
  good: number,
  want: number,
  owner: number | undefined,
): number {
  if (want <= 0) return 0;
  const at = nodeOfPosition(x, y);
  for (const e of stockpilesAtNode(world, at.hx, at.hy)) {
    if (!isYardHeap(world, e)) continue;
    const stock = world.get(e, Stockpile);
    const pos = world.get(e, Position);
    if (pos.x !== x || pos.y !== y) continue; // the same node, a different exact Position
    if (!ownersCompatible(owner, ownerOf(world, e))) return 0; // a rival's heap - never merge across sides
    // Skip a tile occupied by a different good; a heap of our good (even one drained to 0 by a porter and not
    // yet reaped) is stackable - testing the stocked good, not `size`, is what keeps a re-fill from livelocking
    // against a stale zero entry.
    const other = lowestStockedGood(stock);
    if (other !== null && other !== good) return 0;
    const have = stock.amounts.get(good) ?? 0;
    const placed = Math.min(MAX_GROUND_STACK - have, want);
    if (placed <= 0) return 0; // this tile is full for the good
    setStockAmount(world, e, good, have + placed);
    return placed;
  }
  // No heap on this tile yet - start one with up to a full stack.
  const placed = Math.min(MAX_GROUND_STACK, want);
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[good, placed]]) });
  stampOwner(world, pile, owner);
  return placed;
}

/**
 * Set ONE unit of `good` down on the tile at exactly `(x, y)` without ever losing it: stack onto the
 * tile's own heap when it takes the unit ({@link stackOntoTile}), else start a second owned heap beside
 * it - the tile's heap refuses when it is full, holds another good, or belongs to a rival. Two heaps on
 * one tile is a supported state (they render as one pile and each is pickable), so this trades a
 * cosmetic overlap for goods conservation. One unit only, because that is what the single caller sheds:
 * a good leaving an equipment slot with no carrier to hold it (see
 * {@link import('../../../../orders/work/employment.js')}). A multi-unit set-down would have to spill the
 * remainder across rings the way {@link dropCarriedLoad} does.
 */
export function placeUnitOnTile(
  world: World,
  x: Fixed,
  y: Fixed,
  good: number,
  owner: number | undefined,
): void {
  if (stackOntoTile(world, x, y, good, 1, owner) > 0) return;
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[good, 1]]) });
  stampOwner(world, pile, owner);
}

/**
 * Reap a loose ground pile once a pickup or an eaten bite has emptied it, so a long game doesn't accrete a
 * dead heap per felled tree or delivered load. A loose pile is any positioned {@link Stockpile} that is not a persistent store - a
 * {@link Building} warehouse and a {@link Vehicle} hull both keep their empty stock and are left alone. This
 * covers a felled/dropped {@link GroundDrop} trunk and a bare gatherer-yard / player-dropped heap (which
 * carries no marker): an emptied yard tile vanishes instead of lingering as a zero heap that would mis-render
 * as a flag and read as "free but unfillable" to the yard scan. The emptiness test reads `amounts` for a pure
 * "holds nothing" predicate (not an order-dependent choice), so raw Map iteration is fine. No-op for a
 * persistent store / a still-stocked pile. (A delivery flag has no `Stockpile`, so it never reaches here.)
 */
export function reapEmptyLoosePile(world: World, pile: Entity): void {
  if (world.has(pile, Building) || world.has(pile, Vehicle)) return; // a persistent store - keep it empty
  const stock = world.tryGet(pile, Stockpile);
  if (stock === undefined) return;
  for (const amount of stock.amounts.values()) if (amount > 0) return; // still holds something
  world.destroy(pile);
}
