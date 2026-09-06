import { entityById, nodeOfPosition, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { isBuilding, num, ownerPlayerOf, positionOf, type SnapshotEntity } from '../../../game/snapshot.js';
import type { MessageTextParts } from './text.js';
import {
  type MessageSubject,
  type PendingMessage,
  USER_MESSAGE_TYPE,
  type UserMessageType,
} from './types.js';

/** How a source names what it saw; the strings and catalogs stay outside this module. */
export interface MessageNaming {
  /** A person's display name and the trade label shown after it (null for no label). */
  settler(
    e: SnapshotEntity,
    snapshot: WorldSnapshot,
  ): { readonly name: string; readonly jobLabel: string | null };
  building(e: SnapshotEntity): string | null;
  text(type: UserMessageType, parts: MessageTextParts): string;
}

/** A raised message with its text deferred, so a repeat the feed rejects never names anyone. */
export interface RaisedMessage {
  readonly pending: PendingMessage;
  readonly compose: () => string;
}

function isPerson(e: SnapshotEntity): boolean {
  return e.components.Person !== undefined;
}

function ownedBy(e: SnapshotEntity, player: number): boolean {
  return ownerPlayerOf(e) === player;
}

function nodeOf(e: SnapshotEntity): PendingMessage['at'] {
  const pos = positionOf(e);
  return pos === undefined ? null : nodeOfPosition(pos.x, pos.y);
}

function jobTypeOf(e: SnapshotEntity): number | null {
  return num((e.components.Settler as { jobType?: unknown } | undefined)?.jobType) ?? null;
}

/**
 * The local player's messages raised by one frame's sim events, one per (type, subject) even when a
 * frame carries many blows on the same target. `previous` is the snapshot before the frame's steps,
 * the only place a settler reaped this frame can still be named.
 */
export function messagesFromEvents(
  events: readonly SimEvent[],
  snapshot: WorldSnapshot,
  previous: WorldSnapshot | null,
  localPlayer: number,
  naming: MessageNaming,
): RaisedMessage[] {
  const out: RaisedMessage[] = [];
  const seen = new Set<string>();

  const raise = (pending: PendingMessage, compose: () => string): void => {
    const key = `${pending.type}|${pending.subject?.kind ?? ''}:${pending.subject?.entity ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ pending, compose });
  };
  const settlerMessage = (type: UserMessageType, e: SnapshotEntity): void => {
    const subject: MessageSubject = { kind: 'settler', entity: e.id };
    raise({ type, subject, at: nodeOf(e), goodType: null, jobType: jobTypeOf(e) }, () => {
      const named = naming.settler(e, snapshot);
      return naming.text(type, { subjectName: named.name, jobLabel: named.jobLabel, goodName: null });
    });
  };
  const buildingMessage = (type: UserMessageType, e: SnapshotEntity): void => {
    const subject: MessageSubject = { kind: 'building', entity: e.id };
    raise({ type, subject, at: nodeOf(e), goodType: null, jobType: null }, () =>
      naming.text(type, { subjectName: naming.building(e), jobLabel: null, goodName: null }),
    );
  };
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
      buildingMessage(USER_MESSAGE_TYPE.houseAttacked, building);
      return;
    }
    const person = ownedPerson(target);
    if (person !== undefined) settlerMessage(USER_MESSAGE_TYPE.humanAttacked, person);
  };
  const died = (entity: number, at: PendingMessage['at']): void => {
    // Deaths have no subject left to dedupe on, so the reaped id stands in.
    const key = `${USER_MESSAGE_TYPE.humanDied}|dead:${entity}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      pending: { type: USER_MESSAGE_TYPE.humanDied, subject: null, at, goodType: null, jobType: null },
      compose: () => {
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
    });
  };

  for (const ev of events) {
    switch (ev.kind) {
      case 'buildingFinished': {
        const e = ownedBuilding(ev.entity);
        if (e !== undefined) buildingMessage(USER_MESSAGE_TYPE.houseFinished, e);
        break;
      }
      case 'buildingUpgraded': {
        const e = ownedBuilding(ev.entity);
        if (e !== undefined) buildingMessage(USER_MESSAGE_TYPE.houseUpgraded, e);
        break;
      }
      case 'settlerBorn': {
        const e = ownedPerson(ev.entity);
        if (e !== undefined) settlerMessage(USER_MESSAGE_TYPE.wasBorn, e);
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
  return out;
}
