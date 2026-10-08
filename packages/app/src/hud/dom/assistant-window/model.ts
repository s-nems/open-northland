import { components, TICKS_PER_SECOND } from '@open-northland/sim';
import type { Rect } from '../../geometry.js';
import type { ScreenSize } from '../../nav-beam.js';
import { centralWindowBox, centralWindowOrigin } from '../../regions.js';
import type { CounterRange } from '../parts/counter.js';

/** Design px. Wide: the orders column beside two standing-order columns. Narrow: the standing orders
 *  in one column beside the orders, scrolled; `foundation.css` switches the layout by the body's width. */
export const ASSISTANT_WINDOW_WIDE_W = 1040;
export const ASSISTANT_WINDOW_NARROW_W = 700;

/** The wide window only where it sits centred: on a screen that fits it beside the minimap without the
 *  placer pushing it off centre or against the right edge; the narrow one elsewhere. */
export function assistantWindowWidth(screen: ScreenSize, overlay: Rect | null): number {
  const wide = centralWindowBox(screen, 1, ASSISTANT_WINDOW_WIDE_W, overlay);
  const centred = centralWindowOrigin(screen, 1, ASSISTANT_WINDOW_WIDE_W).x;
  const fits = wide.x === centred && wide.x + ASSISTANT_WINDOW_WIDE_W <= screen.width;
  return fits ? ASSISTANT_WINDOW_WIDE_W : ASSISTANT_WINDOW_NARROW_W;
}

type CounterKind = components.AssistantCounterKind;
type CounterState = components.AssistantCounterState;
type RecruitIntent = components.AssistantRecruitIntent;

/** The stepper's one-number face of a counter: the finite value, or this sentinel above the sim's cap
 *  while the queue never drains. */
export const UNLIMITED_FACE = components.ASSISTANT_COUNTER_MAX + 1;

/** The sim's own `setAssistantCounter` clamp, so the steppers stop where the command would; only the
 *  kinds the sim lets run forever get the ∞ step. Approximation: the original's counters appear to stop
 *  at 20 with no ∞ (unconfirmed against the running original); this range and ∞ are the sim's own. */
export function counterRange(kind: CounterKind): CounterRange {
  const finite = { min: components.ASSISTANT_COUNTER_MIN, max: components.ASSISTANT_COUNTER_MAX };
  return components.INFINITE_COUNTER_KINDS.has(kind) ? { ...finite, unlimited: UNLIMITED_FACE } : finite;
}

export const counterFace = (state: CounterState): number => (state.infinite ? UNLIMITED_FACE : state.value);

/** The counter state a stepper face asks for. ∞ keeps the finite value the sim retains under it. */
export function counterFromFace(current: CounterState, face: number): CounterState {
  return face >= UNLIMITED_FACE ? { value: current.value, infinite: true } : { value: face, infinite: false };
}

export const sameCounter = (a: CounterState, b: CounterState): boolean =>
  a.value === b.value && a.infinite === b.infinite;

/** The seat's assistant orders in flight, read off the bookings the sim keeps on the people it sent. */
export interface AssistantBookings {
  /** Wives with a standing child order the counters booked, by the child's sex. */
  readonly daughters: number;
  readonly sons: number;
  /** Recruits still drilling in a barracks, by the counter that sent them. */
  readonly drilling: Readonly<Record<RecruitIntent, number>>;
  /** Drilled class recruits that have not taken up their weapon yet. */
  readonly arming: Readonly<Record<RecruitIntent, number>>;
}

/** A zero count per recruit intent, to tally bookings into. */
export const perIntent = (): Record<RecruitIntent, number> => ({
  trainSoldiers: 0,
  trainSword: 0,
  trainSpear: 0,
  trainBow: 0,
});

export const NO_BOOKINGS: AssistantBookings = {
  daughters: 0,
  sons: 0,
  drilling: perIntent(),
  arming: perIntent(),
};

/** One fact a row's status marks state. */
export type StatusNoteKey =
  | 'expected'
  | 'needsCouple'
  | 'drilling'
  | 'fetchingWeapon'
  | 'needsWeapon'
  | 'needsMen';
/** The facts about what still waits to be booked, the only ones an endless counter leaves uncounted. */
export type WaitingNoteKey = Extract<StatusNoteKey, 'needsCouple' | 'needsMen'>;

export type StatusNote =
  | { readonly key: StatusNoteKey; readonly count: number }
  | { readonly key: WaitingNoteKey; readonly count: null };

export type StatusTone = 'busy' | 'warn' | 'idle';

/** Green while the assistant works, amber where a weapon the player lacks holds it up, plain while it
 *  waits for the settlement to offer someone. */
export const NOTE_TONE: Readonly<Record<StatusNoteKey, StatusTone>> = {
  expected: 'busy',
  needsCouple: 'idle',
  drilling: 'busy',
  fetchingWeapon: 'busy',
  needsWeapon: 'warn',
  needsMen: 'idle',
};

/** What is left to book: the counter less its orders in flight, null while it never drains. */
function unbooked(counter: CounterState, booked: number): number | null {
  return counter.infinite ? null : counter.value - booked;
}

const waiting = (key: WaitingNoteKey, left: number | null): StatusNote =>
  left === null ? { key, count: null } : { key, count: left };

/**
 * A birth counter's line: the children booked, then what still waits for a free couple. A counter run
 * to zero with a child still booked keeps telling it, since that child is born all the same.
 */
export function birthNotes(counter: CounterState, booked: number): readonly StatusNote[] {
  const notes: StatusNote[] = [];
  if (booked > 0) notes.push({ key: 'expected', count: booked });
  const left = unbooked(counter, booked);
  // An endless queue only says it waits while nothing at all is booked.
  if (left === null ? booked === 0 : left > 0) notes.push(waiting('needsCouple', left));
  return notes;
}

export interface TrainingFacts {
  readonly drilling: number;
  readonly arming: number;
  /** Whether a weapon this class may take lies in the seat's stock; null for the class with none. */
  readonly weaponStocked: boolean | null;
}

/**
 * A training counter's line: recruits in the barracks, recruits on their way to a weapon (or stuck for
 * one), then what still waits for a free man. The dispatcher counts every unarmed
 * booking against its counter, so those are what is left to book.
 */
export function trainingNotes(counter: CounterState, facts: TrainingFacts): readonly StatusNote[] {
  const notes: StatusNote[] = [];
  if (facts.drilling > 0) notes.push({ key: 'drilling', count: facts.drilling });
  if (facts.arming > 0) {
    notes.push({
      key: facts.weaponStocked === false ? 'needsWeapon' : 'fetchingWeapon',
      count: facts.arming,
    });
  }
  const booked = facts.drilling + facts.arming;
  const left = unbooked(counter, booked);
  if (left === null ? booked === 0 : left > 0) notes.push(waiting('needsMen', left));
  return notes;
}

/**
 * Whether a recruit of a class can still find a weapon: its own in stock, or the weaker one while its
 * switch allows it. Approximation: the seat's stock counts goods carried and heaps in reach, where the
 * arming pass needs a store it can reach, so a weapon cut off on another island still reads as stocked.
 */
export function weaponStocked(weapon: number, weaker: number, weakerAllowed: boolean): boolean {
  return weapon > 0 || (weakerAllowed && weaker > 0);
}

/** How long a pressed value stands over the live one while its command travels: past a multiplayer
 *  round trip, so a second quick press steps on from the first instead of from the stale value. */
export const PRESS_HOLD_TICKS = 3 * TICKS_PER_SECOND;

/** The values the player pressed that the sim has not shown yet, each shown in place of the live one
 *  until the live one has moved off what it was at the press and then matches it, or the hold runs out
 *  (a counter that drained meanwhile never matches). A live value still equal to a press made away and
 *  back before either command landed is not taken for the answer. */
export class PressHold<K, T> {
  private readonly held = new Map<
    K,
    { readonly value: T; readonly base: T; readonly tick: number; moved: boolean }
  >();

  constructor(private readonly same: (a: T, b: T) => boolean) {}

  /** `live` is what the sim showed when the press was made. */
  hold(key: K, value: T, live: T, tick: number): void {
    this.held.set(key, { value, base: live, tick, moved: false });
  }

  shown(key: K, live: T, tick: number): T {
    const held = this.held.get(key);
    if (held === undefined) return live;
    if (!this.same(held.base, live)) held.moved = true;
    if ((held.moved && this.same(held.value, live)) || tick - held.tick > PRESS_HOLD_TICKS) {
      this.held.delete(key);
      return live;
    }
    return held.value;
  }
}
