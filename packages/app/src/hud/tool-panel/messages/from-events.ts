import { entityById, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { isBuilding, isVehicle, ownerPlayerOf, type SnapshotEntity } from '../../../game/snapshot.js';
import { type MessageNaming, MessageRaiser, type RaisedMessage } from './raise.js';
import { type MessageTechnology, type PendingMessage, USER_MESSAGE_TYPE } from './types.js';

/** The note each refused crew order on a vehicle raises about it. */
const CREW_REFUSAL_MESSAGE = {
  noRoom: USER_MESSAGE_TYPE.vehicleNoPassengerRoom,
  cannotAttach: USER_MESSAGE_TYPE.cannotAttachVehicle,
  cannotNearShip: USER_MESSAGE_TYPE.vehicleCannotNearShip,
  cannotLeave: USER_MESSAGE_TYPE.cannotLeaveVehicle,
} as const;

/** The note each refused vehicle order on a settler raises about it. */
const RIDER_REFUSAL_MESSAGE = {
  cannotEnter: USER_MESSAGE_TYPE.cannotEnterVehicle,
  cannotLeave: USER_MESSAGE_TYPE.cannotLeaveVehicle,
} as const;

function isPerson(e: SnapshotEntity): boolean {
  return e.components.Person !== undefined;
}

function ownedBy(e: SnapshotEntity, player: number): boolean {
  return ownerPlayerOf(e) === player;
}

/**
 * The local player's messages raised by one frame's sim events. `previous` is the snapshot before the
 * frame's steps, the only place a settler reaped this frame can still be named.
 */
export function messagesFromEvents(
  events: readonly SimEvent[],
  snapshot: WorldSnapshot,
  previous: WorldSnapshot | null,
  localPlayer: number,
  naming: MessageNaming,
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
    if (person !== undefined) raiser.settler(USER_MESSAGE_TYPE.humanAttacked, person);
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
        let named: { readonly name: string; readonly jobLabel: string | null } | null = null;
        if (previous !== null) {
          const before = entityById(previous, entity);
          if (before !== undefined && isPerson(before)) named = naming.settler(before, previous);
        }
        return naming.text(USER_MESSAGE_TYPE.humanDied, {
          subjectName: named?.name ?? null,
          jobLabel: named?.jobLabel ?? null,
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
        const all = discoveries.get(ev.entity) ?? [];
        const subject = { kind: 'settler' as const, entity: e.id };
        const raiseGroup = (key: string, technologies: readonly MessageTechnology[]): void => {
          if (technologies.length === 0) return;
          raiser.raise(
            `${USER_MESSAGE_TYPE.experienceUnlocks}|settler:${e.id}|${key}`,
            {
              type: USER_MESSAGE_TYPE.experienceUnlocks,
              subject,
              at: null,
              about: null,
              goodType: null,
              technologies,
              jobType: null,
            },
            () => {
              const named = naming.settler(e, snapshot);
              const labels = (kind: MessageTechnology['kind']): string[] =>
                technologies
                  .filter((technology) => technology.kind === kind)
                  .map((technology) => naming.technology(technology.kind, technology.typeId));
              return naming.text(USER_MESSAGE_TYPE.experienceUnlocks, {
                subjectName: named.name,
                jobLabel: named.jobLabel,
                goodName: null,
                stanceName: null,
                technologySections: { jobs: labels('job'), goods: labels('good'), houses: labels('house') },
              });
            },
          );
        };
        raiseGroup(
          'work',
          all.filter((technology) => technology.kind !== 'house'),
        );
        raiseGroup(
          'buildings',
          all.filter((technology) => technology.kind === 'house'),
        );
        break;
      }
      case 'settlerTrained': {
        const e = ownedPerson(ev.entity);
        if (e !== undefined) {
          if (ev.target === 'job') raiser.trained(USER_MESSAGE_TYPE.canDoNewJob, e, ev.course, ev.typeId);
          else raiser.settler(USER_MESSAGE_TYPE.canProduceNewGood, e, ev.typeId);
        }
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
        if (e === undefined) break;
        raiser.vehicle(
          ev.reason === 'noCommander'
            ? USER_MESSAGE_TYPE.vehicleNoCommander
            : USER_MESSAGE_TYPE.vehicleNoPath,
          e,
        );
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
