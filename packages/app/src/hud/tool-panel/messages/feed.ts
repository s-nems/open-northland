import { TICKS_PER_SECOND } from '@open-northland/sim';
import { HUNGER_CHAIN, hungerStageOf, isPolledNote, keepsLatestOnly, lifecycleOf } from './lifecycle.js';
import {
  cycleMessageLevel,
  DEFAULT_MESSAGE_LEVEL,
  messagePassesFilter,
  messagePriority,
} from './priority.js';
import type { MessageText } from './text.js';
import type { MessagePriorityLevel, MessageSubject, PendingMessage, UserMessage } from './types.js';

const SECONDS_PER_MINUTE = 60;
/** Ticks an event note stays on the strip (approximation of the original's five minutes). */
export const MESSAGE_LIFETIME_TICKS = 5 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** Ticks a dismissed event note keeps its repeat away, counted from the dismissal: as long as the note
 *  would have stood had it just arrived. */
export const DISMISSED_EVENT_BLOCK_TICKS = MESSAGE_LIFETIME_TICKS;
/** Slots on the strip, and the event dismissals the history keeps. A full strip makes room by pushing a
 *  lighter note off; a full history forgets its oldest event dismissal, while a state dismissal stays
 *  as long as its cause, which bounds it. Approximation of the original's two buffers of this size. */
export const MESSAGE_SLOTS = 200;
/** Events raised while the world is still being assembled never become notes: authored spawns land on
 *  the first step, and every adult they place would otherwise be announced as born. */
const SETUP_TICKS_MUTED = 1;

/** A dismissed note and the tick the player dismissed it on. */
export interface DismissedMessage extends UserMessage {
  readonly dismissedAt: number;
}

export interface MessageFeedState {
  readonly level: MessagePriorityLevel;
  readonly nextId: number;
  readonly live: readonly UserMessage[];
  readonly history: readonly DismissedMessage[];
}

/** `superseded`: a heavier stage of the settler's hunger chain is shown or dismissed. `full`: the strip
 *  is full and holds nothing the arrival may push off. */
export type MessageAddOutcome = 'accepted' | 'muted' | 'duplicate' | 'superseded' | 'full';

/** How many live notes carry each priority, indexed by level. */
export type MessageTally = readonly [routine: number, notable: number, important: number];

/**
 * The message manager: the notes it keeps, the dismissals it remembers, and the player's filter level.
 * The level only hides: a note below the bar stays live and counted, and raising the bar back shows it
 * again. Departs from the original, which drops filtered arrivals and the displayed notes under a raised
 * bar.
 */
export interface MessageFeed {
  level(): MessagePriorityLevel;
  setLevel(level: MessagePriorityLevel): void;
  cycleLevel(): MessagePriorityLevel;
  /** `compose` runs only for an accepted message, so a flood of repeats costs no text. `stackStages`
   *  gives every hunger stage its own card, for the gallery that shows each row. */
  add(
    pending: PendingMessage,
    tick: number,
    compose: () => MessageText,
    stackStages?: boolean,
  ): MessageAddOutcome;
  /** Dismiss one note on `tick`; its repeat stays away while its state lasts, or for the event block. */
  remove(id: number, tick: number): boolean;
  /** Dismiss several notes on `tick` as one change, each remembered on its own as `remove` does. */
  removeMany(ids: ReadonlySet<number>, tick: number): boolean;
  /** Dismiss every note the level shows; the ones hidden under it were never seen, so they stay. */
  removeAll(tick: number): void;
  /** Hand a standing note, shown or dismissed, the place, fight tally, stall or idle reason and text of
   *  its repeat `pending`; `compose` runs only when a fact the text reads changed. False when no note
   *  matches it. */
  revise(pending: PendingMessage, compose: () => MessageText): boolean;
  /** Drop notes and dismissals `over` reports as ended, event notes past their lifetime and event
   *  dismissals past their block. `ageless` skips both clocks, so only `over` ends anything. */
  expire(tick: number, over: (m: UserMessage) => boolean, ageless?: boolean): void;
  /** Every live note, in arrival order. */
  live(): readonly UserMessage[];
  /** The live notes at or above the level, in arrival order. */
  displayed(): readonly UserMessage[];
  tally(): MessageTally;
  find(id: number): UserMessage | undefined;
  /** Bumps on every change to the displayed list or the level, so a renderer keys its rebuild on it. */
  version(): number;
  state(): MessageFeedState;
}

export function defaultMessageFeedState(): MessageFeedState {
  return { level: DEFAULT_MESSAGE_LEVEL, nextId: 1, live: [], history: [] };
}

function subjectKey(subject: MessageSubject | null, about: number | null): string {
  return subject === null ? `about:${about ?? ''}` : `${subject.kind}:${subject.entity}`;
}

/**
 * The original's whole-record comparison, minus the stamp fields the feed assigns and minus the
 * position: a settler that walked between two raises still repeats one message, not two. A state note
 * is one per subject and reason, whatever trade the settler holds meanwhile.
 */
function identityKey(m: PendingMessage): string {
  if (lifecycleOf(m.type) === 'state') {
    return `${m.type}|${subjectKey(m.subject, m.about)}|${m.familyWait ?? ''}`;
  }
  const stance = m.stance ?? '';
  const technologies =
    m.technologies === null
      ? ''
      : m.technologies.map((technology) => `${technology.kind}:${technology.typeId}`).join(',');
  return `${m.type}|${subjectKey(m.subject, m.about)}|${m.goodType ?? ''}|${m.jobType ?? ''}|${technologies}|${m.familyWait ?? ''}|${stance}`;
}

/** The facts outside the identity a standing note's text reads; a fight's text changes with every hit. */
function wordedFacts(m: PendingMessage): string | null {
  if (m.fight !== undefined) return null;
  const idle =
    m.idle === undefined ? '' : m.idle === null ? 'none' : `${m.idle.kind}:${m.idle.goodType ?? ''}`;
  return `${m.stall?.reason ?? ''}:${m.stall?.goodType ?? ''}|${idle}`;
}

/** The note to push off a full strip for `arrival`, or undefined when none may go: any lighter note, or
 *  one of the arrival's own priority the sweep brings back on its own, unless the arrival is such a note
 *  itself (two polled notes would push each other off every sweep). The lightest goes first, a polled
 *  one before one that would be lost, the oldest before a newer one. */
function evictionFor(live: readonly UserMessage[], arrival: PendingMessage): UserMessage | undefined {
  const priority = messagePriority(arrival.type);
  const arrivalPolled = isPolledNote(arrival.type);
  const goesBefore = (m: UserMessage, other: UserMessage): boolean =>
    m.priority !== other.priority
      ? m.priority < other.priority
      : isPolledNote(m.type) && !isPolledNote(other.type);
  let victim: UserMessage | undefined;
  for (const m of live) {
    const mayGo =
      m.priority < priority || (m.priority === priority && !arrivalPolled && isPolledNote(m.type));
    if (mayGo && (victim === undefined || goesBefore(m, victim))) victim = m;
  }
  return victim;
}

function sameSubject(a: PendingMessage, b: PendingMessage): boolean {
  return subjectKey(a.subject, a.about) === subjectKey(b.subject, b.about);
}

/** One of the two buffers: insertion order plus an identity index for the exact-match test. */
class MessageList<T extends UserMessage> {
  readonly items: T[] = [];
  private readonly byKey = new Map<string, number>();

  constructor(initial: readonly T[]) {
    for (const m of initial) this.push(m);
  }

  push(m: T): void {
    this.items.push(m);
    this.byKey.set(identityKey(m), (this.byKey.get(identityKey(m)) ?? 0) + 1);
  }

  /** Drop the first entry `drop` picks, if any. */
  dropFirst(drop: (m: T) => boolean): void {
    const at = this.items.findIndex(drop);
    const [first] = at < 0 ? [] : this.items.splice(at, 1);
    if (first !== undefined) this.uncount(first);
  }

  /** Swap the entry matching `pending` for `revised(entry)`, answering both; undefined when none matches. */
  replace(
    pending: PendingMessage,
    revised: (m: T) => T,
  ): { readonly before: T; readonly after: T } | undefined {
    if (!this.matches(pending)) return undefined;
    const key = identityKey(pending);
    const at = this.items.findIndex((m) => identityKey(m) === key);
    const before = this.items[at];
    if (before === undefined) return undefined;
    const after = revised(before);
    this.items[at] = after;
    return { before, after };
  }

  matches(pending: PendingMessage): boolean {
    return (this.byKey.get(identityKey(pending)) ?? 0) > 0;
  }

  /** Remove every entry `keep` rejects, handing each to `dropped`; true when anything went. */
  prune(keep: (m: T) => boolean, dropped?: (m: T) => void): boolean {
    let firstDrop = -1;
    for (let i = 0; i < this.items.length; i++) {
      const m = this.items[i];
      if (m !== undefined && !keep(m)) {
        firstDrop = i;
        break;
      }
    }
    if (firstDrop < 0) return false;
    const kept = this.items.slice(0, firstDrop);
    for (let i = firstDrop; i < this.items.length; i++) {
      const m = this.items[i];
      if (m === undefined) continue;
      if (keep(m)) kept.push(m);
      else {
        this.uncount(m);
        dropped?.(m);
      }
    }
    this.items.length = 0;
    this.items.push(...kept);
    return true;
  }

  private uncount(m: T): void {
    const key = identityKey(m);
    const count = (this.byKey.get(key) ?? 1) - 1;
    if (count <= 0) this.byKey.delete(key);
    else this.byKey.set(key, count);
  }
}

export function createMessageFeed(initial: MessageFeedState = defaultMessageFeedState()): MessageFeed {
  let level = initial.level;
  let nextId = initial.nextId;
  const live = new MessageList<UserMessage>(initial.live);
  const history = new MessageList<DismissedMessage>(initial.history);
  let version = 0;

  const dismiss = (keep: (m: UserMessage) => boolean, tick: number): boolean => {
    const changed = live.prune(keep, (m) => {
      if (history.items.length >= MESSAGE_SLOTS) history.dropFirst((d) => lifecycleOf(d.type) === 'event');
      history.push({ ...m, dismissedAt: tick });
    });
    if (changed) version++;
    return changed;
  };

  /** Whether a heavier stage of the pending note's hunger chain stands for the same settler, shown or
   *  dismissed. A dismissed heavier card silences the lighter stages until its own cause passes. */
  const heavierStageHeld = (pending: PendingMessage, stage: number): boolean => {
    return HUNGER_CHAIN.slice(stage + 1).some((heavier) => {
      const held = { ...pending, type: heavier };
      return live.matches(held) || history.matches(held);
    });
  };

  const setLevel = (next: MessagePriorityLevel): void => {
    if (next === level) return;
    level = next;
    version++;
  };

  return {
    level: () => level,
    setLevel,
    cycleLevel: () => {
      setLevel(cycleMessageLevel(level));
      return level;
    },
    add: (pending, tick, compose, stackStages = false): MessageAddOutcome => {
      if (tick <= SETUP_TICKS_MUTED) return 'muted';
      if (history.matches(pending)) return 'duplicate';
      const stage = stackStages ? undefined : hungerStageOf(pending.type);
      if (stage !== undefined && heavierStageHeld(pending, stage)) return 'superseded';
      if (live.matches(pending)) return 'duplicate';
      // A heavier stage or a newer reading takes the earlier card's place before any room is sought.
      if (stage !== undefined && stage > 0) {
        live.prune((m) => {
          const lighter = hungerStageOf(m.type);
          return lighter === undefined || lighter >= stage || !sameSubject(m, pending);
        });
      }
      if (keepsLatestOnly(pending.type)) {
        const earlier = (m: UserMessage): boolean => m.type !== pending.type || !sameSubject(m, pending);
        live.prune(earlier);
        history.prune(earlier);
      }
      if (live.items.length >= MESSAGE_SLOTS) {
        const victim = evictionFor(live.items, pending);
        if (victim === undefined) return 'full';
        live.prune((m) => m !== victim);
      }
      live.push({ ...pending, id: nextId, priority: messagePriority(pending.type), tick, text: compose() });
      nextId++;
      version++;
      return 'accepted';
    },
    remove: (id, tick) => dismiss((m) => m.id !== id, tick),
    removeMany: (ids, tick) => dismiss((m) => !ids.has(m.id), tick),
    revise: (pending, compose) => {
      const facts = wordedFacts(pending);
      const update = <T extends UserMessage>(m: T): T =>
        facts !== null && facts === wordedFacts(m)
          ? m
          : {
              ...m,
              at: pending.at,
              ...(pending.fight === undefined ? {} : { fight: pending.fight }),
              ...(pending.stall === undefined ? {} : { stall: pending.stall, goodType: pending.goodType }),
              ...(pending.idle === undefined ? {} : { idle: pending.idle }),
              text: compose(),
            };
      const shown = live.replace(pending, update);
      if (shown === undefined) return history.replace(pending, update) !== undefined;
      // The place moves with every hit, but only a new text redraws the column.
      const { before, after } = shown;
      if (after.text.short !== before.text.short || after.text.full !== before.text.full) version++;
      return true;
    },
    removeAll: (tick) => {
      dismiss((m) => !messagePassesFilter(m.priority, level), tick);
    },
    expire: (tick, over, ageless = false) => {
      const isEvent = (m: UserMessage): boolean => !ageless && lifecycleOf(m.type) === 'event';
      if (live.prune((m) => !(isEvent(m) && tick - m.tick >= MESSAGE_LIFETIME_TICKS) && !over(m))) version++;
      history.prune((m) => !(isEvent(m) && tick - m.dismissedAt >= DISMISSED_EVENT_BLOCK_TICKS) && !over(m));
    },
    live: () => live.items,
    displayed: () => live.items.filter((m) => messagePassesFilter(m.priority, level)),
    tally: () => {
      const counts: [number, number, number] = [0, 0, 0];
      for (const m of live.items) counts[m.priority]++;
      return counts;
    },
    find: (id) => live.items.find((m) => m.id === id),
    version: () => version,
    state: () => ({ level, nextId, live: [...live.items], history: [...history.items] }),
  };
}
