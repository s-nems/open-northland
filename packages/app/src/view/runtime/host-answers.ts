import type {
  Entity,
  OpenTribute,
  Paper,
  TradeOffer,
  TraderView,
  UnlockKind,
  UnlockStatus,
  WorkStatus,
} from '@open-northland/sim';
import { type BuildingAvailability, OPEN_AVAILABILITY } from '../../hud/tool-panel/building-menu.js';
import {
  WORK_STATUS_ASKS_PER_SWEEP,
  WORK_STATUS_REASK_SWEEPS,
  type WorkAnswer,
  type WorkStatusRead,
} from '../../hud/tool-panel/messages/work-asks.js';
import {
  type AnswerCacheControl,
  createLastAnswerCache,
  type LastAnswerCache,
  type LastAnswerCacheOptions,
  type SessionHost,
  samePlainData,
} from '../../session/index.js';
import type { DiplomacySimView } from '../projections/diplomacy-rows.js';

const LOCKED: BuildingAvailability = { kind: 'locked' };
const FORBIDDEN: BuildingAvailability = { kind: 'forbidden' };

/** A house's place in the construction window: banned entries are never listed, undiscovered ones
 *  wait at the end. */
function technologyAvailability(status: UnlockStatus): BuildingAvailability {
  if (!status.allowed) return FORBIDDEN;
  return status.enabled ? OPEN_AVAILABILITY : LOCKED;
}

const NO_OFFERS: readonly TradeOffer[] = [];
const NO_TRIBUTES: readonly OpenTribute[] = [];
const NO_PAPERS: readonly Paper[] = [];
const NO_PAGES: readonly number[] = [];
/** A read that follows the world tick by tick, as the sim answered it inline. */
const PER_TICK = true;
const NO_INPUTS = '';
/** Trade answers kept at once: the residents window's job filter asks for every grown man of a seat. */
const ROSTER_CAPACITY = 4096;
/** Diagnoses the notice sweeps keep: every ask of the last re-ask period, twice over, so an answer is
 *  never evicted before the sweep after its ask reads it. */
const NOTICE_STATUS_CAPACITY = 2 * WORK_STATUS_ASKS_PER_SWEEP * (WORK_STATUS_REASK_SWEEPS + 1);

/**
 * The host's request-shaped reads the HUD pulls synchronously, each the last answer the host gave and
 * asked again once a tick. Until a read's first answer lands it gives the empty or refusing value named
 * beside it, so a rule refuses rather than guesses; the inline host answers before the next frame. The
 * `ask*` rules are for clicks: they await the host's answer as of now.
 */
export interface HostAnswers {
  readonly diplomacyView: DiplomacySimView;
  /** Locked while unanswered. */
  readonly buildAvailability: (player: number, typeId: number, tribe: number) => BuildingAvailability;
  /** The tribes `player` may place houses of, its own first; its own alone while unanswered. The same
   *  array while the sim's list stands. */
  readonly buildTribes: (player: number) => readonly number[];
  /** Undefined while unanswered, which a reader takes as a refusal. */
  readonly technologyStatus: (
    kind: UnlockKind,
    typeId: number,
    tribe: number,
    player?: number,
  ) => UnlockStatus | undefined;
  readonly canChooseJob: (entity: number, jobType: number) => boolean;
  readonly askCanChooseJob: (entity: number, jobType: number) => Promise<boolean>;
  /** Versioned with the job choices, since the residents filter asks both of one row. */
  readonly hasEarnedGood: (entity: number, goodType: number) => boolean;
  readonly standsTo: (entity: number) => boolean;
  /** Undefined while unanswered, which leaves the status detail out. */
  readonly workStatus: (entity: number) => WorkStatus | undefined;
  /** The notice sweeps' own diagnoses, asked once per sweep tick rather than per tick, in a cache of
   *  their own so the panels' reads never push them out. */
  readonly noticeWorkStatus: WorkStatusRead;
  readonly traderView: (trader: number) => TraderView | undefined;
  readonly tradeOffersAt: (house: number) => readonly TradeOffer[];
  /** The pick highlights' rules, read off one answer per unit rather than one per building. */
  readonly canAttachTradeHouse: (trader: number, house: number) => boolean;
  readonly canAttachToVehicle: (settler: number, vehicle: number) => boolean;
  readonly askAttachTradeHouse: (trader: number, house: number) => Promise<boolean>;
  readonly askAttachToVehicle: (settler: number, vehicle: number) => Promise<boolean>;
  readonly papers: (player: number) => readonly Paper[];
  readonly missionBriefingHistory: () => readonly number[];
  readonly missionBriefingPage: () => number | null;
  readonly missionHuman: (missionId: number) => number | null;
  /** Each consumer's own version, bumped only when a read it takes answers differently. */
  readonly versions: {
    /** The details panel: technology, battle alert, work status, trader and house offers. */
    readonly unitPanel: () => number;
    readonly technology: () => number;
    readonly attachPicks: () => number;
    readonly jobChoices: () => number;
    readonly mission: () => number;
  };
  /** Resolves once no read is in flight, for a consumer that must not start on an unanswered read. */
  readonly settled: () => Promise<void>;
  dispose(): void;
}

function sameIds(held: ReadonlySet<number>, landed: ReadonlySet<number>): boolean {
  if (held.size !== landed.size) return false;
  for (const id of landed) if (!held.has(id)) return false;
  return true;
}

export function createHostAnswers(host: SessionHost, tribeOf: (player: number) => number): HostAnswers {
  const caches: AnswerCacheControl[] = [];
  const cache = <V>(options: Omit<LastAnswerCacheOptions<V>, 'tick'> = {}): LastAnswerCache<V> => {
    const created = createLastAnswerCache<V>({ tick: () => host.tick, ...options });
    caches.push(created);
    return created;
  };
  const locks = cache<boolean>();
  const counts = cache<number>();
  const offersOf = cache<readonly TradeOffer[]>({ same: samePlainData });
  const offersAt = cache<readonly TradeOffer[]>({ same: samePlainData });
  const tributes = cache<readonly OpenTribute[]>({ same: samePlainData });
  const availabilities = cache<BuildingAvailability>();
  const tribeLists = cache<readonly number[]>({ same: samePlainData });
  const ownTribeOnly = new Map<number, readonly number[]>();
  const ownTribe = (player: number): readonly number[] => {
    let only = ownTribeOnly.get(player);
    if (only === undefined) {
      only = [tribeOf(player)];
      ownTribeOnly.set(player, only);
    }
    return only;
  };
  const statuses = cache<UnlockStatus>({ same: samePlainData });
  const stands = cache<boolean>();
  const workStatuses = cache<WorkStatus | undefined>({ same: samePlainData });
  const noticeStatuses = cache<WorkAnswer>({ capacity: NOTICE_STATUS_CAPACITY, same: samePlainData });
  const jobChoices = cache<boolean>({ capacity: ROSTER_CAPACITY });
  const traders = cache<TraderView | undefined>({ same: samePlainData });
  const tradeHouses = cache<ReadonlySet<number>>({ same: sameIds });
  const vehicles = cache<ReadonlySet<number>>({ same: sameIds });
  const papers = cache<readonly Paper[]>({ same: samePlainData });
  const pages = cache<readonly number[]>({ same: samePlainData });
  const missionEntities = cache<number | null>();

  const perTick = <V>(held: LastAnswerCache<V>, key: string, ask: () => Promise<V>): V | undefined =>
    held.read(key, ask, NO_INPUTS, PER_TICK);
  const tradeHousesOf = (trader: number) => (): Promise<ReadonlySet<number>> =>
    host.tradeHousesAttachableBy(trader as Entity).then((ids) => new Set(ids));
  const vehiclesOf = (settler: number) => (): Promise<ReadonlySet<number>> =>
    host.vehiclesAttachableBy(settler as Entity).then((ids) => new Set(ids));

  return {
    diplomacyView: {
      hasMetPlayer: (viewer, other) => host.hasMetPlayer(viewer, other),
      diplomacyStance: (from, to) => host.diplomacyStance(from, to),
      diplomacyLocked: (a, b) => perTick(locks, `${a}:${b}`, () => host.diplomacyLocked(a, b)),
      goodsTradedWith: (player, partner) =>
        perTick(counts, `${player}:${partner}`, () => host.goodsTradedWith(player, partner)) ?? 0,
      tradeOffersOf: (partner) =>
        perTick(offersOf, `${partner}`, () => host.tradeOffersOf(partner)) ?? NO_OFFERS,
      openTributes: (payer) => perTick(tributes, `${payer}`, () => host.openTributes(payer)) ?? NO_TRIBUTES,
    },
    // Kept as availability, not as status: the construction window pulls every entry every frame.
    buildAvailability: (player, typeId, tribe) =>
      perTick(availabilities, `${player}:${tribe}:${typeId}`, () =>
        host.unlockStatus('house', typeId, tribe, player).then(technologyAvailability),
      ) ?? LOCKED,
    buildTribes: (player) =>
      perTick(tribeLists, `${player}`, () => host.buildTribes(player)) ?? ownTribe(player),
    technologyStatus: (kind, typeId, tribe, player) =>
      perTick(statuses, `${kind}:${typeId}:${tribe}:${player ?? ''}`, () =>
        host.unlockStatus(kind, typeId, tribe, player),
      ),
    canChooseJob: (entity, jobType) =>
      perTick(jobChoices, `${entity}:${jobType}`, () => host.canChooseJob(entity as Entity, jobType)) ===
      true,
    hasEarnedGood: (entity, goodType) =>
      perTick(jobChoices, `good:${entity}:${goodType}`, () =>
        host.hasEarnedGood(entity as Entity, goodType),
      ) === true,
    askCanChooseJob: (entity, jobType) =>
      jobChoices.fresh(
        `${entity}:${jobType}`,
        () => host.canChooseJob(entity as Entity, jobType),
        NO_INPUTS,
        PER_TICK,
      ),
    standsTo: (entity) => perTick(stands, `${entity}`, () => host.standsTo(entity as Entity)) === true,
    workStatus: (entity) => perTick(workStatuses, `${entity}`, () => host.workStatus(entity as Entity)),
    noticeWorkStatus: (entity, asked) =>
      noticeStatuses.read(
        `${entity}`,
        () => host.workStatus(entity as Entity).then((status) => ({ status, asked })),
        `${asked}`,
      ),
    traderView: (trader) => perTick(traders, `${trader}`, () => host.traderView(trader as Entity)),
    tradeOffersAt: (house) =>
      perTick(offersAt, `${house}`, () => host.tradeOffersAt(house as Entity)) ?? NO_OFFERS,
    canAttachTradeHouse: (trader, house) =>
      perTick(tradeHouses, `${trader}`, tradeHousesOf(trader))?.has(house) === true,
    canAttachToVehicle: (settler, vehicle) =>
      perTick(vehicles, `${settler}`, vehiclesOf(settler))?.has(vehicle) === true,
    askAttachTradeHouse: (trader, house) =>
      tradeHouses
        .fresh(`${trader}`, tradeHousesOf(trader), NO_INPUTS, PER_TICK)
        .then((ids) => ids.has(house)),
    askAttachToVehicle: (settler, vehicle) =>
      vehicles.fresh(`${settler}`, vehiclesOf(settler), NO_INPUTS, PER_TICK).then((ids) => ids.has(vehicle)),
    papers: (player) => perTick(papers, `${player}`, () => host.papers(player)) ?? NO_PAPERS,
    missionBriefingHistory: () => perTick(pages, 'history', () => host.missionBriefingHistory()) ?? NO_PAGES,
    missionBriefingPage: () => perTick(missionEntities, 'page', () => host.missionBriefingPage()) ?? null,
    missionHuman: (missionId) =>
      perTick(missionEntities, `human:${missionId}`, () => host.missionHuman(missionId)) ?? null,
    versions: {
      unitPanel: () =>
        statuses.version + stands.version + workStatuses.version + traders.version + offersAt.version,
      technology: () => statuses.version,
      attachPicks: () => tradeHouses.version + vehicles.version,
      jobChoices: () => jobChoices.version,
      mission: () => pages.version + missionEntities.version,
    },
    settled: () => Promise.all(caches.map((held) => held.settled())).then(() => undefined),
    dispose: () => {
      for (const held of caches) held.dispose();
    },
  };
}
