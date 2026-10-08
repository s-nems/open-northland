import { type DiplomacyState, entityById, type Paper, type WorldSnapshot } from '@open-northland/sim';
import {
  actorsOf,
  buildingTypeOf,
  type ChildOrderWait,
  isBuilding,
  isFemale,
  marriageOf,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
} from '../../../game/snapshot.js';
import type { MetSeat } from './from-diplomacy.js';
import { type BuildingTrades, raiseFight, raiseUnlocks } from './from-events.js';
import { type MessageNaming, MessageRaiser, nodeOf, type RaisedMessage } from './raise.js';
import { raiseShortage } from './site-shortages.js';
import {
  type MessageTechnology,
  type ProductionStall,
  USER_MESSAGE_TYPE,
  type UserMessageType,
  type UserMessageTypeName,
} from './types.js';
import { raiseStall } from './workshop-stalls.js';

/**
 * `?debug=notices`: the seat's own settlers and buildings raise one note of every type, for checking the
 * column against every row without staging each cause in the sim. The notes stand until dismissed or
 * their subject leaves the world; the message centre skips the sim checks and the lifetime for them.
 */
export const NOTICE_GALLERY_DEBUG_FLAG = 'notices';

export interface NoticeGallery {
  /** The good the rows that name one show; null leaves those rows out. */
  readonly goodType: number | null;
}

/** The stance the two seat rows report when the seat has met no one to read one off. */
const STANDIN_STANCE: DiplomacyState = 'enemy';
/** The seat the seat rows are about when none is met: the next slot, whatever it holds. */
const NEXT_SEAT = 1;
/** The wait the child-order row reports; any would do, this one names the husband. */
const STANDIN_FAMILY_WAIT: ChildOrderWait = 'husbandAway';
/** The found-item row's paper; the indulgence names no type, so it needs no catalog id. */
const STANDIN_PAPER: Paper = { kind: 'indulgence', param: 0 };

const HOUSE_ROWS: ReadonlySet<UserMessageTypeName> = new Set<UserMessageTypeName>([
  'houseFinished',
  'houseUpgraded',
]);
const SEAT_ROWS: ReadonlySet<UserMessageTypeName> = new Set<UserMessageTypeName>([
  'playerSighted',
  'diplomacyChanged',
  'playerDied',
]);
/** The rows whose text names a good; without one to name they are left out. */
const GOOD_ROWS: ReadonlySet<UserMessageTypeName> = new Set<UserMessageTypeName>(['canProduceNewGood']);

/** The rows a woman raises; a man's name on them reads wrong in a gendered language. */
const WOMEN_ROWS: ReadonlySet<UserMessageTypeName> = new Set<UserMessageTypeName>(['familyBlocked']);

/** How many of the seat's menu buildings the unlock row opens: a few, as one discovery does. */
const GALLERY_OPENED_BUILDINGS = 3;

const NO_PARTS = { jobLabel: null, goodName: null, stanceName: null } as const;

function isPerson(e: SnapshotEntity): boolean {
  return e.components.Person !== undefined;
}

/**
 * One raised message per type. Settler rows walk the seat's people in turn, so the cards show different
 * figures; the death and the seat rows stand in for their subject the way the event sources do. The
 * feed's identity check absorbs the repeat raises, so the caller can re-raise on every sweep and a
 * dismissed note stays away.
 */
export function galleryMessages(
  snapshot: WorldSnapshot,
  localPlayer: number,
  naming: MessageNaming,
  seats: readonly MetSeat[],
  gallery: NoticeGallery,
  buildingTrades: BuildingTrades,
): readonly RaisedMessage[] {
  const raiser = new MessageRaiser(snapshot, naming);
  const owned = actorsOf(snapshot).filter((e) => ownerPlayerOf(e) === localPlayer);
  const people = owned.filter(isPerson);
  const women = people.filter(isFemale);
  const buildings = owned.filter(isBuilding);
  const [house] = buildings;
  const seat: MetSeat = seats[0] ?? { player: localPlayer + NEXT_SEAT, towardYou: STANDIN_STANCE };
  let turn = 0;
  const nextPerson = (pool: readonly SnapshotEntity[]): SnapshotEntity | undefined => {
    if (pool.length === 0) return undefined;
    const person = pool[turn % pool.length];
    turn += 1;
    return person;
  };

  const raiseSeat = (type: UserMessageType, withStance: boolean): void => {
    raiser.raise(
      `${type}|player:${seat.player}`,
      {
        type,
        subject: null,
        at: null,
        about: seat.player,
        goodType: null,
        technologies: null,
        jobType: null,
      },
      () =>
        naming.text(type, {
          ...NO_PARTS,
          subjectName: naming.player(seat.player),
          stanceName: withStance ? naming.stance(seat.towardYou) : null,
        }),
    );
  };
  const raiseDeath = (e: SnapshotEntity): void => {
    const type = USER_MESSAGE_TYPE.humanDied;
    raiser.raise(
      `${type}|dead:${e.id}`,
      { type, subject: null, at: nodeOf(e), about: e.id, goodType: null, technologies: null, jobType: null },
      () => {
        const named = naming.settler(e, snapshot);
        return naming.text(type, {
          ...NO_PARTS,
          subjectName: named.name,
          jobLabel: named.jobLabel,
          female: named.female,
        });
      },
    );
  };
  const raisePaper = (): void => {
    const type = USER_MESSAGE_TYPE.specialItemFound;
    raiser.raise(
      `${type}|paper`,
      { type, subject: null, at: null, about: null, goodType: null, technologies: null, jobType: null },
      () => naming.text(type, { ...NO_PARTS, subjectName: null, detail: naming.paper(STANDIN_PAPER) }),
    );
  };
  // The two notes one settler's discovery batch makes: the trade and good, and the menu buildings they
  // open, which that card pictures.
  const raiseUnlockRows = (e: SnapshotEntity): void => {
    const jobType = settlerJobType(e);
    const work: MessageTechnology[] = [];
    if (jobType !== undefined) work.push({ kind: 'job', typeId: jobType });
    if (gallery.goodType !== null) work.push({ kind: 'good', typeId: gallery.goodType });
    raiseUnlocks(raiser, snapshot, naming, buildingTrades, e, 'work', work);
    const listed = new Set(
      buildings.flatMap((b) => {
        const typeId = buildingTypeOf(b);
        return typeId !== undefined && buildingTrades(typeId) !== undefined ? [typeId] : [];
      }),
    );
    const opened = [...listed]
      .slice(0, GALLERY_OPENED_BUILDINGS)
      .map((typeId): MessageTechnology => ({ kind: 'house', typeId }));
    raiseUnlocks(raiser, snapshot, naming, buildingTrades, e, 'buildings', opened);
  };

  // The settlement row is a met seat's raid on the house, the other wild beasts on a settler.
  const raiseFightRow = (type: UserMessageType, at: SnapshotEntity, settlement: boolean): void => {
    const tally = settlement
      ? { buildings: 1, walls: 0, settlers: 2, vehicles: 0, seats: [seat.player], wild: false }
      : { buildings: 0, walls: 0, settlers: 1, vehicles: 0, seats: [], wild: true };
    raiseFight(raiser, naming, type, at.id, nodeOf(at), { ...tally, lastHitTick: snapshot.tick });
  };

  for (const [name, type] of Object.entries(USER_MESSAGE_TYPE) as [UserMessageTypeName, UserMessageType][]) {
    if (SEAT_ROWS.has(name)) {
      raiseSeat(type, name !== 'playerDied');
      continue;
    }
    if (name === 'specialItemFound') {
      raisePaper();
      continue;
    }
    if (HOUSE_ROWS.has(name)) {
      if (house !== undefined) raiser.building(type, house);
      continue;
    }
    if (name === 'productionStalled') {
      const stall: ProductionStall =
        gallery.goodType === null
          ? { reason: 'unknown', goodType: null }
          : { reason: 'noInputSource', goodType: gallery.goodType };
      if (house !== undefined) raiseStall(raiser, naming, house, stall);
      continue;
    }
    if (name === 'constructionStarved') {
      if (house !== undefined && gallery.goodType !== null)
        raiseShortage(raiser, naming, house, gallery.goodType);
      continue;
    }
    if (name === 'settlementAttacked') {
      if (house !== undefined) raiseFightRow(type, house, true);
      continue;
    }
    if (GOOD_ROWS.has(name) && gallery.goodType === null) continue;
    const e = nextPerson(WOMEN_ROWS.has(name) && women.length > 0 ? women : people);
    if (e === undefined) continue;
    if (name === 'humanDied') raiseDeath(e);
    else if (name === 'peopleAttacked') raiseFightRow(type, e, false);
    else if (name === 'familyBlocked') {
      const spouse = marriageOf(e)?.spouse;
      raiser.family(e, STANDIN_FAMILY_WAIT, spouse === undefined ? undefined : entityById(snapshot, spouse));
    } else if (name === 'experienceUnlocks') raiseUnlockRows(e);
    else if (name === 'canDoNewJob') {
      const jobType = settlerJobType(e);
      if (jobType !== undefined && naming.technology('job', jobType) !== undefined) {
        raiser.trained(type, e, 'school', jobType);
      }
    } else raiser.settler(type, e, GOOD_ROWS.has(name) ? gallery.goodType : null);
  }
  return raiser.out;
}

/** The extra hungry settlers that fill the gallery's hunger family past the rows an open stack lists,
 *  and the size of its same-type stacks. */
const GALLERY_HUNGER_EXTRA = 6;
const GALLERY_SAME_TYPE_STACK = 3;

/**
 * Extra notes for `?debug=notices` that stack: hungry settlers beside the gallery's starving and dying
 * ones (one family past the short list), tired settlers and finished buildings (stacks of one type).
 * Raised from the last of the seat's people, so they spread over other figures than the rows above.
 */
export function galleryStackMessages(
  snapshot: WorldSnapshot,
  localPlayer: number,
  naming: MessageNaming,
): readonly RaisedMessage[] {
  const raiser = new MessageRaiser(snapshot, naming);
  const owned = actorsOf(snapshot).filter((e) => ownerPlayerOf(e) === localPlayer);
  const people = owned.filter(isPerson).reverse();
  for (const e of people.slice(0, GALLERY_HUNGER_EXTRA)) raiser.settler(USER_MESSAGE_TYPE.hungry, e);
  const tired = people.slice(GALLERY_HUNGER_EXTRA, GALLERY_HUNGER_EXTRA + GALLERY_SAME_TYPE_STACK);
  for (const e of tired) raiser.settler(USER_MESSAGE_TYPE.tired, e);
  for (const b of owned.filter(isBuilding).slice(0, GALLERY_SAME_TYPE_STACK)) {
    raiser.building(USER_MESSAGE_TYPE.houseFinished, b);
  }
  return raiser.out;
}
