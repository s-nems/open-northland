import { entityById, type HalfCellNode, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { isSoldierJob, professionDefForJob } from '../../../catalog/professions.js';
import {
  isBuilding,
  isPalisade,
  isVehicle,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
} from '../../../game/snapshot.js';
import {
  FIGHT_TYPE,
  type FightArea,
  type FightAreas,
  type FightVictimKind,
  fightPlaceOf,
} from './fight-areas.js';
import { type MessageNaming, MessageRaiser, type RaisedMessage } from './raise.js';
import type { NamedSettler } from './text.js';
import {
  type FightTally,
  type MessageTechnology,
  type PendingMessage,
  USER_MESSAGE_TYPE,
  type UserMessageType,
} from './types.js';

/** The note each refused move order on a vehicle raises about it. */
const MOVE_REFUSAL_MESSAGE = {
  noAnimal: USER_MESSAGE_TYPE.vehicleNoAnimal,
  noCommander: USER_MESSAGE_TYPE.vehicleNoCommander,
  noPath: USER_MESSAGE_TYPE.vehicleNoPath,
} as const;

/** The note each refused crew order on a vehicle raises about it. */
const CREW_REFUSAL_MESSAGE = {
  noRoom: USER_MESSAGE_TYPE.vehicleNoPassengerRoom,
  cannotAttach: USER_MESSAGE_TYPE.cannotAttachVehicle,
  cannotNearShip: USER_MESSAGE_TYPE.vehicleCannotNearShip,
  cannotLeave: USER_MESSAGE_TYPE.cannotLeaveVehicle,
  noCarrier: USER_MESSAGE_TYPE.vehicleNoCarrier,
} as const;

/** The note each refused vehicle order on a settler raises about it. */
const RIDER_REFUSAL_MESSAGE = {
  cannotEnter: USER_MESSAGE_TYPE.cannotEnterVehicle,
  cannotLeave: USER_MESSAGE_TYPE.cannotLeaveVehicle,
} as const;

/** The trades a construction-menu building type employs; undefined for a type the menu does not list
 *  (a vehicle's building site), which no unlock pictures. */
export type BuildingTrades = (typeId: number) => readonly number[] | undefined;

/** Whether a building type is a vehicle's build site, which an unlock lists among the vehicles. */
export type VehicleSiteTest = (typeId: number) => boolean;

const NO_VEHICLE_SITES: VehicleSiteTest = () => false;

/** The two notes one settler's discoveries make: the trades and goods it learned, and the buildings
 *  they open. */
export type UnlockGroup = 'work' | 'buildings';

/**
 * Of the construction-menu buildings in `batch`, the one its note pictures: the first a trade discovered
 * in the same batch works in, else the first `ownJob` works in, else the first. In the content a
 * collector who discovers the potter opens the school and the pottery, and a potter's tile opens home
 * tiers beside the second pottery; this pictures the pottery both times.
 */
export function pictureOfUnlocks(
  batch: readonly MessageTechnology[],
  ownJob: number | undefined,
  buildingTrades: BuildingTrades,
): number | undefined {
  const newJobs = batch.filter((t) => t.kind === 'job').map((t) => t.typeId);
  const buildings = batch.flatMap((t) => {
    const trades = t.kind === 'house' ? buildingTrades(t.typeId) : undefined;
    return trades === undefined ? [] : [{ typeId: t.typeId, trades }];
  });
  const worksIn = (jobs: readonly number[]) => buildings.find((b) => b.trades.some((j) => jobs.includes(j)));
  return (worksIn(newJobs) ?? worksIn(ownJob === undefined ? [] : [ownJob]) ?? buildings[0])?.typeId;
}

/** Whether a discovered trade is news: one the profession picker offers, other than the soldier, whom
 *  only the barracks makes. Heroes and the sea trades sit off the picker. */
function announcesJob(jobType: number): boolean {
  return professionDefForJob(jobType) !== undefined && !isSoldierJob(jobType);
}

/** The technologies of `batch` that `group`'s note lists: those a catalog names, trades only when news. */
function unlocksIn(
  naming: MessageNaming,
  group: UnlockGroup,
  batch: readonly MessageTechnology[],
): MessageTechnology[] {
  return batch.filter(
    (t) =>
      (t.kind === 'house') === (group === 'buildings') &&
      (t.kind !== 'job' || announcesJob(t.typeId)) &&
      naming.technology(t.kind, t.typeId) !== undefined,
  );
}

/**
 * Raise `group`'s note about the discoveries `e` made in one batch, leaving out what no catalog names.
 * The buildings note pictures the building {@link pictureOfUnlocks} picks and lists it first, and lists
 * vehicle build sites apart, as vehicles.
 */
export function raiseUnlocks(
  raiser: MessageRaiser,
  snapshot: WorldSnapshot,
  naming: MessageNaming,
  buildingTrades: BuildingTrades,
  e: SnapshotEntity,
  group: UnlockGroup,
  batch: readonly MessageTechnology[],
  isVehicleSite: VehicleSiteTest = NO_VEHICLE_SITES,
): void {
  const named = unlocksIn(naming, group, batch);
  if (named.length === 0) return;
  // The trades the batch discovered pick the picture, though the buildings note does not list them.
  const pictured = batch.filter((t) => t.kind !== 'house' || named.includes(t));
  const building =
    group === 'buildings' ? pictureOfUnlocks(pictured, settlerJobType(e), buildingTrades) : undefined;
  const technologies =
    building === undefined
      ? named
      : [...named.filter((t) => t.typeId === building), ...named.filter((t) => t.typeId !== building)];
  const type = USER_MESSAGE_TYPE.experienceUnlocks;
  raiser.raise(
    `${type}|settler:${e.id}|${group}`,
    {
      type,
      subject: { kind: 'settler', entity: e.id },
      at: null,
      about: null,
      goodType: null,
      technologies,
      jobType: null,
      ...(building === undefined ? {} : { building }),
    },
    () => {
      const settler = naming.settler(e, snapshot);
      const labels = (listed: (t: MessageTechnology) => boolean): string[] =>
        technologies.filter(listed).flatMap((t) => naming.technology(t.kind, t.typeId) ?? []);
      const house = (t: MessageTechnology): boolean => t.kind === 'house' && !isVehicleSite(t.typeId);
      return naming.text(type, {
        subjectName: settler.name,
        jobLabel: settler.jobLabel,
        female: settler.female,
        goodName: null,
        stanceName: null,
        technologySections: {
          jobs: labels((t) => t.kind === 'job'),
          goods: labels((t) => t.kind === 'good'),
          houses: labels(house),
          vehicles: labels((t) => t.kind === 'house' && !house(t)),
        },
      });
    },
  );
}

/**
 * Raise the note about one fight area, keyed by the area: a standing card takes the fresh tally, text and
 * latest hit through `updatesStanding`.
 */
export function raiseFight(
  raiser: MessageRaiser,
  naming: MessageNaming,
  type: UserMessageType,
  area: number,
  at: PendingMessage['at'],
  tally: FightTally,
): void {
  raiser.raise(
    `${type}|area:${area}`,
    {
      type,
      subject: null,
      at,
      about: area,
      goodType: null,
      technologies: null,
      jobType: null,
      fight: tally,
    },
    () =>
      naming.text(type, {
        subjectName: null,
        jobLabel: null,
        goodName: null,
        stanceName: null,
        fight: {
          buildings: tally.buildings,
          walls: tally.walls,
          settlers: tally.settlers,
          vehicles: tally.vehicles,
          enemies: tally.seats.map((seat) => naming.player(seat)),
          wild: tally.wild,
        },
      }),
    true,
  );
}

function fightVictimKind(e: SnapshotEntity): FightVictimKind | undefined {
  if (isBuilding(e)) return 'building';
  if (isPalisade(e)) return 'wall';
  if (isVehicle(e)) return 'vehicle';
  return isPerson(e) ? 'settler' : undefined;
}

function isPerson(e: SnapshotEntity): boolean {
  return e.components.Person !== undefined;
}

function ownedBy(e: SnapshotEntity, player: number): boolean {
  return ownerPlayerOf(e) === player;
}

/** A course's lesson as a discovery would list it. */
function lessonOf(ev: Extract<SimEvent, { kind: 'settlerTrained' }>): MessageTechnology {
  return { kind: ev.target, typeId: ev.typeId };
}

/**
 * Which note tells more when a course's lesson is also a discovery of the same batch: the course note
 * when the discovery is the lesson alone, since it names the course too, else the unlock note, which
 * lists the lesson among the rest. Both stand when the batch did not discover the lesson.
 */
export function courseNoteKeeps(
  lesson: MessageTechnology,
  work: readonly MessageTechnology[],
): 'course' | 'unlock' | 'both' {
  if (!work.some((t) => t.kind === lesson.kind && t.typeId === lesson.typeId)) return 'both';
  return work.length === 1 ? 'course' : 'unlock';
}

/**
 * The local player's messages raised by one frame's sim events. `departed` holds the entities the
 * frame's steps removed, as the world last held them: the only place a settler reaped this frame can
 * still be named, and a body a killing blow felled can still be told. A blow on the seat's own settler,
 * building or vehicle files a hit under `fights`, unless it is the seat's own fire or splash from a
 * side not at war with it; each fight a frame touched raises one note.
 */
export function messagesFromEvents(
  events: readonly SimEvent[],
  snapshot: WorldSnapshot,
  departed: readonly SnapshotEntity[],
  localPlayer: number,
  naming: MessageNaming,
  buildingTrades: BuildingTrades,
  fights: FightAreas,
  isVehicleSite: VehicleSiteTest = NO_VEHICLE_SITES,
): RaisedMessage[] {
  const raiser = new MessageRaiser(snapshot, naming);
  const discoveries = new Map<number, MessageTechnology[]>();
  // A course and the discoveries it made land in one tick: the training drive plans ahead of the
  // discovery pass that reads the lesson.
  const lessons = new Map<number, MessageTechnology>();
  for (const ev of events) {
    if (ev.kind === 'settlerTrained') lessons.set(ev.entity, lessonOf(ev));
    if (ev.kind !== 'technologyDiscovered' || ev.player !== localPlayer) continue;
    const grouped = discoveries.get(ev.entity) ?? [];
    if (!grouped.some((technology) => technology.kind === ev.technology && technology.typeId === ev.typeId)) {
      grouped.push({ kind: ev.technology, typeId: ev.typeId });
      discoveries.set(ev.entity, grouped);
    }
  }
  const keeps = (entity: number): 'course' | 'unlock' | 'both' => {
    const lesson = lessons.get(entity);
    if (lesson === undefined) return 'both';
    return courseNoteKeeps(lesson, unlocksIn(naming, 'work', discoveries.get(entity) ?? []));
  };
  const announcedDiscoveries = new Set<number>();
  const ownedPerson = (id: number): SnapshotEntity | undefined => {
    const e = entityById(snapshot, id);
    return e !== undefined && isPerson(e) && ownedBy(e, localPlayer) ? e : undefined;
  };
  const ownedBuilding = (id: number): SnapshotEntity | undefined => {
    const e = entityById(snapshot, id);
    return e !== undefined && isBuilding(e) && ownedBy(e, localPlayer) ? e : undefined;
  };
  const ownedVehicle = (id: number): SnapshotEntity | undefined => {
    const e = entityById(snapshot, id);
    return e !== undefined && isVehicle(e) && ownedBy(e, localPlayer) ? e : undefined;
  };
  let departedById: Map<number, SnapshotEntity> | undefined;
  const touchedFights = new Set<FightArea>();
  const attacked = (
    target: number,
    at: HalfCellNode,
    attacker: number | undefined,
    collateral: boolean,
  ): void => {
    if (collateral || attacker === localPlayer) return;
    let victim = entityById(snapshot, target);
    if (victim === undefined) {
      departedById ??= new Map(departed.map((e) => [e.id, e]));
      victim = departedById.get(target);
    }
    if (victim === undefined || !ownedBy(victim, localPlayer)) return;
    const kind = fightVictimKind(victim);
    if (kind === undefined) return;
    const hit = { victim: target, kind, at, attacker, tick: snapshot.tick };
    touchedFights.add(fights.record(hit, fightPlaceOf(snapshot, localPlayer, kind, at)));
  };
  const died = (entity: number, at: PendingMessage['at']): void => {
    // Deaths have no subject left to key on, so the reaped id stands in.
    raiser.raise(
      `${USER_MESSAGE_TYPE.humanDied}|dead:${entity}`,
      {
        type: USER_MESSAGE_TYPE.humanDied,
        subject: null,
        at,
        about: entity,
        goodType: null,
        technologies: null,
        jobType: null,
      },
      () => {
        let named: NamedSettler | null = null;
        const before = departed.find((e) => e.id === entity);
        if (before !== undefined && isPerson(before)) named = naming.settler(before, snapshot);
        return naming.text(USER_MESSAGE_TYPE.humanDied, {
          subjectName: named?.name ?? null,
          jobLabel: named?.jobLabel ?? null,
          female: named?.female ?? false,
          goodName: null,
          stanceName: null,
        });
      },
    );
  };

  for (const ev of events) {
    switch (ev.kind) {
      case 'buildingFinished': {
        const e = ownedBuilding(ev.entity);
        if (e !== undefined) raiser.building(USER_MESSAGE_TYPE.houseFinished, e);
        break;
      }
      case 'buildingUpgraded': {
        // A script that takes a house down its chain has nothing to announce.
        if (ev.lowered === true) break;
        const e = ownedBuilding(ev.entity);
        if (e !== undefined) raiser.building(USER_MESSAGE_TYPE.houseUpgraded, e);
        break;
      }
      case 'settlerLost': {
        const e = ownedPerson(ev.entity);
        if (e !== undefined) raiser.settler(USER_MESSAGE_TYPE.lostWithoutSignposts, e);
        break;
      }
      case 'prayerSiteMissing': {
        const e = ownedPerson(ev.entity);
        if (e !== undefined) raiser.settler(USER_MESSAGE_TYPE.wantsToPray, e);
        break;
      }
      case 'vehicleSiteRefused': {
        const e = ownedPerson(ev.entity);
        if (e === undefined) break;
        raiser.settler(
          ev.reason === 'occupied'
            ? USER_MESSAGE_TYPE.vehicleSiteOccupied
            : USER_MESSAGE_TYPE.vehicleSiteNotFound,
          e,
        );
        break;
      }
      case 'marriageUnmatched': {
        const e = ownedPerson(ev.entity);
        if (e !== undefined) raiser.settler(USER_MESSAGE_TYPE.noOneToMarry, e);
        break;
      }
      case 'settlerGrewUp': {
        const e = ownedPerson(ev.entity);
        if (e !== undefined) raiser.settler(USER_MESSAGE_TYPE.grewUp, e);
        break;
      }
      case 'explorationFinished': {
        const e = ownedPerson(ev.entity);
        if (e !== undefined) raiser.settler(USER_MESSAGE_TYPE.explorationFinished, e);
        break;
      }
      case 'technologyDiscovered': {
        if (ev.player !== localPlayer || announcedDiscoveries.has(ev.entity)) break;
        announcedDiscoveries.add(ev.entity);
        const e = ownedPerson(ev.entity);
        if (e === undefined) break;
        const batch = discoveries.get(ev.entity) ?? [];
        if (keeps(ev.entity) !== 'course') {
          raiseUnlocks(raiser, snapshot, naming, buildingTrades, e, 'work', batch, isVehicleSite);
        }
        raiseUnlocks(raiser, snapshot, naming, buildingTrades, e, 'buildings', batch, isVehicleSite);
        break;
      }
      case 'settlerTrained': {
        const e = ownedPerson(ev.entity);
        if (e === undefined) break;
        // The barracks note names no trade; any other course's note is about the one thing it taught.
        const nameless = naming.technology(ev.target, ev.typeId) === undefined;
        if (nameless && !(ev.course === 'barracks' && ev.target === 'job')) break;
        if (keeps(ev.entity) === 'unlock') break;
        if (ev.target === 'job') raiser.trained(USER_MESSAGE_TYPE.canDoNewJob, e, ev.course, ev.typeId);
        else raiser.settler(USER_MESSAGE_TYPE.canProduceNewGood, e, ev.typeId);
        break;
      }
      case 'playerDefeated':
        // Every other seat hears an elimination: the original's own record carries the broadcast player id
        // rather than one seat's. The defeated seat's own defeat panel already tells it.
        if (ev.player === localPlayer) break;
        raiser.raise(
          `${USER_MESSAGE_TYPE.playerDied}|player:${ev.player}`,
          {
            type: USER_MESSAGE_TYPE.playerDied,
            subject: null,
            at: null,
            about: ev.player,
            goodType: null,
            technologies: null,
            jobType: null,
          },
          () =>
            naming.text(USER_MESSAGE_TYPE.playerDied, {
              subjectName: naming.player(ev.player),
              jobLabel: null,
              goodName: null,
              stanceName: null,
            }),
        );
        break;
      case 'settlerDied':
        if (ev.player === localPlayer && ev.animal !== true) died(ev.entity, ev.at ?? null);
        break;
      case 'paperFound':
        // Keyed by the chest, like a death by the reaped id: one chest hands out one paper, so two
        // same-kind papers from two chests stay two notes.
        if (ev.player === localPlayer) {
          raiser.raise(
            `${USER_MESSAGE_TYPE.specialItemFound}|chest:${ev.chest}`,
            {
              type: USER_MESSAGE_TYPE.specialItemFound,
              subject: null,
              at: ev.at,
              about: ev.chest,
              goodType: null,
              technologies: null,
              jobType: null,
            },
            () =>
              naming.text(USER_MESSAGE_TYPE.specialItemFound, {
                subjectName: null,
                jobLabel: null,
                goodName: null,
                stanceName: null,
                detail: naming.paper(ev.paper),
              }),
          );
        }
        break;
      case 'vehicleMoveRefused': {
        const e = ownedVehicle(ev.entity);
        if (e !== undefined) raiser.vehicle(MOVE_REFUSAL_MESSAGE[ev.reason], e);
        break;
      }
      case 'vehicleCrewRefused': {
        const e = ownedVehicle(ev.entity);
        if (e !== undefined) raiser.vehicle(CREW_REFUSAL_MESSAGE[ev.reason], e);
        break;
      }
      case 'riderRefused': {
        const e = ownedPerson(ev.entity);
        if (e !== undefined) raiser.settler(RIDER_REFUSAL_MESSAGE[ev.reason], e);
        break;
      }
      case 'combatHit':
        attacked(ev.target, ev.at, ev.attackerPlayer, false);
        break;
      case 'projectileHit':
        attacked(ev.target, ev.at, ev.shooterPlayer, ev.collateral === true);
        break;
      default:
        break;
    }
  }
  for (const area of touchedFights) {
    raiseFight(raiser, naming, FIGHT_TYPE[area.place], area.id, area.at(), area.tally());
  }
  return raiser.out;
}
