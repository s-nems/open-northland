import { entityById, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { isBuilding, ownerPlayerOf, type SnapshotEntity } from '../../../game/snapshot.js';
import { type MessageNaming, MessageRaiser, type RaisedMessage } from './raise.js';
import { type PendingMessage, USER_MESSAGE_TYPE } from './types.js';

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
  const ownedPerson = (id: number): SnapshotEntity | undefined => {
    const e = entityById(snapshot, id);
    return e !== undefined && isPerson(e) && ownedBy(e, localPlayer) ? e : undefined;
  };
  const ownedBuilding = (id: number): SnapshotEntity | undefined => {
    const e = entityById(snapshot, id);
    return e !== undefined && isBuilding(e) && ownedBy(e, localPlayer) ? e : undefined;
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
      { type: USER_MESSAGE_TYPE.humanDied, subject: null, at, about: entity, goodType: null, jobType: null },
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
      case 'settlerGrewUp': {
        const e = ownedPerson(ev.entity);
        if (e !== undefined) raiser.settler(USER_MESSAGE_TYPE.grewUp, e);
        break;
      }
      case 'playerDefeated':
        // Every seat hears an elimination: the original's own record carries the broadcast player id
        // rather than one seat's (the original symbols).
        raiser.raise(
          `${USER_MESSAGE_TYPE.playerDied}|player:${ev.player}`,
          {
            type: USER_MESSAGE_TYPE.playerDied,
            subject: null,
            at: null,
            about: ev.player,
            goodType: null,
            jobType: null,
          },
          () =>
            naming.text(USER_MESSAGE_TYPE.playerDied, {
              subjectName: naming.player(ev.player),
              jobLabel: null,
              goodName: null,
            }),
        );
        break;
      case 'settlerBorn': {
        const e = ownedPerson(ev.entity);
        if (e !== undefined) raiser.settler(USER_MESSAGE_TYPE.wasBorn, e);
        break;
      }
      case 'settlerDied':
        if (ev.player === localPlayer && ev.animal !== true) died(ev.entity, ev.at ?? null);
        break;
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
