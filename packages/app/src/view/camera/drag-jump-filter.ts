/**
 * Drops the mouse jumps a pointer-locked drag can report that the hand never made. Under a pointer
 * lock a browser computes `movementX/Y` from a virtual cursor position it keeps itself, and warps the
 * hidden cursor back toward the window centre once it nears the window border. When the warp's own
 * move is not recognised, the renderer reports the warp distance as movement: a third of the window
 * in one event, often followed by the same distance back.
 *
 * A step is an outlier when it is far above both a floor and the recent accepted steps, after
 * scaling by its frame gap so a long frame's accumulated motion is not mistaken for a jump. One
 * outlier is held back. A following step the same way and within the ratio of it confirms a fast
 * throw and both are applied together; an outlier the opposite way is the warp-back and both are
 * dropped; anything else drops the held outlier alone.
 */

/** Mouse movement in client px with the frame gap it arrived over. */
export interface DragStep {
  readonly dx: number;
  readonly dy: number;
  /** Ms since the previous step; `undefined` when the event clock gave none. */
  readonly dtMs: number | undefined;
}

export interface DroppedJump {
  /** `isolated`: one outlier between normal steps; `reversal`: an outlier pair pointing back. */
  readonly reason: 'isolated' | 'reversal';
  readonly steps: readonly DragStep[];
}

/** The movement to apply now, zero while an outlier is held, with the jump this step settled by dropping. */
export interface DragStepResult {
  readonly dx: number;
  readonly dy: number;
  readonly dropped?: DroppedJump;
}

export interface DragJumpFilter {
  step(step: DragStep): DragStepResult;
  /** Forget the drag; an outlier still held at its end is returned, never applied. */
  reset(): DroppedJump | undefined;
}

/** The frame gap step sizes are normalised to, one display frame at 60 Hz. */
export const REFERENCE_FRAME_MS = 1000 / 60;
/** Gaps below this count as this long, so two events in one ms do not inflate a small step. */
const MIN_FRAME_MS = 4;
/** Normalised client px a step must exceed before it can be an outlier at all. Approximation: a warp
 *  across 15 percent of a 720 px tall window is about 250 px; a hand from rest rarely reaches this
 *  in one frame. */
export const JUMP_FLOOR_PX = 250;
/** A step this many times the largest recent accepted step is an outlier above the floor. */
export const JUMP_RATIO = 3;
/** Accepted steps the ratio looks back over. */
const RECENT_STEPS = 4;

/** Step length per reference frame, so a step that arrived over a long frame counts as motion spread
 *  over that frame rather than as a jump. */
export function normalisedStepPx(step: DragStep): number {
  const length = Math.hypot(step.dx, step.dy);
  if (step.dtMs === undefined || !Number.isFinite(step.dtMs)) return length;
  return (length * REFERENCE_FRAME_MS) / Math.max(step.dtMs, MIN_FRAME_MS);
}

export function createDragJumpFilter(): DragJumpFilter {
  const recent: number[] = [];
  let held: DragStep | null = null;
  const accept = (step: DragStep): void => {
    recent.push(normalisedStepPx(step));
    if (recent.length > RECENT_STEPS) recent.shift();
  };
  const isOutlier = (step: DragStep): boolean => {
    const threshold = Math.max(JUMP_FLOOR_PX, JUMP_RATIO * Math.max(0, ...recent));
    return normalisedStepPx(step) > threshold;
  };
  return {
    step: (step) => {
      const previous = held;
      held = null;
      let dropped: DroppedJump | undefined;
      if (previous !== null) {
        const direction = previous.dx * step.dx + previous.dy * step.dy;
        // A throw keeps going: the next step points the same way and is within the outlier ratio of
        // the held one. A warp is followed by its return or by ordinary steps.
        const continues = direction > 0 && normalisedStepPx(step) * JUMP_RATIO >= normalisedStepPx(previous);
        if (continues) {
          accept(previous);
          accept(step);
          return { dx: previous.dx + step.dx, dy: previous.dy + step.dy };
        }
        if (direction < 0 && isOutlier(step)) {
          return { dx: 0, dy: 0, dropped: { reason: 'reversal', steps: [previous, step] } };
        }
        dropped = { reason: 'isolated', steps: [previous] };
      }
      if (isOutlier(step)) {
        held = step;
        return { dx: 0, dy: 0, ...(dropped ? { dropped } : {}) };
      }
      accept(step);
      return { dx: step.dx, dy: step.dy, ...(dropped ? { dropped } : {}) };
    },
    reset: () => {
      const unfinished = held;
      recent.length = 0;
      held = null;
      return unfinished === null ? undefined : { reason: 'isolated', steps: [unfinished] };
    },
  };
}
