/**
 * The "Show Work Area" toggle: which settlers keep drawing their range circle while not selected. Pure view
 * state, kept by settler id and resolved against the live snapshot, so a settler that dies or loses its
 * area simply stops drawing one.
 */
export interface WorkAreaOverlay {
  /** Show the circles of `targets`, or hide them when every one of them already shows. */
  toggle(targets: readonly number[]): void;
  /** The settlers whose circles show. */
  ids(): ReadonlySet<number>;
  /** Bumped on every change to {@link ids}, which is one set mutated in place. */
  version(): number;
}

export function createWorkAreaOverlay(): WorkAreaOverlay {
  const shown = new Set<number>();
  let version = 0;
  return {
    toggle: (targets): void => {
      if (targets.length === 0) return;
      version++;
      if (targets.every((id) => shown.has(id))) {
        for (const id of targets) shown.delete(id);
        return;
      }
      for (const id of targets) shown.add(id);
    },
    ids: () => shown,
    version: () => version,
  };
}
