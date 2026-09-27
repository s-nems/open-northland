import {
  type EntitySnapshot,
  type Fixed,
  firstDifference,
  type HalfCellNode,
  heapReach,
  IDLE_JOB,
  indexesOf,
  nodeOfPosition,
  type SnapshotIndexSpec,
  type WorldSnapshot,
} from '@open-northland/sim';
import { readAmountPairs, readNumField, readPosition, readStockpileAmounts } from '../snapshot/index.js';

type Components = Readonly<Record<string, unknown>>;
type AmountPairs = readonly (readonly [number, number])[];

interface JobTally {
  count: number;
  female: number;
}

interface Anchor {
  readonly node: HalfCellNode;
  count: number;
}

/** One player's people, kept per change by {@link HUD_PEOPLE}; a player with nobody is absent. */
interface People {
  population: number;
  /** Head-counts by job; a job nobody holds is absent. */
  readonly jobs: Map<number, JobTally>;
}

/** One player's reach over the ground heaps, kept per change by {@link HUD_REACH}. */
interface Reach {
  /** The half-cell nodes of the player's signposts and buildings, by {@link nodeKey}, with how many
   *  stand on each. */
  readonly anchors: Map<string, Anchor>;
  /** Units by good in the ground heaps within `inReach`; a zero total is absent. */
  readonly heapStock: Map<number, number>;
  /** The reach over `anchors`, null with none. */
  inReach: ((node: HalfCellNode) => boolean) | null;
  /** The anchors changed after `inReach` and `heapStock` were derived. Heap changes skip the player
   *  until a read derives both again, so a burst of placements costs one pass over the heaps. */
  reachStale: boolean;
}

interface GroundHeap {
  readonly node: HalfCellNode;
  readonly amounts: AmountPairs;
}

interface HudReach {
  readonly players: Map<number, Reach>;
  /** Every ownerless positioned stockpile, by entity id. */
  readonly heaps: Map<number, GroundHeap>;
}

/** The figures {@link hudTotalsOf} hands out, read-only. */
export interface PlayerHudTotals {
  readonly population: number;
  readonly jobs: ReadonlyMap<number, Readonly<JobTally>>;
  /** Units by good in the player's own piles, upgrade stashes and hands; a zero total is absent. */
  readonly owned: ReadonlyMap<number, number>;
  readonly heapStock: ReadonlyMap<number, number>;
}

const ADD = 1;
const SUBTRACT = -1;
type Sign = typeof ADD | typeof SUBTRACT;

/** The components each part of the reach reads; a replacement that keeps all of a part's objects
 *  leaves that part alone, since an unchanged component keeps its clone. */
const ANCHOR_READS = ['Owner', 'Position', 'Signpost', 'Building'] as const;
const HEAP_READS = ['Owner', 'Stockpile', 'Position'] as const;

function sameReads(was: Components, is: Components, names: readonly string[]): boolean {
  for (const name of names) {
    if (was[name] !== is[name]) return false;
  }
  return true;
}

function ownerOf(components: Components): number | undefined {
  return readNumField(components, 'Owner', 'player');
}

/** A person's job (`Settler.jobType`), or `IDLE_JOB` when it has none. A job id of 0 is valid, so idle
 *  is detected by type, never by a falsy test. */
function jobTypeOf(components: Components): number {
  return readNumField(components, 'Settler', 'jobType') ?? IDLE_JOB;
}

/**
 * The half-cell node under an entity's `Position`, or null for one that stands nowhere. The cast is
 * the one place `render` names the snapshot's positions as fixed-point: `PositionValue` redeclares
 * the shape as plain numbers so this package does not reach into sim internals, and the sim writes
 * nothing but `Fixed` into it.
 */
function nodeOf(components: Components): HalfCellNode | null {
  const p = readPosition(components);
  return p === null ? null : nodeOfPosition(p.x as Fixed, p.y as Fixed);
}

function nodeKey(node: HalfCellNode): string {
  return `${node.hx}:${node.hy}`;
}

function adjust(totals: Map<number, number>, goodType: number, amount: number): void {
  const next = (totals.get(goodType) ?? 0) + amount;
  if (next === 0) totals.delete(goodType);
  else totals.set(goodType, next);
}

function adjustPairs(totals: Map<number, number>, pairs: AmountPairs, sign: Sign): void {
  for (const [goodType, amount] of pairs) adjust(totals, goodType, sign * amount);
}

/** The `Person` marker is the sim's own population query key, so wildlife and a claimed animal are
 *  left out the same way. */
function countPerson(people: Map<number, People>, components: Components, sign: Sign): void {
  const player = ownerOf(components);
  if (player === undefined || !('Person' in components)) return;
  let totals = people.get(player);
  if (totals === undefined) {
    totals = { population: 0, jobs: new Map() };
    people.set(player, totals);
  }
  totals.population += sign;
  const jobType = jobTypeOf(components);
  let tally = totals.jobs.get(jobType);
  if (tally === undefined) {
    tally = { count: 0, female: 0 };
    totals.jobs.set(jobType, tally);
  }
  tally.count += sign;
  if ('Female' in components) tally.female += sign;
  if (tally.count === 0) totals.jobs.delete(jobType);
  if (totals.population === 0) people.delete(player);
}

/** A person counts by owner, job and sex, so a `Settler` rewrite that keeps the job (a need bar
 *  moving) leaves the tallies alone. */
function samePerson(was: Components, is: Components): boolean {
  return (
    was.Owner === is.Owner &&
    was.Person === is.Person &&
    was.Female === is.Female &&
    (was.Settler === is.Settler || jobTypeOf(was) === jobTypeOf(is))
  );
}

/** Every player's population and job tallies. */
const HUD_PEOPLE: SnapshotIndexSpec<Map<number, People>> = {
  name: 'HUD people',
  reads: { values: ['Owner', 'Settler'], presence: ['Person', 'Female'] },
  empty: () => new Map(),
  add: (people, entity) => countPerson(people, entity.components, ADD),
  remove: (people, entity) => countPerson(people, entity.components, SUBTRACT),
  replace: (people, previous, next) => {
    if (samePerson(previous.components, next.components)) return;
    countPerson(people, previous.components, SUBTRACT);
    countPerson(people, next.components, ADD);
  },
};

/** An owned pile is a building's or a boat hull's; the ground never carries an owner. */
function countOwnedStock(owned: Map<number, Map<number, number>>, components: Components, sign: Sign): void {
  const player = ownerOf(components);
  if (player === undefined) return;
  const piled = readStockpileAmounts(components);
  const upgrading = components.Upgrading as { savedStock?: unknown } | undefined;
  const saved = upgrading === undefined ? [] : readAmountPairs(upgrading.savedStock);
  const carriedGood = readNumField(components, 'Carrying', 'goodType');
  const carriedAmount = readNumField(components, 'Carrying', 'amount');
  const carries = carriedGood !== undefined && carriedAmount !== undefined;
  if (piled.length === 0 && saved.length === 0 && !carries) return;
  let totals = owned.get(player);
  if (totals === undefined) {
    totals = new Map();
    owned.set(player, totals);
  }
  adjustPairs(totals, piled, sign);
  adjustPairs(totals, saved, sign);
  if (carries) adjust(totals, carriedGood, sign * carriedAmount);
  if (totals.size === 0) owned.delete(player);
}

/** Every player's units by good in its own piles, upgrade stashes and hands; a player holding nothing
 *  is absent. */
const HUD_OWNED_STOCK: SnapshotIndexSpec<Map<number, Map<number, number>>> = {
  name: 'HUD owned stock',
  reads: { values: ['Owner', 'Stockpile', 'Upgrading', 'Carrying'] },
  empty: () => new Map(),
  add: (owned, entity) => countOwnedStock(owned, entity.components, ADD),
  remove: (owned, entity) => countOwnedStock(owned, entity.components, SUBTRACT),
  replace: (owned, previous, next) => {
    countOwnedStock(owned, previous.components, SUBTRACT);
    countOwnedStock(owned, next.components, ADD);
  },
};

function playerReach(state: HudReach, player: number): Reach {
  let reach = state.players.get(player);
  if (reach === undefined) {
    reach = { anchors: new Map(), heapStock: new Map(), inReach: null, reachStale: false };
    state.players.set(player, reach);
  }
  return reach;
}

interface AnchorAt {
  readonly player: number;
  readonly node: HalfCellNode;
  readonly key: string;
}

/** An owned signpost's or building's node: what the player's heap reach is drawn around. */
function anchorOf(components: Components): AnchorAt | null {
  const player = ownerOf(components);
  if (player === undefined || !('Signpost' in components || 'Building' in components)) return null;
  const node = nodeOf(components);
  return node === null ? null : { player, node, key: nodeKey(node) };
}

/** Only a node gained or lost stales the reach; a second anchor on a held node changes nothing. */
function countAnchor(state: HudReach, anchor: AnchorAt, sign: Sign): void {
  const reach = playerReach(state, anchor.player);
  const held = reach.anchors.get(anchor.key);
  if (sign === ADD) {
    if (held !== undefined) held.count++;
    else {
      reach.anchors.set(anchor.key, { node: anchor.node, count: 1 });
      reach.reachStale = true;
    }
  } else if (held !== undefined) {
    held.count--;
    if (held.count === 0) {
      reach.anchors.delete(anchor.key);
      reach.reachStale = true;
    }
  }
}

/** A heap on the ground belongs to nobody; the players whose anchors reach it count it. */
function heapOf(components: Components): GroundHeap | null {
  if (ownerOf(components) !== undefined || !('Stockpile' in components)) return null;
  const node = nodeOf(components);
  return node === null ? null : { node, amounts: readStockpileAmounts(components) };
}

function countHeap(state: HudReach, heap: GroundHeap, sign: Sign): void {
  for (const reach of state.players.values()) {
    if (reach.reachStale || reach.inReach === null || !reach.inReach(heap.node)) continue;
    adjustPairs(reach.heapStock, heap.amounts, sign);
  }
}

function addHeap(state: HudReach, id: number, components: Components): void {
  const heap = heapOf(components);
  if (heap === null) return;
  state.heaps.set(id, heap);
  countHeap(state, heap, ADD);
}

function removeHeap(state: HudReach, id: number): void {
  const heap = state.heaps.get(id);
  if (heap === undefined) return;
  state.heaps.delete(id);
  countHeap(state, heap, SUBTRACT);
}

/** Whether an entity may anchor a reach or lie as a heap: a walking settler never does. */
function anchorOrHeap(components: Components): boolean {
  return 'Signpost' in components || 'Building' in components || 'Stockpile' in components;
}

function countReach(state: HudReach, entity: EntitySnapshot, sign: Sign): void {
  const anchor = anchorOf(entity.components);
  if (anchor !== null) countAnchor(state, anchor, sign);
  if (sign === ADD) addHeap(state, entity.id, entity.components);
  else removeHeap(state, entity.id);
}

/** Every player's anchors and the ground heaps their reach covers. */
const HUD_REACH: SnapshotIndexSpec<HudReach> = {
  name: 'HUD reach',
  reads: { values: ['Owner', 'Position', 'Stockpile'], presence: ['Signpost', 'Building'] },
  empty: () => ({ players: new Map(), heaps: new Map() }),
  add: (state, entity) => countReach(state, entity, ADD),
  remove: (state, entity) => countReach(state, entity, SUBTRACT),
  replace: (state, previous, next) => {
    const was = previous.components;
    const is = next.components;
    if (!anchorOrHeap(was) && !anchorOrHeap(is)) return;
    if (!sameReads(was, is, ANCHOR_READS)) {
      const before = anchorOf(was);
      const after = anchorOf(is);
      if (before?.player !== after?.player || before?.key !== after?.key) {
        if (before !== null) countAnchor(state, before, SUBTRACT);
        if (after !== null) countAnchor(state, after, ADD);
      }
    }
    if (!sameReads(was, is, HEAP_READS)) {
      removeHeap(state, previous.id);
      addHeap(state, next.id, is);
    }
  },
  differs: (held, fresh) => {
    const heaps = firstDifference(held.heaps, fresh.heaps, 'heaps');
    if (heaps !== null) return heaps;
    for (const player of new Set([...held.players.keys(), ...fresh.players.keys()])) {
      const heldReach = held.players.get(player) ?? UNANCHORED;
      const where = reachDifference(player, heldReach, fresh, fresh.players.get(player) ?? UNANCHORED);
      if (where !== null) return where;
    }
    return null;
  },
};

/** A player the state never anchored reads as one whose anchors all went. */
const UNANCHORED: Reach = { anchors: new Map(), heapStock: new Map(), inReach: null, reachStale: false };

/** The anchors compare as kept; the heap total only once the held side settled it, against the fresh
 *  side settled now, since both are derived on read. */
function reachDifference(player: number, held: Reach, fresh: HudReach, freshReach: Reach): string | null {
  const at = `player ${player}`;
  const anchors = firstDifference(held.anchors, freshReach.anchors, `${at} anchors`);
  if (anchors !== null || held.reachStale) return anchors;
  if (freshReach.reachStale) settleReach(fresh, freshReach);
  return firstDifference(held.heapStock, freshReach.heapStock, `${at} heap stock`);
}

/** Derive a stale player's reach and heap total again from every heap: once per anchor change. */
function settleReach(state: HudReach, reach: Reach): void {
  reach.reachStale = false;
  reach.heapStock.clear();
  reach.inReach = reach.anchors.size === 0 ? null : heapReach([...reach.anchors.values()].map((a) => a.node));
  const inReach = reach.inReach;
  if (inReach === null) return;
  for (const heap of state.heaps.values()) {
    if (inReach(heap.node)) adjustPairs(reach.heapStock, heap.amounts, ADD);
  }
}

const NO_COUNTS: ReadonlyMap<number, never> = new Map<number, never>();

/** `player`'s maintained HUD figures over `snapshot`, or undefined for a player owning nothing. */
export function hudTotalsOf(snapshot: WorldSnapshot, player: number): PlayerHudTotals | undefined {
  const indexes = indexesOf(snapshot);
  const people = indexes.get(HUD_PEOPLE).get(player);
  const owned = indexes.get(HUD_OWNED_STOCK).get(player);
  const state = indexes.get(HUD_REACH);
  const reach = state.players.get(player);
  if (reach?.reachStale) settleReach(state, reach);
  if (people === undefined && owned === undefined && reach === undefined) return undefined;
  return {
    population: people?.population ?? 0,
    jobs: people?.jobs ?? NO_COUNTS,
    owned: owned ?? NO_COUNTS,
    heapStock: reach?.heapStock ?? NO_COUNTS,
  };
}
