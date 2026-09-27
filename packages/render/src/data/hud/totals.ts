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

/** One player's running figures, kept per change by {@link HUD_TOTALS}. */
interface PlayerTotals {
  population: number;
  /** Head-counts by job; a job nobody holds is absent. */
  readonly jobs: Map<number, JobTally>;
  /** Units by good in the player's own piles, upgrade stashes and hands; a zero total is absent. */
  readonly owned: Map<number, number>;
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

interface HudTotals {
  readonly players: Map<number, PlayerTotals>;
  /** Every ownerless positioned stockpile, by entity id. */
  readonly heaps: Map<number, GroundHeap>;
}

/** The figures {@link hudTotalsOf} hands out, read-only. */
export interface PlayerHudTotals {
  readonly population: number;
  readonly jobs: ReadonlyMap<number, Readonly<JobTally>>;
  readonly owned: ReadonlyMap<number, number>;
  readonly heapStock: ReadonlyMap<number, number>;
}

const ADD = 1;
const SUBTRACT = -1;
type Sign = typeof ADD | typeof SUBTRACT;

/** The components each part of an entity's contribution reads; a replacement that keeps all of a
 *  part's objects leaves that part alone, since an unchanged component keeps its clone. */
const ANCHOR_READS = ['Owner', 'Position', 'Signpost', 'Building'] as const;
const PERSON_READS = ['Owner', 'Person', 'Settler', 'Female'] as const;
const OWNED_STOCK_READS = ['Owner', 'Stockpile', 'Upgrading', 'Carrying'] as const;
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

function playerTotals(state: HudTotals, player: number): PlayerTotals {
  let totals = state.players.get(player);
  if (totals === undefined) {
    totals = {
      population: 0,
      jobs: new Map(),
      owned: new Map(),
      anchors: new Map(),
      heapStock: new Map(),
      inReach: null,
      reachStale: false,
    };
    state.players.set(player, totals);
  }
  return totals;
}

function adjust(totals: Map<number, number>, goodType: number, amount: number): void {
  const next = (totals.get(goodType) ?? 0) + amount;
  if (next === 0) totals.delete(goodType);
  else totals.set(goodType, next);
}

function adjustPairs(totals: Map<number, number>, pairs: AmountPairs, sign: Sign): void {
  for (const [goodType, amount] of pairs) adjust(totals, goodType, sign * amount);
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
function countAnchor(state: HudTotals, anchor: AnchorAt, sign: Sign): void {
  const totals = playerTotals(state, anchor.player);
  const held = totals.anchors.get(anchor.key);
  if (sign === ADD) {
    if (held !== undefined) held.count++;
    else {
      totals.anchors.set(anchor.key, { node: anchor.node, count: 1 });
      totals.reachStale = true;
    }
  } else if (held !== undefined) {
    held.count--;
    if (held.count === 0) {
      totals.anchors.delete(anchor.key);
      totals.reachStale = true;
    }
  }
}

/** The `Person` marker is the sim's own population query key, so wildlife and a claimed animal are
 *  left out the same way. */
function countPerson(state: HudTotals, components: Components, sign: Sign): void {
  const player = ownerOf(components);
  if (player === undefined || !('Person' in components)) return;
  const totals = playerTotals(state, player);
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
}

/** An owned pile is a building's or a boat hull's; the ground never carries an owner. */
function countOwnedStock(state: HudTotals, components: Components, sign: Sign): void {
  const player = ownerOf(components);
  if (player === undefined) return;
  const piled = readStockpileAmounts(components);
  const upgrading = components.Upgrading as { savedStock?: unknown } | undefined;
  const saved = upgrading === undefined ? [] : readAmountPairs(upgrading.savedStock);
  const carriedGood = readNumField(components, 'Carrying', 'goodType');
  const carriedAmount = readNumField(components, 'Carrying', 'amount');
  const carries = carriedGood !== undefined && carriedAmount !== undefined;
  if (piled.length === 0 && saved.length === 0 && !carries) return;
  const owned = playerTotals(state, player).owned;
  adjustPairs(owned, piled, sign);
  adjustPairs(owned, saved, sign);
  if (carries) adjust(owned, carriedGood, sign * carriedAmount);
}

/** A heap on the ground belongs to nobody; the players whose anchors reach it count it. */
function heapOf(components: Components): GroundHeap | null {
  if (ownerOf(components) !== undefined || !('Stockpile' in components)) return null;
  const node = nodeOf(components);
  return node === null ? null : { node, amounts: readStockpileAmounts(components) };
}

function countHeap(state: HudTotals, heap: GroundHeap, sign: Sign): void {
  for (const totals of state.players.values()) {
    if (totals.reachStale || totals.inReach === null || !totals.inReach(heap.node)) continue;
    adjustPairs(totals.heapStock, heap.amounts, sign);
  }
}

function addHeap(state: HudTotals, id: number, components: Components): void {
  const heap = heapOf(components);
  if (heap === null) return;
  state.heaps.set(id, heap);
  countHeap(state, heap, ADD);
}

function removeHeap(state: HudTotals, id: number): void {
  const heap = state.heaps.get(id);
  if (heap === undefined) return;
  state.heaps.delete(id);
  countHeap(state, heap, SUBTRACT);
}

function count(state: HudTotals, entity: EntitySnapshot, sign: Sign): void {
  const components = entity.components;
  const anchor = anchorOf(components);
  if (anchor !== null) countAnchor(state, anchor, sign);
  countPerson(state, components, sign);
  countOwnedStock(state, components, sign);
  if (sign === ADD) addHeap(state, entity.id, components);
  else removeHeap(state, entity.id);
}

/** Every player's HUD figures, kept per change over one snapshot lineage. */
const HUD_TOTALS: SnapshotIndexSpec<HudTotals> = {
  name: 'HUD totals',
  empty: () => ({ players: new Map(), heaps: new Map() }),
  add: (state, entity) => count(state, entity, ADD),
  remove: (state, entity) => count(state, entity, SUBTRACT),
  replace: (state, previous, next) => {
    const was = previous.components;
    const is = next.components;
    if (!sameReads(was, is, ANCHOR_READS)) {
      const before = anchorOf(was);
      const after = anchorOf(is);
      if (before?.player !== after?.player || before?.key !== after?.key) {
        if (before !== null) countAnchor(state, before, SUBTRACT);
        if (after !== null) countAnchor(state, after, ADD);
      }
    }
    if (!sameReads(was, is, PERSON_READS)) {
      countPerson(state, was, SUBTRACT);
      countPerson(state, is, ADD);
    }
    if (!sameReads(was, is, OWNED_STOCK_READS)) {
      countOwnedStock(state, was, SUBTRACT);
      countOwnedStock(state, is, ADD);
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
      const heldTotals = held.players.get(player) ?? UNCOUNTED;
      const where = playerDifference(player, heldTotals, fresh, fresh.players.get(player) ?? UNCOUNTED);
      if (where !== null) return where;
    }
    return null;
  },
};

/** A player the state never counted reads as one whose counts all went back to nothing. */
const UNCOUNTED: PlayerTotals = {
  population: 0,
  jobs: new Map(),
  owned: new Map(),
  anchors: new Map(),
  heapStock: new Map(),
  inReach: null,
  reachStale: false,
};

/** The counts compare as kept; the heap total only once the held side settled it, against the fresh
 *  side settled now, since both are derived on read. */
function playerDifference(
  player: number,
  held: PlayerTotals,
  fresh: HudTotals,
  freshTotals: PlayerTotals,
): string | null {
  const at = `player ${player}`;
  if (held.population !== freshTotals.population) return `${at} population`;
  const counts =
    firstDifference(held.jobs, freshTotals.jobs, `${at} jobs`) ??
    firstDifference(held.owned, freshTotals.owned, `${at} owned`) ??
    firstDifference(held.anchors, freshTotals.anchors, `${at} anchors`);
  if (counts !== null || held.reachStale) return counts;
  if (freshTotals.reachStale) settleReach(fresh, freshTotals);
  return firstDifference(held.heapStock, freshTotals.heapStock, `${at} heap stock`);
}

/** Derive a stale player's reach and heap total again from every heap: once per anchor change. */
function settleReach(state: HudTotals, totals: PlayerTotals): void {
  totals.reachStale = false;
  totals.heapStock.clear();
  totals.inReach =
    totals.anchors.size === 0 ? null : heapReach([...totals.anchors.values()].map((a) => a.node));
  const inReach = totals.inReach;
  if (inReach === null) return;
  for (const heap of state.heaps.values()) {
    if (inReach(heap.node)) adjustPairs(totals.heapStock, heap.amounts, ADD);
  }
}

/** `player`'s maintained HUD figures over `snapshot`, or undefined for a player owning nothing. */
export function hudTotalsOf(snapshot: WorldSnapshot, player: number): PlayerHudTotals | undefined {
  const state = indexesOf(snapshot).get(HUD_TOTALS);
  const totals = state.players.get(player);
  if (totals?.reachStale) settleReach(state, totals);
  return totals;
}
