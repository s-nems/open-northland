import type { MapObjectSprite } from '@open-northland/render';
import type { SimEvent, Simulation } from '@open-northland/sim';
import type { ScriptLandscapeSprite } from '../../content/script-landscape-sprites.js';

interface LandscapeSurface {
  addMapObjects(sprites: readonly MapObjectSprite[]): void;
  removeMapObject(sprite: MapObjectSprite): void;
}

export function bindScriptLandscapes(
  sim: Pick<Simulation, 'landscapeEdits'>,
  surface: LandscapeSurface,
  initial: ReadonlyMap<number, MapObjectSprite>,
  spriteFor: ScriptLandscapeSprite,
): (events: readonly SimEvent[]) => void {
  const removed = new Set<number>();
  const added = new Map<number, MapObjectSprite>();
  const sync = (): void => {
    const edits = sim.landscapeEdits();
    for (const id of edits.removed) {
      if (removed.has(id)) continue;
      removed.add(id);
      const sprite = initial.get(id);
      if (sprite !== undefined) surface.removeMapObject(sprite);
    }
    const live = new Set(edits.added.map((placement) => placement.id));
    for (const [id, sprite] of added) {
      if (live.has(id)) continue;
      surface.removeMapObject(sprite);
      added.delete(id);
    }
    const fresh: MapObjectSprite[] = [];
    for (const placement of edits.added) {
      if (added.has(placement.id) || placement.resourceBacked === true) continue;
      const sprite = spriteFor(placement);
      if (sprite === undefined) continue;
      added.set(placement.id, sprite);
      fresh.push(sprite);
    }
    if (fresh.length > 0) surface.addMapObjects(fresh);
  };
  sync();
  return (events) => {
    if (events.some((event) => event.kind === 'missionLandscapeChanged')) sync();
  };
}
