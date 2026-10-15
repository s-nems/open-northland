/** Drift past which the sound track jumps to the picture; smaller drift is left to the media clocks. */
export const MOVIE_SYNC_TOLERANCE_S = 0.1;

/** The media of one film: the silent picture leads, and its language's sound track follows it. */
export interface MovieSync {
  /** Starts the picture, then the sound in place; rejects, with both paused, when either refuses. */
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  dispose(): void;
}

/**
 * Keeps `sound` on `picture`'s clock. The picture is muted and owns the position and the end; the
 * sound follows its pauses, stalls and seeks, and jumps back when it drifts past the tolerance.
 */
export function syncMovieSound(picture: HTMLMediaElement, sound: HTMLMediaElement): MovieSync {
  picture.muted = true;
  const align = (): void => {
    if (Math.abs(sound.currentTime - picture.currentTime) > MOVIE_SYNC_TOLERANCE_S)
      sound.currentTime = picture.currentTime;
  };
  const follow = (): void => {
    if (!picture.paused && !sound.ended) align();
  };
  const resume = (): void => {
    if (picture.paused) return;
    align();
    // A refusal here leaves the picture silent; the viewer's play button retries both.
    void sound.play().catch(() => undefined);
  };
  const hold = (): void => sound.pause();
  const listeners: readonly [string, () => void][] = [
    ['timeupdate', follow],
    ['playing', resume],
    ['pause', hold],
    ['waiting', hold],
    ['seeking', hold],
    ['seeked', resume],
  ];
  for (const [type, listener] of listeners) picture.addEventListener(type, listener);
  return {
    async play() {
      try {
        await picture.play();
        align();
        await sound.play();
      } catch (error) {
        // A pause of our own (a stall, a seek, the end) interrupts a pending start; `playing` restarts it.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        picture.pause();
        sound.pause();
        throw error;
      }
    },
    pause() {
      picture.pause();
      sound.pause();
    },
    seek(seconds) {
      picture.currentTime = seconds;
      sound.currentTime = seconds;
    },
    dispose() {
      for (const [type, listener] of listeners) picture.removeEventListener(type, listener);
    },
  };
}
