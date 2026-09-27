import type { UiCue } from '@open-northland/audio';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { ownerPlayerOf } from '../../game/snapshot.js';
import { pickableSeat, type ViewerSeat } from '../../game/viewer-seat.js';

/**
 * A selection panel's press that orders an entity: it runs with the confirm click when the viewer's
 * seat owns the entity (the whole-map view owns everything), else it fails with the GUI click and
 * sends nothing.
 */
export function ownedOrder(
  snapshot: () => WorldSnapshot,
  viewer: ViewerSeat,
  cue: (cue: UiCue) => void,
): <A extends unknown[]>(run: (id: number, ...args: A) => void) => (id: number, ...args: A) => void {
  const owns = (id: number): boolean => {
    const ent = entityById(snapshot(), id);
    if (ent === undefined) return false;
    const seat = pickableSeat(viewer);
    return seat === null || ownerPlayerOf(ent) === seat;
  };
  return (run) =>
    (id, ...args) => {
      if (!owns(id)) {
        cue('fail');
        return;
      }
      cue('confirm');
      run(id, ...args);
    };
}
