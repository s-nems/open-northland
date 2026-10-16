/** Drift past which the sound track jumps to the picture; smaller drift is left to the media clocks. */
export const MOVIE_SYNC_TOLERANCE_S = 0.1;

/** The media of one film: the silent picture leads, and its language's sound track follows it. */
export interface MovieSync {
  /** Starts the picture, then the sound in place; rejects, with both paused, when either refuses. */
  play(): Promise<void>;
  pause(): void;
  /** Past the picture's end the picture holds its last frame while the sound plays on. */
  seek(seconds: number): void;
  /** The film position: the picture's, or the sound's once the picture holds its last frame. */
  position(): number;
  /** The longer of the two tracks, zero while neither knows its length. */
  duration(): number;
  dispose(): void;
}

function knownDuration(element: HTMLMediaElement): number {
  return Number.isFinite(element.duration) ? element.duration : 0;
}

/** Whether `element` still has media at `seconds`; an unknown length counts as covering it. */
function covers(element: HTMLMediaElement, seconds: number): boolean {
  return !Number.isFinite(element.duration) || seconds < element.duration;
}

/**
 * Keeps `sound` on `picture`'s clock. The picture is muted and owns the position; the sound follows
 * its pauses, stalls and seeks, and jumps back when it drifts past the tolerance. The tracks may end
 * apart: a picture that ends first holds its last frame, a sound that ends first leaves the picture
 * silent. `onEnd` runs once, when both have ended or the picture ends beside a sound that failed.
 */
export function syncMovieSound(
  picture: HTMLMediaElement,
  sound: HTMLMediaElement,
  onEnd: () => void,
): MovieSync {
  picture.muted = true;
  /** The viewer's intent: true between `play()` and `pause()`, whatever the media are doing. */
  let wanted = false;
  let soundFailed = false;
  let ended = false;
  const pictureAtEnd = (): boolean => picture.ended || !covers(picture, picture.currentTime);
  const position = (): number => Math.max(picture.currentTime, sound.currentTime);
  const align = (): void => {
    // Past the picture's end the sound keeps its own clock under the held frame.
    if (pictureAtEnd() || !covers(sound, picture.currentTime)) return;
    if (Math.abs(sound.currentTime - picture.currentTime) > MOVIE_SYNC_TOLERANCE_S)
      sound.currentTime = picture.currentTime;
  };
  const playSound = (): void => {
    if (soundFailed || !covers(sound, sound.currentTime)) return;
    // A refusal here leaves the picture silent; the viewer's play button retries both.
    void sound.play().catch(() => undefined);
  };
  const follow = (): void => {
    if (!picture.paused && !sound.ended) align();
  };
  const resume = (): void => {
    if (!wanted) return;
    if (!picture.paused) align();
    else if (!pictureAtEnd()) return;
    playSound();
  };
  const hold = (): void => sound.pause();
  // The picture pauses itself on reaching its end; the sound plays on under the held last frame.
  const holdUnlessEnded = (): void => {
    if (!pictureAtEnd()) hold();
  };
  const finishIfBothEnded = (): void => {
    if (ended || !pictureAtEnd() || !(sound.ended || soundFailed)) return;
    ended = true;
    onEnd();
  };
  const failSound = (): void => {
    soundFailed = true;
    finishIfBothEnded();
  };
  const pictureListeners: readonly [string, () => void][] = [
    ['timeupdate', follow],
    ['playing', resume],
    ['pause', holdUnlessEnded],
    ['waiting', hold],
    ['seeking', hold],
    ['seeked', resume],
    ['ended', finishIfBothEnded],
  ];
  const soundListeners: readonly [string, () => void][] = [
    ['ended', finishIfBothEnded],
    ['error', failSound],
  ];
  for (const [type, listener] of pictureListeners) picture.addEventListener(type, listener);
  for (const [type, listener] of soundListeners) sound.addEventListener(type, listener);
  return {
    async play() {
      wanted = true;
      try {
        if (!pictureAtEnd()) {
          await picture.play();
          align();
        }
        if (!soundFailed && covers(sound, sound.currentTime)) await sound.play();
      } catch (error) {
        // A pause of our own (a stall, a seek, the end) interrupts a pending start; `playing` restarts it.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        wanted = false;
        picture.pause();
        sound.pause();
        throw error;
      }
    },
    pause() {
      wanted = false;
      picture.pause();
      sound.pause();
    },
    seek(seconds) {
      const pictureEnd = knownDuration(picture);
      picture.currentTime = pictureEnd > 0 ? Math.min(seconds, pictureEnd) : seconds;
      sound.currentTime = seconds;
      // A picture that held its last frame plays again when the viewer seeks back into it.
      if (wanted && picture.paused && covers(picture, seconds)) void picture.play().catch(() => undefined);
    },
    position,
    duration: () => Math.max(knownDuration(picture), knownDuration(sound)),
    dispose() {
      for (const [type, listener] of pictureListeners) picture.removeEventListener(type, listener);
      for (const [type, listener] of soundListeners) sound.removeEventListener(type, listener);
    },
  };
}
