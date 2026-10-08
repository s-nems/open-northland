import type { ContentSet } from '@open-northland/data';
import {
  type EntitySnapshot,
  indexesOf,
  type SnapshotIndexSpec,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { GIVE_SWITCH_GOODS, GIVE_SWITCH_IDS, type GiveSwitchId } from '../game/assistant-grant-ids.js';
import { isAdult, isFemale, isSettler, num, ownerPlayerOf, settlerJobType } from '../game/snapshot.js';

/** How many of a seat's men a give switch would still dress: those in the switch's pool (the working
 *  trades for a tool, every grown man otherwise) with room for its good and none of its goods carried,
 *  and the soldiers among them. */
export interface AssistantShortage {
  readonly lacking: number;
  readonly soldiersLacking: number;
}
export type AssistantShortages = Readonly<Record<GiveSwitchId, AssistantShortage>>;

/** The slots the assistant fills: the boots and tool slots, and the misc row with its several places. */
type FilledSlot = 'boots' | 'tool' | 'misc';
const FILLED_SLOTS: readonly FilledSlot[] = ['boots', 'tool', 'misc'];

/** Per job, the grown men of one seat with room in each slot, and per misc good, how many of those with
 *  room in the misc row carry it (a man whose row is full needs nothing more, carrier or not). A man
 *  carrying two goods of one switch (both bottle sizes) is counted under each. */
interface SeatTally {
  readonly open: Map<number, Record<FilledSlot, number>>;
  readonly heldOpen: Map<number, Map<number, number>>;
}
type GearTallies = Map<number, SeatTally>;

const NO_SHORTAGE: AssistantShortage = { lacking: 0, soldiersLacking: 0 };
export const NO_SHORTAGES: AssistantShortages = Object.fromEntries(
  GIVE_SWITCH_IDS.map((id) => [id, NO_SHORTAGE]),
) as Record<GiveSwitchId, AssistantShortage>;

const slotGood = (slot: unknown): number | undefined =>
  num((slot as { goodType?: unknown } | null | undefined)?.goodType);

/** Which of a grown man's slots have room, and the misc goods he carries beside a free misc place. */
function roomOf(e: EntitySnapshot): { open: Record<FilledSlot, boolean>; heldOpen: number[] } {
  const eq = e.components.Equipment as { boots?: unknown; tool?: unknown; misc?: unknown } | undefined;
  const misc = Array.isArray(eq?.misc) ? eq.misc : [];
  const miscOpen = eq === undefined || misc.some((slot) => slotGood(slot) === undefined);
  const heldOpen: number[] = [];
  if (miscOpen) {
    for (const slot of misc) {
      const good = slotGood(slot);
      if (good !== undefined) heldOpen.push(good);
    }
  }
  return {
    open: {
      boots: slotGood(eq?.boots) === undefined,
      tool: slotGood(eq?.tool) === undefined,
      misc: miscOpen,
    },
    heldOpen,
  };
}

/** A grown man with a trade, the only settler the assistant dresses, as `(owner, job)`; else undefined. */
function dressedMan(e: EntitySnapshot): { owner: number; job: number } | undefined {
  if (!isSettler(e) || isFemale(e) || !isAdult(e)) return undefined;
  const owner = ownerPlayerOf(e);
  const job = settlerJobType(e);
  return owner === undefined || job === undefined ? undefined : { owner, job };
}

function bump(counts: Map<number, number>, key: number, by: number): void {
  const left = (counts.get(key) ?? 0) + by;
  if (left === 0) counts.delete(key);
  else counts.set(key, left);
}

function tally(state: GearTallies, e: EntitySnapshot, by: number): void {
  const man = dressedMan(e);
  if (man === undefined) return;
  let seat = state.get(man.owner);
  if (seat === undefined) {
    seat = { open: new Map(), heldOpen: new Map() };
    state.set(man.owner, seat);
  }
  const room = roomOf(e);
  let open = seat.open.get(man.job);
  if (open === undefined) {
    open = { boots: 0, tool: 0, misc: 0 };
    seat.open.set(man.job, open);
  }
  for (const slot of FILLED_SLOTS) if (room.open[slot]) open[slot] += by;
  if (open.boots === 0 && open.tool === 0 && open.misc === 0) seat.open.delete(man.job);
  for (const good of room.heldOpen) {
    let holders = seat.heldOpen.get(good);
    if (holders === undefined) {
      holders = new Map();
      seat.heldOpen.set(good, holders);
    }
    bump(holders, man.job, by);
    if (holders.size === 0) seat.heldOpen.delete(good);
  }
  if (seat.open.size === 0 && seat.heldOpen.size === 0) state.delete(man.owner);
}

/** The grown men of every seat by trade, with room per slot and the misc goods carried beside room, kept
 *  per change; what a switch would dress is read off it against the content's trades, so the index itself
 *  knows no content. */
const GEAR_TALLIES: SnapshotIndexSpec<GearTallies> = {
  name: 'assistant gear tallies',
  reads: { values: ['Equipment', 'Settler', 'Owner'], presence: ['Female', 'Age'] },
  empty: () => new Map(),
  add: (state, e) => tally(state, e, 1),
  remove: (state, e) => tally(state, e, -1),
  // Most Equipment writes are wear (a step on the boots, a stroke of the tool) that moves no count.
  replace: (state, previous, next) => {
    if (sameTally(previous, next)) return;
    tally(state, previous, -1);
    tally(state, next, 1);
  },
};

function sameTally(a: EntitySnapshot, b: EntitySnapshot): boolean {
  const manA = dressedMan(a);
  const manB = dressedMan(b);
  if (manA === undefined || manB === undefined) return manA === manB;
  if (manA.owner !== manB.owner || manA.job !== manB.job) return false;
  const roomA = roomOf(a);
  const roomB = roomOf(b);
  return (
    FILLED_SLOTS.every((slot) => roomA.open[slot] === roomB.open[slot]) &&
    roomA.heldOpen.length === roomB.heldOpen.length &&
    roomA.heldOpen.every((good, i) => good === roomB.heldOpen[i])
  );
}

export function gearTalliesOf(snapshot: WorldSnapshot): GearTallies {
  return indexesOf(snapshot).get(GEAR_TALLIES);
}

/** The jobs of a switch's pools: every dressed trade (a hero keeps the arms its job carries), the soldiers
 *  among them, and the trades a tool helps; with the slot each wearable fills. Memoized per content. */
interface ContentPools {
  readonly men: readonly number[];
  readonly soldiers: readonly number[];
  readonly trades: readonly number[];
  readonly slotOfGood: ReadonlyMap<number, FilledSlot>;
}
const poolMemo = new WeakMap<ContentSet, ContentPools>();

function poolsOf(content: ContentSet): ContentPools {
  let pools = poolMemo.get(content);
  if (pools === undefined) {
    const men = content.jobs.map((j) => j.typeId).filter((job) => !systems.isHeroJob(content, job));
    const slotOfGood = new Map<number, FilledSlot>();
    for (const good of content.goods) {
      const category = good.equip?.category;
      if (category === 'boots' || category === 'tool' || category === 'misc')
        slotOfGood.set(good.typeId, category);
    }
    pools = {
      men,
      soldiers: men.filter((job) => systems.isFighterJob(content, job)),
      trades: men.filter((job) => systems.toolHelpsJob(content, job)),
      slotOfGood,
    };
    poolMemo.set(content, pools);
  }
  return pools;
}

const sum = (counts: Map<number, number> | undefined, jobs: readonly number[]): number =>
  counts === undefined ? 0 : jobs.reduce((total, job) => total + (counts.get(job) ?? 0), 0);

/** What each give switch of `seat` would still dress, off the gear tallies; nothing for no seat. A
 *  boots or tool switch dresses the men with that slot empty; a misc switch the men with a free misc
 *  place who carry none of its goods. */
export function assistantShortagesOf(
  snapshot: WorldSnapshot,
  content: ContentSet,
  goodTypeOf: (goodId: string) => number | undefined,
  seat: number | null,
): AssistantShortages {
  const tallies = seat === null ? undefined : gearTalliesOf(snapshot).get(seat);
  if (tallies === undefined) return NO_SHORTAGES;
  const pools = poolsOf(content);
  const shortages: Partial<Record<GiveSwitchId, AssistantShortage>> = {};
  for (const id of GIVE_SWITCH_IDS) {
    const goods = GIVE_SWITCH_GOODS[id].flatMap((slug) => {
      const good = goodTypeOf(slug);
      return good === undefined ? [] : [good];
    });
    // A switch whose goods the content lacks, or wear no slot the assistant fills, dresses nobody.
    const slot = goods[0] === undefined ? undefined : pools.slotOfGood.get(goods[0]);
    if (slot === undefined) {
      shortages[id] = NO_SHORTAGE;
      continue;
    }
    const lackingAmong = (jobs: readonly number[]): number => {
      let open = 0;
      for (const job of jobs) open += tallies.open.get(job)?.[slot] ?? 0;
      const carried =
        slot === 'misc' ? goods.reduce((n, good) => n + sum(tallies.heldOpen.get(good), jobs), 0) : 0;
      return Math.max(0, open - carried);
    };
    shortages[id] = {
      lacking: lackingAmong(slot === 'tool' ? pools.trades : pools.men),
      soldiersLacking: slot === 'tool' ? 0 : lackingAmong(pools.soldiers),
    };
  }
  return shortages as AssistantShortages;
}
