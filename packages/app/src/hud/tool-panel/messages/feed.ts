import {
  cycleMessageLevel,
  DEFAULT_MESSAGE_LEVEL,
  messagePassesFilter,
  messagePriority,
} from './priority.js';
import {
  type MessagePriorityLevel,
  type MessageSubject,
  type PendingMessage,
  USER_MESSAGE_TYPE,
  type UserMessage,
  type UserMessageType,
} from './types.js';

/** Ticks a note stays on the strip, and a dismissed note keeps its repeat away (approximation: macOS
 *  build symbols). */
export const MESSAGE_LIFETIME_TICKS = 3600;
/** Slots in each of the displayed and the history buffer; a full strip rejects arrivals (approximation:
 *  macOS build symbols). */
export const MESSAGE_SLOTS = 200;
/** Events raised while the world is still being assembled never become notes: authored spawns land on
 *  the first step, and every adult they place would otherwise be announced as born. */
const SETUP_TICKS_MUTED = 1;
/** Two settlers missing the same good within this many cells raise one note (approximation: macOS build
 *  symbols, with a Chebyshev cell metric standing in for the original's hex distance). */
export const SIMILAR_MESSAGE_RANGE_CELLS = 21;
const SIMILAR_TYPES: ReadonlySet<UserMessageType> = new Set<UserMessageType>([
  USER_MESSAGE_TYPE.goodNotFound,
  USER_MESSAGE_TYPE.buildMaterialNotFound,
  USER_MESSAGE_TYPE.homeNotFound,
  USER_MESSAGE_TYPE.equipmentNotFound,
]);
const NODES_PER_CELL = 2;

export interface MessageFeedState {
  readonly level: MessagePriorityLevel;
  readonly nextId: number;
  readonly displayed: readonly UserMessage[];
  readonly history: readonly UserMessage[];
}

export type MessageAddOutcome = 'accepted' | 'muted' | 'duplicate' | 'full' | 'filtered';

/** The message manager: what the strip shows, what it remembers, and the player's filter level. */
export interface MessageFeed {
  level(): MessagePriorityLevel;
  /** Lowering the bar shows only messages raised from now on; raising it drops the notes below it. */
  setLevel(level: MessagePriorityLevel): void;
  cycleLevel(): MessagePriorityLevel;
  /** `compose` runs only for an accepted message, so a flood of repeats costs no text. */
  add(pending: PendingMessage, tick: number, compose: () => string): MessageAddOutcome;
  /** Dismiss one note; `toHistory` keeps its repeat away for the lifetime. */
  remove(id: number, toHistory: boolean): boolean;
  removeAll(toHistory: boolean): void;
  /** Drop notes past their lifetime and notes whose subject `alive` no longer knows. */
  expire(tick: number, alive: (subject: MessageSubject) => boolean): void;
  displayed(): readonly UserMessage[];
  find(id: number): UserMessage | undefined;
  /** Bumps on every change to the displayed list or the level, so a renderer keys its rebuild on it. */
  version(): number;
  state(): MessageFeedState;
}

export function defaultMessageFeedState(): MessageFeedState {
  return { level: DEFAULT_MESSAGE_LEVEL, nextId: 1, displayed: [], history: [] };
}

/** The original's whole-record comparison, minus the stamp fields the feed assigns and minus the
 *  position: a settler that walked between two raises still repeats one message, not two. */
function identityKey(m: PendingMessage): string {
  const subject = m.subject === null ? `about:${m.about ?? ''}` : `${m.subject.kind}:${m.subject.entity}`;
  return `${m.type}|${subject}|${m.goodType ?? ''}|${m.jobType ?? ''}`;
}

/** Two "cannot find" complaints about one good from settlers standing close together. */
function similarMessage(a: PendingMessage, b: PendingMessage): boolean {
  if (a.type !== b.type || a.goodType !== b.goodType) return false;
  if (a.subject?.kind !== 'settler' || b.subject?.kind !== 'settler') return false;
  if (a.at === null || b.at === null) return false;
  const dx = Math.abs(a.at.hx - b.at.hx) / NODES_PER_CELL;
  const dy = Math.abs(a.at.hy - b.at.hy) / NODES_PER_CELL;
  return Math.max(dx, dy) < SIMILAR_MESSAGE_RANGE_CELLS;
}

function expired(m: UserMessage, tick: number): boolean {
  return tick - m.tick >= MESSAGE_LIFETIME_TICKS;
}

/** One of the two buffers: insertion order plus an identity index for the exact-match test. */
class MessageList {
  readonly items: UserMessage[] = [];
  private readonly byKey = new Map<string, number>();

  constructor(initial: readonly UserMessage[]) {
    for (const m of initial) this.push(m);
  }

  push(m: UserMessage): void {
    this.items.push(m);
    this.byKey.set(identityKey(m), (this.byKey.get(identityKey(m)) ?? 0) + 1);
  }

  /** Drop the front entry, for a full history rolling over. */
  shift(): void {
    const first = this.items.shift();
    if (first !== undefined) this.uncount(first);
  }

  matches(pending: PendingMessage): boolean {
    if ((this.byKey.get(identityKey(pending)) ?? 0) > 0) return true;
    if (!SIMILAR_TYPES.has(pending.type)) return false;
    return this.items.some((m) => similarMessage(m, pending));
  }

  /** Remove every entry `keep` rejects, handing each to `dropped`; true when anything went. */
  prune(keep: (m: UserMessage) => boolean, dropped?: (m: UserMessage) => void): boolean {
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

  private uncount(m: UserMessage): void {
    const key = identityKey(m);
    const count = (this.byKey.get(key) ?? 1) - 1;
    if (count <= 0) this.byKey.delete(key);
    else this.byKey.set(key, count);
  }
}

export function createMessageFeed(initial: MessageFeedState = defaultMessageFeedState()): MessageFeed {
  let level = initial.level;
  let nextId = initial.nextId;
  const displayed = new MessageList(initial.displayed);
  const history = new MessageList(initial.history);
  let version = 0;

  const remember = (m: UserMessage): void => {
    if (history.items.length >= MESSAGE_SLOTS) history.shift();
    history.push(m);
  };

  const dropDisplayed = (keep: (m: UserMessage) => boolean, toHistory: boolean): boolean => {
    const changed = displayed.prune(keep, toHistory ? remember : undefined);
    if (changed) version++;
    return changed;
  };

  const setLevel = (next: MessagePriorityLevel): void => {
    if (next === level) return;
    level = next;
    version++;
    dropDisplayed((m) => messagePassesFilter(m.priority, level), false);
  };

  return {
    level: () => level,
    setLevel,
    cycleLevel: () => {
      setLevel(cycleMessageLevel(level));
      return level;
    },
    add: (pending, tick, compose): MessageAddOutcome => {
      if (tick <= SETUP_TICKS_MUTED) return 'muted';
      if (history.matches(pending)) return 'duplicate';
      if (displayed.items.length >= MESSAGE_SLOTS) return 'full';
      const priority = messagePriority(pending.type, pending.jobType);
      if (!messagePassesFilter(priority, level)) return 'filtered';
      if (displayed.matches(pending)) return 'duplicate';
      displayed.push({ ...pending, id: nextId, priority, tick, text: compose() });
      nextId++;
      version++;
      return 'accepted';
    },
    remove: (id, toHistory) => dropDisplayed((m) => m.id !== id, toHistory),
    removeAll: (toHistory) => {
      dropDisplayed(() => false, toHistory);
    },
    expire: (tick, alive) => {
      const live = (m: UserMessage): boolean => !expired(m, tick) && (m.subject === null || alive(m.subject));
      dropDisplayed(live, false);
      history.prune(live);
    },
    displayed: () => displayed.items,
    find: (id) => displayed.items.find((m) => m.id === id),
    version: () => version,
    state: () => ({ level, nextId, displayed: [...displayed.items], history: [...history.items] }),
  };
}
