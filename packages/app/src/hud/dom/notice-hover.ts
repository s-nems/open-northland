/** How long the pointer rests on a stack's card before its members list (ms), so a pointer crossing the
 *  column opens nothing on its way. */
export const HOVER_OPEN_DWELL_MS = 350;
/** How long the pointer may be off a hover-opened stack before it closes (ms), so the gap between the
 *  card and its rows does not flicker it. */
export const HOVER_CLOSE_DELAY_MS = 300;
/** How far the pointer moves (CSS px) after a stack closed before hover may open one again. Closing
 *  shifts the cards below; one that slid under a still pointer must not open itself. */
export const HOVER_REARM_PX = 4;

export interface PointerAt {
  readonly x: number;
  readonly y: number;
}

/** `open` and `leaving` are previews hover opened; `pinned` was opened by a press or a key and ignores
 *  the pointer. */
export type StackHoverPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'dwell'; readonly key: string; readonly since: number }
  | { readonly kind: 'open'; readonly key: string }
  | { readonly kind: 'leaving'; readonly key: string; readonly since: number }
  | { readonly kind: 'pinned'; readonly key: string };

export interface StackHover {
  readonly phase: StackHoverPhase;
  readonly pointer: PointerAt | null;
  /** Where the pointer stood when the last stack closed, until it has moved `HOVER_REARM_PX` away. */
  readonly held: PointerAt | null;
}

export type StackHoverAction =
  | { readonly kind: 'open'; readonly key: string }
  | { readonly kind: 'close' }
  | null;

export interface StackHoverStep {
  readonly state: StackHover;
  readonly action: StackHoverAction;
}

export const STACK_HOVER_IDLE: StackHover = { phase: { kind: 'idle' }, pointer: null, held: null };

const still = (state: StackHover): StackHoverStep => ({ state, action: null });

/** The stack this state holds open, by hover or pinned. */
export function hoverOpenKey(state: StackHover): string | null {
  const { phase } = state;
  return phase.kind === 'open' || phase.kind === 'leaving' || phase.kind === 'pinned' ? phase.key : null;
}

/**
 * The pointer moved to `pointer`, or the column moved under it, and now rests on the stack `over`: a
 * stack's card or the open stack's rows. `null` is anywhere else: a lone card, a gap, off the list.
 */
export function hoverPointer(
  state: StackHover,
  over: string | null,
  pointer: PointerAt,
  now: number,
): StackHoverStep {
  const held =
    state.held !== null && Math.hypot(pointer.x - state.held.x, pointer.y - state.held.y) < HOVER_REARM_PX
      ? state.held
      : null;
  const at = (phase: StackHoverPhase): StackHoverStep => still({ phase, pointer, held });
  const { phase } = state;
  switch (phase.kind) {
    case 'pinned':
      return at(phase);
    case 'open':
      return at(over === phase.key ? phase : { kind: 'leaving', key: phase.key, since: now });
    case 'leaving':
      return at(over === phase.key ? { kind: 'open', key: phase.key } : phase);
    case 'dwell':
    case 'idle':
      if (over === null || held !== null) return at({ kind: 'idle' });
      if (phase.kind === 'dwell' && phase.key === over) return at(phase);
      return at({ kind: 'dwell', key: over, since: now });
  }
}

/** When `hoverTick` next has something to do, or null while nothing waits on time. */
export function hoverDue(state: StackHover): number | null {
  const { phase } = state;
  if (phase.kind === 'dwell') return phase.since + HOVER_OPEN_DWELL_MS;
  if (phase.kind === 'leaving') return phase.since + HOVER_CLOSE_DELAY_MS;
  return null;
}

/** Time passed: a finished dwell opens its stack, a finished leave closes it. */
export function hoverTick(state: StackHover, now: number): StackHoverStep {
  const due = hoverDue(state);
  if (due === null || now < due) return still(state);
  const { phase } = state;
  if (phase.kind === 'dwell') {
    return {
      state: { ...state, phase: { kind: 'open', key: phase.key } },
      action: { kind: 'open', key: phase.key },
    };
  }
  return { state: hoverClosed(state), action: { kind: 'close' } };
}

/** A press or a key opened `key`, or kept the preview open: the pointer no longer closes it. */
export function hoverPinned(state: StackHover, key: string): StackHover {
  return { ...state, phase: { kind: 'pinned', key } };
}

/** The open stack closed, whatever closed it. Hover opens nothing until the pointer moves on. */
export function hoverClosed(state: StackHover): StackHover {
  return { phase: { kind: 'idle' }, pointer: state.pointer, held: state.pointer };
}

/** Match the stack the column lists: one it opened without hover is pinned, one it closed is closed. */
export function hoverListing(state: StackHover, listed: string | null): StackHover {
  if (hoverOpenKey(state) === listed) return state;
  return listed === null ? hoverClosed(state) : hoverPinned(state, listed);
}

export interface StackHoverDeps {
  /** The stack whose card or rows `target` is in, or null. */
  readonly over: (target: EventTarget | null) => string | null;
  readonly open: (key: string) => void;
  readonly close: () => void;
}

/** The column's hover previews over `list`, driven by a mouse; touch and pen keep to presses. */
export interface StackHoverDriver {
  pin(key: string): void;
  isPinned(key: string): boolean;
  /** The column closed the open stack itself: a key, a press elsewhere, a dismissal. */
  closed(): void;
  /** The stack the column lists after a render. */
  listing(key: string | null): void;
  dispose(): void;
}

export function driveStackHover(list: HTMLElement, deps: StackHoverDeps): StackHoverDriver {
  let state = STACK_HOVER_IDLE;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = undefined;
    const due = hoverDue(state);
    if (due === null) return;
    timer = setTimeout(
      () => apply(hoverTick(state, performance.now())),
      Math.max(0, due - performance.now()),
    );
  };
  const apply = (step: StackHoverStep): void => {
    state = step.state;
    schedule();
    if (step.action?.kind === 'open') deps.open(step.action.key);
    else if (step.action?.kind === 'close') deps.close();
  };
  const onPointer = (event: PointerEvent, over: string | null): void => {
    if (event.pointerType !== 'mouse') return;
    apply(hoverPointer(state, over, { x: event.clientX, y: event.clientY }, performance.now()));
  };
  const onMove = (event: PointerEvent): void => onPointer(event, deps.over(event.target));
  const onLeave = (event: PointerEvent): void => onPointer(event, null);
  list.addEventListener('pointermove', onMove);
  list.addEventListener('pointerover', onMove);
  list.addEventListener('pointerleave', onLeave);
  return {
    pin: (key): void => {
      state = hoverPinned(state, key);
      schedule();
    },
    isPinned: (key): boolean => state.phase.kind === 'pinned' && state.phase.key === key,
    closed: (): void => {
      state = hoverClosed(state);
      schedule();
    },
    listing: (key): void => {
      state = hoverListing(state, key);
      schedule();
    },
    dispose: (): void => {
      clearTimeout(timer);
      list.removeEventListener('pointermove', onMove);
      list.removeEventListener('pointerover', onMove);
      list.removeEventListener('pointerleave', onLeave);
    },
  };
}
