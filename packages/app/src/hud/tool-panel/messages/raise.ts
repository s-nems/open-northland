import { type DiplomacyState, nodeOfPosition, type Paper, type WorldSnapshot } from '@open-northland/sim';
import { type ChildOrderWait, num, positionOf, type SnapshotEntity } from '../../../game/snapshot.js';
import type { MessageText, MessageTextParts, NamedSettler } from './text.js';
import {
  type MessageSubject,
  type PendingMessage,
  USER_MESSAGE_TYPE,
  type UserMessageType,
} from './types.js';

/** How a source names what it saw; the strings and catalogs stay outside the sources. */
export interface MessageNaming {
  /** A person's display name, the trade label shown after it (null for no label) and its sex. */
  settler(e: SnapshotEntity, snapshot: WorldSnapshot): NamedSettler;
  /** A building's type name, or a generic stand-in for a type the catalog does not know. */
  building(e: SnapshotEntity): string;
  /** A vehicle's type name, or a generic stand-in for a type the catalog does not know. */
  vehicle(e: SnapshotEntity): string;
  /** A seat's name, for the messages whose subject is a player rather than an entity. */
  player(player: number): string;
  /** A diplomatic stance in the player's language, for the rows that report one. */
  stance(state: DiplomacyState): string;
  /** A paper's name, for the note about finding one. */
  paper(paper: Paper): string;
  /** A job's, good's or house's name, or undefined when no catalog names it. */
  technology(kind: 'job' | 'good' | 'house', typeId: number): string | undefined;
  text(type: UserMessageType, parts: MessageTextParts): MessageText;
}

/** A raised message with its text deferred, so a repeat the feed rejects never names anyone. */
export interface RaisedMessage {
  readonly pending: PendingMessage;
  readonly compose: () => MessageText;
}

export function nodeOf(e: SnapshotEntity): PendingMessage['at'] {
  const pos = positionOf(e);
  return pos === undefined ? null : nodeOfPosition(pos.x, pos.y);
}

function jobTypeOf(e: SnapshotEntity): number | null {
  return num((e.components.Settler as { jobType?: unknown } | undefined)?.jobType) ?? null;
}

/** Collects one pass's messages, one per (type, subject) however often the pass meets the pair. */
export class MessageRaiser {
  readonly out: RaisedMessage[] = [];
  private readonly seen = new Set<string>();

  constructor(
    private readonly snapshot: WorldSnapshot,
    private readonly naming: MessageNaming,
  ) {}

  settler(type: UserMessageType, e: SnapshotEntity, goodType: number | null = null): void {
    const subject: MessageSubject = { kind: 'settler', entity: e.id };
    this.raise(
      `${type}|settler:${e.id}`,
      {
        type,
        subject,
        at: nodeOf(e),
        about: null,
        goodType,
        technologies: null,
        jobType: jobTypeOf(e),
      },
      () => {
        const named = this.naming.settler(e, this.snapshot);
        return this.naming.text(type, {
          subjectName: named.name,
          jobLabel: named.jobLabel,
          female: named.female,
          goodName: goodType === null ? null : (this.naming.technology('good', goodType) ?? null),
          stanceName: null,
        });
      },
    );
  }

  trained(type: UserMessageType, e: SnapshotEntity, course: 'barracks' | 'school', jobType: number): void {
    const subject: MessageSubject = { kind: 'settler', entity: e.id };
    this.raise(
      `${type}|settler:${e.id}`,
      { type, subject, at: nodeOf(e), about: null, goodType: null, technologies: null, jobType },
      () => {
        // The note names the trade the course taught, so the name goes without the one it had.
        const named = this.naming.settler(e, this.snapshot);
        return this.naming.text(type, {
          subjectName: named.name,
          jobLabel: null,
          female: named.female,
          goodName: null,
          stanceName: null,
          training: { course, profession: this.naming.technology('job', jobType) ?? '' },
        });
      },
    );
  }

  /** A woman's child order held by `wait`, naming `partner`, her husband, where the reason is his. */
  family(e: SnapshotEntity, wait: ChildOrderWait, partner: SnapshotEntity | undefined): void {
    const type = USER_MESSAGE_TYPE.familyBlocked;
    this.raise(
      `${type}|settler:${e.id}`,
      {
        type,
        subject: { kind: 'settler', entity: e.id },
        at: nodeOf(e),
        about: null,
        goodType: null,
        technologies: null,
        jobType: jobTypeOf(e),
        familyWait: wait,
      },
      () => {
        const named = this.naming.settler(e, this.snapshot);
        return this.naming.text(type, {
          subjectName: named.name,
          jobLabel: named.jobLabel,
          female: named.female,
          goodName: null,
          stanceName: null,
          family: {
            wait,
            partner: partner === undefined ? null : this.naming.settler(partner, this.snapshot),
          },
        });
      },
    );
  }

  building(type: UserMessageType, e: SnapshotEntity): void {
    const subject: MessageSubject = { kind: 'building', entity: e.id };
    this.raise(
      `${type}|building:${e.id}`,
      { type, subject, at: nodeOf(e), about: null, goodType: null, technologies: null, jobType: null },
      () =>
        this.naming.text(type, {
          subjectName: this.naming.building(e),
          jobLabel: null,
          goodName: null,
          stanceName: null,
        }),
    );
  }

  vehicle(type: UserMessageType, e: SnapshotEntity): void {
    const subject: MessageSubject = { kind: 'vehicle', entity: e.id };
    this.raise(
      `${type}|vehicle:${e.id}`,
      { type, subject, at: nodeOf(e), about: null, goodType: null, technologies: null, jobType: null },
      () =>
        this.naming.text(type, {
          subjectName: this.naming.vehicle(e),
          jobLabel: null,
          goodName: null,
          stanceName: null,
        }),
    );
  }

  /** A message the caller keys itself, for one without a live subject to key on. */
  raise(key: string, pending: PendingMessage, compose: () => MessageText): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.out.push({ pending, compose });
  }
}
