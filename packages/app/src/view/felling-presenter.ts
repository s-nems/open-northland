import {
  type ElevationField,
  halfCellToScreen,
  type MapObjectSprite,
  oneShotEndTick,
} from '@open-northland/render';
import type { SimEvent } from '@open-northland/sim';
import type { FellingClips } from '../content/felling-clips.js';

/** The renderer seams a falling clip plays through. */
export interface FellingSurface {
  addMapObjects(objects: readonly MapObjectSprite[]): void;
  /** Called with a new set on every change. */
  setWithheldRefs(refs: ReadonlySet<number>): void;
}

/** A clip still playing over the entities the felling left behind. */
interface Fall {
  readonly end: number;
  readonly trunk: number;
  readonly stump: number;
}

/**
 * Play each felled tree's falling clip where it stood, as presentation only. The sim swapped the tree
 * for a trunk pile and a stump in the felling tick and keeps that timing; the presenter withholds both
 * from the sprite pool until the clip has played, and the map-object layer retires the clip on the same
 * tick. Call once per frame with that frame's fog-filtered events and tick: a tree felled out of sight
 * plays nothing, and the ghost of it standing stays remembered (`keepsFogGhost` in the handover).
 * Approximation: every felling of a frame starts on the frame's tick, up to a few ticks after the sim's.
 */
export function createFellingPresenter(
  surface: FellingSurface,
  clips: FellingClips,
  elevation?: ElevationField,
): (events: readonly SimEvent[], tick: number) => void {
  const falls: Fall[] = [];
  let nextEnd = Number.POSITIVE_INFINITY;
  const withheld = new Set<number>();
  return (events, tick) => {
    let changed = false;
    if (tick >= nextEnd) {
      let kept = 0;
      nextEnd = Number.POSITIVE_INFINITY;
      for (const fall of falls) {
        if (fall.end > tick) {
          falls[kept++] = fall;
          nextEnd = Math.min(nextEnd, fall.end);
          continue;
        }
        withheld.delete(fall.trunk);
        withheld.delete(fall.stump);
        changed = true;
      }
      falls.length = kept;
    }
    let started: MapObjectSprite[] | null = null;
    for (const event of events) {
      if (event.kind !== 'resourceFelled') continue;
      const art = clips.clipOf(event.gfxIndex, event.goodType);
      if (art === undefined) continue;
      const { hx, hy } = event.at;
      const screen = halfCellToScreen(hx, hy);
      const lift = elevation?.liftAtNode(hx, hy) ?? 0;
      const once = { from: tick, rest: null };
      started ??= [];
      started.push({
        ...art,
        x: screen.x,
        y: screen.y,
        scale: 1,
        phase: 0,
        once,
        ...(lift !== 0 ? { lift } : {}),
      });
      const end = oneShotEndTick(once, art.frames.length);
      falls.push({ end, trunk: event.trunk, stump: event.stump });
      nextEnd = Math.min(nextEnd, end);
      withheld.add(event.trunk);
      withheld.add(event.stump);
      changed = true;
    }
    if (started !== null) surface.addMapObjects(started);
    if (changed) surface.setWithheldRefs(new Set(withheld));
  };
}
