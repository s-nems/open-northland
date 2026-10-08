import type { ContentSet } from '@open-northland/data';
import {
  type EntitySnapshot,
  indexesOf,
  type SnapshotIndexSpec,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { GIVE_SWITCH_GOODS, type GiveSwitchId, GRANT_IDS } from '../game/assistant-grant-ids.js';
import { isAdult, isFemale, isSettler, num, ownerPlayerOf, settlerJobType } from '../game/snapshot.js';

/** How many of a seat's men a give switch would still dress: those in the switch's pool (the working
 *  trades for a tool, every grown man otherwise) holding none of its goods, and the soldiers among them. */
export interface AssistantShortage {
  readonly lacking: number;
  readonly soldiersLacking: number;
}
export type AssistantShortages = Readonly<Record<GiveSwitchId, AssistantShortage>>;

/** Per job, the grown men of one seat and, per good, how many of them carry it; a man carrying two goods
 *  of one switch (both bottle sizes) is counted under each. */
interface SeatTally {
  readonly men: Map<number, number>;
  readonly held: Map<number, Map<number, number>>;
}
type GearTallies = Map<number, SeatTally>;

const GIVE_SWITCH_IDS = GRANT_IDS.filter((id): id is GiveSwitchId => id in GIVE_SWITCH_GOODS);
const NO_SHORTAGE: AssistantShortage = { lacking: 0, soldiersLacking: 0 };
export const NO_SHORTAGES: AssistantShortages = Object.fromEntries(
  GIVE_SWITCH_IDS.map((id) => [id, NO_SHORTAGE]),
) as Record<GiveSwitchId, AssistantShortage>;

/** The goods a grown man carries in the slots the assistant fills: boots, tool and the misc row. */
function carriedGoods(e: EntitySnapshot): number[] {
  const eq = e.components.Equipment as { boots?: unknown; tool?: unknown; misc?: unknown } | undefined;
  if (eq === undefined) return [];
  const goods: number[] = [];
  const slots = [eq.boots, eq.tool, ...(Array.isArray(eq.misc) ? eq.misc : [])];
  for (const slot of slots) {
    const good = num((slot as { goodType?: unknown } | null | undefined)?.goodType);
    if (good !== undefined) goods.push(good);
  }
  return goods;
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
    seat = { men: new Map(), held: new Map() };
    state.set(man.owner, seat);
  }
  bump(seat.men, man.job, by);
  for (const good of carriedGoods(e)) {
    let holders = seat.held.get(good);
    if (holders === undefined) {
      holders = new Map();
      seat.held.set(good, holders);
    }
    bump(holders, man.job, by);
    if (holders.size === 0) seat.held.delete(good);
  }
  if (seat.men.size === 0) state.delete(man.owner);
}

/** The grown men of every seat by trade and by the goods they carry, kept per change; what a switch would
 *  dress is read off it against the content's trades, so the index itself knows no content. */
const GEAR_TALLIES: SnapshotIndexSpec<GearTallies> = {
  name: 'assistant gear tallies',
  reads: { values: ['Equipment', 'Settler', 'Owner'], presence: ['Female', 'Age'] },
  empty: () => new Map(),
  add: (state, e) => tally(state, e, 1),
  remove: (state, e) => tally(state, e, -1),
};

export function gearTalliesOf(snapshot: WorldSnapshot): GearTallies {
  return indexesOf(snapshot).get(GEAR_TALLIES);
}

/** The jobs of a switch's pools: every dressed trade (a hero keeps the arms its job carries), the soldiers
 *  among them, and the trades a tool helps; memoized per content. */
interface JobPools {
  readonly men: readonly number[];
  readonly soldiers: readonly number[];
  readonly trades: readonly number[];
}
const jobPoolMemo = new WeakMap<ContentSet, JobPools>();

function jobPoolsOf(content: ContentSet): JobPools {
  let pools = jobPoolMemo.get(content);
  if (pools === undefined) {
    const men = content.jobs.map((j) => j.typeId).filter((job) => !systems.isHeroJob(content, job));
    pools = {
      men,
      soldiers: men.filter((job) => systems.isFighterJob(content, job)),
      trades: men.filter((job) => systems.toolHelpsJob(content, job)),
    };
    jobPoolMemo.set(content, pools);
  }
  return pools;
}

const sum = (counts: Map<number, number> | undefined, jobs: readonly number[]): number =>
  counts === undefined ? 0 : jobs.reduce((total, job) => total + (counts.get(job) ?? 0), 0);

/** What each give switch of `seat` would still dress, off the gear tallies; nothing for no seat. */
export function assistantShortagesOf(
  snapshot: WorldSnapshot,
  content: ContentSet,
  goodTypeOf: (goodId: string) => number | undefined,
  seat: number | null,
): AssistantShortages {
  const tallies = seat === null ? undefined : gearTalliesOf(snapshot).get(seat);
  if (tallies === undefined) return NO_SHORTAGES;
  const pools = jobPoolsOf(content);
  const shortages: Partial<Record<GiveSwitchId, AssistantShortage>> = {};
  for (const id of GIVE_SWITCH_IDS) {
    const goods = GIVE_SWITCH_GOODS[id].flatMap((slug) => {
      const good = goodTypeOf(slug);
      return good === undefined ? [] : [good];
    });
    const lackingAmong = (jobs: readonly number[]): number =>
      Math.max(
        0,
        sum(tallies.men, jobs) - goods.reduce((n, good) => n + sum(tallies.held.get(good), jobs), 0),
      );
    const isTool = id === 'giveWoodenTools' || id === 'giveIronTools';
    shortages[id] = {
      lacking: lackingAmong(isTool ? pools.trades : pools.men),
      soldiersLacking: isTool ? 0 : lackingAmong(pools.soldiers),
    };
  }
  return shortages as AssistantShortages;
}
