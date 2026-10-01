import { entityById, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import {
  isBuilding,
  isVehicle,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
} from '../../../game/snapshot.js';
import { type MessageNaming, MessageRaiser, type RaisedMessage } from './raise.js';
import type { NamedSettler } from './text.js';
import { type MessageTechnology, type PendingMessage, USER_MESSAGE_TYPE } from './types.js';

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

/**
 * Raise `group`'s note about the discoveries `e` made in one batch, leaving out what no catalog names.
 * The buildings note pictures the building {@link pictureOfUnlocks} picks and lists it first.
 */
export function raiseUnlocks(
  raiser: MessageRaiser,
  snapshot: WorldSnapshot,
  naming: MessageNaming,
  buildingTrades: BuildingTrades,
  e: SnapshotEntity,
  group: UnlockGroup,
  batch: readonly MessageTechnology[],
): void {
  const named = batch.filter(
    (t) =>
      (t.kind === 'house') === (group === 'buildings') && naming.technology(t.kind, t.typeId) !== undefined,
  );
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
      const labels = (kind: MessageTechnology['kind']): string[] =>
        technologies.filter((t) => t.kind === kind).flatMap((t) => naming.technology(t.kind, t.typeId) ?? []);
      return naming.text(type, {
        subjectName: settler.name,
        jobLabel: settler.jobLabel,
        female: settler.female,
        goodName: null,
        stanceName: null,
        technologySections: { jobs: labels('job'), goods: labels('good'), houses: labels('house') },
      });
    },
  );
}

function isPerson(e: SnapshotEntity): boolean {
  return e.components.Person !== undefined;
}

function ownedBy(e: SnapshotEntity, player: number): boolean {
  return ownerPlayerOf(e) === player;
}

/**
 * The local player's messages raised by one frame's sim events. `departed` holds the entities the
 * frame's steps removed, as the world last held them: the only place a settler reaped this frame can
 * still be named.
 */
export function messagesFromEvents(
  events: readonly SimEvent[],
  snapshot: WorldSnapshot,
  departed: readonly SnapshotEntity[],
  localPlayer: number,
  naming: MessageNaming,
  buildingTrades: BuildingTrades,
): RaisedMessage[] {
  const raiser = new MessageRaiser(snapshot, naming);
  const discoveries = new Map<number, MessageTechnology[]>();
  for (const ev of events) {
    if (ev.kind !== 'technologyDiscovered' || ev.player !== localPlayer) continue;
    const grouped = discoveries.get(ev.entity) ?? [];
    if (!grouped.some((technology) => technology.kind === ev.technology && technology.typeId === ev.typeId)) {
      grouped.push({ kind: ev.technology, typeId: ev.typeId });
      discoveries.set(ev.entity, grouped);
    }
  }
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
  const attacked = (target: number): void => {
    const building = ownedBuilding(target);
    if (building !== undefined) {
      raiser.building(USER_MESSAGE_TYPE.houseAttacked, building);
      return;
    }
    const person = ownedPerson(target);
    if (person !== undefined) {
      raiser.settler(USER_MESSAGE_TYPE.humanAttacked, person);
      return;
    }
    const vehicle = ownedVehicle(target);
    if (vehicle !== undefined) raiser.vehicle(USER_MESSAGE_TYPE.vehicleAttacked, vehicle);
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
        // Approximation: the surname source is read off the snapshot after the death, so a growing
        // child of a widowed parent, whose carve-out settles in the same tick, is named by its own id.
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
      case 'technologyDiscovered': {
        if (ev.player !== localPlayer || announcedDiscoveries.has(ev.entity)) break;
        announcedDiscoveries.add(ev.entity);
        const e = ownedPerson(ev.entity);
        if (e === undefined) break;
        const batch = discoveries.get(ev.entity) ?? [];
        raiseUnlocks(raiser, snapshot, naming, buildingTrades, e, 'work', batch);
        raiseUnlocks(raiser, snapshot, naming, buildingTrades, e, 'buildings', batch);
        break;
      }
      case 'settlerTrained': {
        const e = ownedPerson(ev.entity);
        if (e === undefined) break;
        // The barracks note names no trade; any other course's note is about the one thing it taught.
        const nameless = naming.technology(ev.target, ev.typeId) === undefined;
        if (nameless && !(ev.course === 'barracks' && ev.target === 'job')) break;
        if (ev.target === 'job') raiser.trained(USER_MESSAGE_TYPE.canDoNewJob, e, ev.course, ev.typeId);
        else raiser.settler(USER_MESSAGE_TYPE.canProduceNewGood, e, ev.typeId);
        break;
      }
      case 'playerDefeated':
        // Every seat hears an elimination: the original's own record carries the broadcast player id
        // rather than one seat's.
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
      case 'projectileHit':
        attacked(ev.target);
        break;
      default:
        break;
    }
  }
  return raiser.out;
}
