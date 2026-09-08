import type { WorkAreaRing } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { workAreaOf } from '../../game/snapshot.js';

/**
 * The "Show Work Area" toggle: which gatherers currently draw the circle they harvest inside. Pure view
 * state, kept by settler id and resolved against the live snapshot, so a settler that dies or loses its
 * flag simply stops drawing one.
 */
export interface WorkAreaOverlay {
  /** Show the circles of `targets`, or hide them when every one of them already shows. */
  toggle(targets: readonly number[]): void;
  /** The circles to draw this frame. */
  rings(snapshot: WorldSnapshot): readonly WorkAreaRing[];
}

export function createWorkAreaOverlay(): WorkAreaOverlay {
  const shown = new Set<number>();
  return {
    toggle: (targets): void => {
      if (targets.length === 0) return;
      if (targets.every((id) => shown.has(id))) {
        for (const id of targets) shown.delete(id);
        return;
      }
      for (const id of targets) shown.add(id);
    },
    rings: (snapshot): readonly WorkAreaRing[] => {
      if (shown.size === 0) return [];
      const out: WorkAreaRing[] = [];
      for (const id of shown) {
        const e = entityById(snapshot, id);
        const area = e === undefined ? undefined : workAreaOf(e);
        if (area !== undefined) out.push({ entity: area.flag, radiusNodes: area.radius });
      }
      return out;
    },
  };
}
