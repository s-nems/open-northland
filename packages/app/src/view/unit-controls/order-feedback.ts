import type { UiCue } from '@open-northland/audio';

/** A fresh formation query delays only its own press's confirmation, not later selection feedback. */
export function createOrderFeedback(play: ((kind: UiCue) => void) | undefined): {
  cue(kind: UiCue): void;
  deferGroundConfirmation(): () => void;
} {
  let deferred: { requested: boolean } | undefined;
  return {
    cue: (kind) => {
      if (kind === 'confirm' && deferred !== undefined) {
        deferred.requested = true;
        deferred = undefined;
      } else play?.(kind);
    },
    deferGroundConfirmation: () => {
      const press = { requested: false };
      deferred = press;
      // The caller acknowledges input synchronously. Other input after that press keeps its own cue.
      queueMicrotask(() => {
        if (deferred === press) deferred = undefined;
      });
      return () => {
        if (press.requested) play?.('confirm');
      };
    },
  };
}
