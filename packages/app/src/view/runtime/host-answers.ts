import type { EquipCategory } from '@open-northland/data';
import type {
  Entity,
  EquipPickEntry,
  OpenTribute,
  Paper,
  SimEvent,
  TradeOffer,
  TraderView,
  UnlockKind,
  UnlockStatus,
} from '@open-northland/sim';
import { type BuildingAvailability, OPEN_AVAILABILITY } from '../../hud/tool-panel/building-menu.js';
import {
  type AnswerCacheControl,
  createLastAnswerCache,
  type LastAnswerCache,
  type SessionHost,
} from '../../session/index.js';
import type { DiplomacySimView } from '../projections/diplomacy-rows.js';

/** A house's place in the construction window: banned entries are never listed, undiscovered ones
 *  wait at the end. */
function technologyAvailability(status: UnlockStatus): BuildingAvailability {
  if (!status.allowed) return { kind: 'forbidden' };
  return status.enabled ? OPEN_AVAILABILITY : { kind: 'locked' };
}

const LOCKED: BuildingAvailability = { kind: 'locked' };
const NO_OFFERS: readonly TradeOffer[] = [];
const NO_TRIBUTES: readonly OpenTribute[] = [];
const NO_PAPERS: readonly Paper[] = [];
const NO_PAGES: readonly number[] = [];
const NO_PICKS: readonly EquipPickEntry[] = [];
/** The kind prefix of the script's events. */
const MISSION_EVENT_PREFIX = 'mission';
/** A read that follows the world tick by tick, as the sim answered it inline. */
const PER_TICK = true;
const NO_INPUTS = '';
/** Trade answers kept at once: the residents window's job filter asks for every grown man of a seat. */
const ROSTER_CAPACITY = 4096;

/**
 * The host's request-shaped reads the HUD pulls synchronously, each the last answer the host gave and
 * asked again once a tick. Until a read's first answer lands it gives the empty or refusing value named
 * beside it, so a rule refuses rather than guesses.
 */
export interface HostAnswers {
  readonly diplomacyView: DiplomacySimView;
  /** Locked while unanswered. */
  readonly buildAvailability: (player: number, typeId: number) => BuildingAvailability;
  /** Undefined while unanswered. */
  readonly technologyStatus: (
    kind: UnlockKind,
    typeId: number,
    tribe: number,
    player?: number,
  ) => UnlockStatus | undefined;
  readonly canChooseJob: (entity: number, jobType: number) => boolean;
  readonly equipPickList: (entity: number, group: EquipCategory) => readonly EquipPickEntry[];
  readonly standsTo: (entity: number) => boolean;
  readonly traderView: (trader: number) => TraderView | undefined;
  readonly tradeOffersAt: (house: number) => readonly TradeOffer[];
  readonly canAttachTradeHouse: (trader: number, house: number) => boolean;
  readonly canAttachToVehicle: (settler: number, vehicle: number) => boolean;
  readonly papers: (player: number) => readonly Paper[];
  /** The mission reads change only through the script, so they are asked again after its events rather
   *  than every tick. */
  readonly missionBriefingHistory: () => readonly number[];
  readonly missionBriefingPage: () => number | null;
  readonly missionHuman: (missionId: number) => number | null;
  /** Feed every stepped tick's events, before anything reacts to them. */
  readonly onEvents: (events: readonly SimEvent[]) => void;
  /** Bumped by every answer that lands: a memo over what these reads returned keys on it. */
  readonly version: () => number;
  /** Bumped by the mission reads alone, which land only after a script event. */
  readonly missionVersion: () => number;
  /** Resolves once no read is in flight, for a consumer that must not start on an unanswered read. */
  readonly settled: () => Promise<void>;
  dispose(): void;
}

export function createHostAnswers(host: SessionHost, tribeOf: (player: number) => number): HostAnswers {
  const caches: AnswerCacheControl[] = [];
  const cache = <V>(capacity?: number): LastAnswerCache<V> => {
    const created = createLastAnswerCache<V>({
      tick: () => host.tick,
      ...(capacity !== undefined ? { capacity } : {}),
    });
    caches.push(created);
    return created;
  };
  const flags = cache<boolean>();
  const jobChoices = cache<boolean>(ROSTER_CAPACITY);
  const counts = cache<number>();
  const offers = cache<readonly TradeOffer[]>();
  const tributes = cache<readonly OpenTribute[]>();
  const availabilities = cache<BuildingAvailability>();
  const statuses = cache<UnlockStatus>();
  const picks = cache<readonly EquipPickEntry[]>();
  const traders = cache<TraderView | undefined>();
  const papers = cache<readonly Paper[]>();
  const pages = cache<readonly number[]>();
  const missionEntities = cache<number | null>();
  let missionRevision = 0;

  const flag = (key: string, ask: () => Promise<boolean>): boolean =>
    flags.read(key, ask, NO_INPUTS, PER_TICK) === true;

  return {
    diplomacyView: {
      hasMetPlayer: (viewer, other) => host.hasMetPlayer(viewer, other),
      diplomacyStance: (from, to) => host.diplomacyStance(from, to),
      diplomacyLocked: (a, b) => flag(`locked:${a}:${b}`, () => host.diplomacyLocked(a, b)),
      goodsTradedWith: (player, partner) =>
        counts.read(
          `traded:${player}:${partner}`,
          () => host.goodsTradedWith(player, partner),
          NO_INPUTS,
          PER_TICK,
        ) ?? 0,
      tradeOffersOf: (partner) =>
        offers.read(`of:${partner}`, () => host.tradeOffersOf(partner), NO_INPUTS, PER_TICK) ?? NO_OFFERS,
      openTributes: (payer) =>
        tributes.read(`${payer}`, () => host.openTributes(payer), NO_INPUTS, PER_TICK) ?? NO_TRIBUTES,
    },
    // Kept as availability, not as status: the construction window pulls every entry every frame.
    buildAvailability: (player, typeId) =>
      availabilities.read(
        `${player}:${typeId}`,
        () => host.unlockStatus('house', typeId, tribeOf(player), player).then(technologyAvailability),
        NO_INPUTS,
        PER_TICK,
      ) ?? LOCKED,
    technologyStatus: (kind, typeId, tribe, player) =>
      statuses.read(
        `${kind}:${typeId}:${tribe}:${player ?? ''}`,
        () => host.unlockStatus(kind, typeId, tribe, player),
        NO_INPUTS,
        PER_TICK,
      ),
    canChooseJob: (entity, jobType) =>
      jobChoices.read(
        `${entity}:${jobType}`,
        () => host.canChooseJob(entity as Entity, jobType),
        NO_INPUTS,
        PER_TICK,
      ) === true,
    equipPickList: (entity, group) =>
      picks.read(
        `${entity}:${group}`,
        () => host.equipPickList(entity as Entity, group),
        NO_INPUTS,
        PER_TICK,
      ) ?? NO_PICKS,
    standsTo: (entity) => flag(`stands:${entity}`, () => host.standsTo(entity as Entity)),
    traderView: (trader) =>
      traders.read(`${trader}`, () => host.traderView(trader as Entity), NO_INPUTS, PER_TICK),
    tradeOffersAt: (house) =>
      offers.read(`at:${house}`, () => host.tradeOffersAt(house as Entity), NO_INPUTS, PER_TICK) ?? NO_OFFERS,
    canAttachTradeHouse: (trader, house) =>
      flag(`trade:${trader}:${house}`, () => host.canAttachTradeHouse(trader as Entity, house as Entity)),
    canAttachToVehicle: (settler, vehicle) =>
      flag(`vehicle:${settler}:${vehicle}`, () =>
        host.canAttachToVehicle(settler as Entity, vehicle as Entity),
      ),
    papers: (player) => papers.read(`${player}`, () => host.papers(player), NO_INPUTS, PER_TICK) ?? NO_PAPERS,
    missionBriefingHistory: () =>
      pages.read('history', () => host.missionBriefingHistory(), `${missionRevision}`) ?? NO_PAGES,
    missionBriefingPage: () =>
      missionEntities.read('page', () => host.missionBriefingPage(), `${missionRevision}`) ?? null,
    missionHuman: (missionId) =>
      missionEntities.read(`human:${missionId}`, () => host.missionHuman(missionId), `${missionRevision}`) ??
      null,
    onEvents: (events) => {
      if (events.some((event) => event.kind.startsWith(MISSION_EVENT_PREFIX))) missionRevision++;
    },
    version: () => caches.reduce((sum, held) => sum + held.version, 0),
    missionVersion: () => pages.version + missionEntities.version,
    settled: () => Promise.all(caches.map((held) => held.settled())).then(() => undefined),
    dispose: () => {
      for (const held of caches) held.dispose();
    },
  };
}
