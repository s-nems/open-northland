import { type DiplomacyState, nodeOfPosition, type Paper, type WorldSnapshot } from '@open-northland/sim';
import { num, positionOf, type SnapshotEntity } from '../../../game/snapshot.js';
import type { MessageText, MessageTextParts } from './text.js';
import type { MessageSubject, PendingMessage, UserMessageType } from './types.js';

/** How a source names what it saw; the strings and catalogs stay outside the sources. */
export interface MessageNaming {
  /** A person's display name and the trade label shown after it (null for no label). */
  settler(
    e: SnapshotEntity,
    snapshot: WorldSnapshot,
  ): { readonly name: string; readonly jobLabel: string | null };
  building(e: SnapshotEntity): string | null;
  /** A seat's name, for the messages whose subject is a player rather than an entity. */
  player(player: number): string;
  /** A diplomatic stance in the player's language, for the rows that report one. */
  stance(state: DiplomacyState): string;
  /** A paper's name, for the note about finding one. */
  paper(paper: Paper): string;
  technology(kind: 'job' | 'good' | 'house', typeId: number): string;
  /** Localized completion wording for barracks enlistment and school education. */
  training(course: 'barracks' | 'school', subjectName: string, jobName: string): MessageText;
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
          goodName: goodType === null ? null : this.naming.technology('good', goodType),
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
      () =>
        this.naming.training(
          course,
          this.naming.settler(e, this.snapshot).name,
          this.naming.technology('job', jobType),
        ),
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

  /** A message the caller keys itself, for one without a live subject to key on. */
  raise(key: string, pending: PendingMessage, compose: () => MessageText): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.out.push({ pending, compose });
  }
}
