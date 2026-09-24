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
  /** The audio's lifetime: its end drops the listeners, such as for the menu's engine after a handover. */
  readonly signal: AbortSignal;
}

/** Starts audio as soon as the autoplay gate allows: the activation the menu's launch click granted is
 *  sticky and survives the handover, so such a document needs no further gesture. Asking without it only
 *  earns a suspended context and a browser warning, so a document that has none waits for its gesture.
 *  The listeners stay until `signal` ends the audio's life: a context the platform suspends later (a
 *  phone call, sleep) may need a fresh gesture to run again. */
export function startSound(sound: ResumableAudio, env: StartSoundEnv): void {
  const { gestures = window, activation = navigator.userActivation ?? null, signal } = env;
  // An already-aborted scope never fires `abort`, so binding here would pin the listeners and the
  // engine they close over for the life of the document.
  if (signal.aborted) return;
  const resume = (): void => {
    if (sound.started) return;
    // Resuming can throw (e.g. a context-count cap); staying silent beats crashing the view.
    void sound.resume().catch(() => undefined);
  };
  for (const event of GESTURE_EVENTS) gestures.addEventListener(event, resume);
  signal.addEventListener('abort', () => {
    for (const event of GESTURE_EVENTS) gestures.removeEventListener(event, resume);
  });
  if (activation?.hasBeenActive === true) resume();
}
