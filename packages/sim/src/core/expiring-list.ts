// A bounded, append-ordered list whose members lapse at a deadline: the shape the failed-goal and
// given-up-enemy memos share.

/** A member that stops counting once `until` is reached. */
export interface Expiring {
  readonly until: number;
}

/** Drop lapsed members, returning `entries` itself when none lapsed so the common path allocates nothing.
 *  Sound because deadlines ascend along the list: {@link remember} appends with a constant lifetime and moves
 *  a re-noted member to the tail. */
export function liveEntries<T extends Expiring>(entries: readonly T[], tick: number): readonly T[] {
  const oldest = entries[0];
  if (oldest === undefined || oldest.until > tick) return entries;
  return entries.filter((entry) => entry.until > tick);
}

/** `entries` with `entry` appended: lapsed members and the one `same` matches are dropped first, so a re-noted
 *  member keeps one slot with a fresh deadline, and the oldest is evicted past `size`. */
export function remember<T extends Expiring>(
  entries: readonly T[],
  tick: number,
  entry: T,
  same: (other: T) => boolean,
  size: number,
): readonly T[] {
  const kept = [...liveEntries(entries, tick).filter((other) => !same(other)), entry];
  return kept.slice(Math.max(0, kept.length - size));
}
