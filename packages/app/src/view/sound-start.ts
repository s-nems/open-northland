/** Gestures that grant user activation: pointerdown does so only for mice, so pointerup covers touch
 *  and keydown the keyboard. */
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'keydown'] as const;

/** An audio context the autoplay gate holds suspended: the game's driver, or the menu's own engine. */
export interface ResumableAudio {
  resume(): Promise<void>;
  readonly started: boolean;
}

export interface GestureSource {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface StartSoundEnv {
  readonly gestures?: GestureSource;
  /** `Navigator.userActivation` is typed as always present but is absent on browsers that don't report it. */
  readonly activation?: Pick<UserActivation, 'hasBeenActive'> | null;
  /** Drops the listeners for audio the page outlives, such as the menu's engine after a handover. */
  readonly signal?: AbortSignal;
}

/** Starts audio as soon as the autoplay gate allows: the activation the menu's launch click granted is
 *  sticky and survives the handover, so such a document needs no further gesture. Asking without it only
 *  earns a suspended context and a browser warning, so a document that has none waits for its gesture. */
export function startSound(sound: ResumableAudio, env: StartSoundEnv = {}): void {
  const { gestures = window, activation = navigator.userActivation ?? null, signal } = env;
  const resume = (): void => {
    void sound
      .resume()
      .then(() => {
        if (sound.started) unbind();
      })
      // Resuming can throw (e.g. a context-count cap); staying silent beats crashing the view.
      .catch(() => undefined);
  };
  const unbind = (): void => {
    for (const event of GESTURE_EVENTS) gestures.removeEventListener(event, resume);
  };
  for (const event of GESTURE_EVENTS) gestures.addEventListener(event, resume);
  signal?.addEventListener('abort', unbind);
  if (activation?.hasBeenActive === true) resume();
}
