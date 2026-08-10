import type { SoundDriver } from '@open-northland/audio';

/** Gestures that grant user activation: pointerdown does so only for mice, so pointerup covers touch
 *  and keydown the keyboard. */
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'keydown'] as const;

export interface GestureSource {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Starts audio as soon as the autoplay gate allows: the activation the menu's launch click granted is
 *  sticky and survives the handover, so such a document needs no further gesture. Asking without it only
 *  earns a suspended context and a browser warning, so a document that has none waits for its gesture. */
export function startSound(
  sound: Pick<SoundDriver, 'resume' | 'started'>,
  gestures: GestureSource = window,
  // `Navigator.userActivation` is typed as always present but is absent on browsers that don't report it.
  activation: Pick<UserActivation, 'hasBeenActive'> | null = navigator.userActivation ?? null,
): void {
  const resume = (): void => {
    void sound
      .resume()
      .then(() => {
        if (!sound.started) return;
        for (const event of GESTURE_EVENTS) gestures.removeEventListener(event, resume);
      })
      // Resuming can throw (e.g. a context-count cap); staying silent beats crashing the view.
      .catch(() => undefined);
  };
  for (const event of GESTURE_EVENTS) gestures.addEventListener(event, resume);
  if (activation?.hasBeenActive === true) resume();
}
