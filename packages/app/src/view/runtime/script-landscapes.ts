import type { GroundWave, MapObjectSprite } from '@open-northland/render';
import type { LandscapeEditView, SimEvent } from '@open-northland/sim';
import type { ScriptLandscapeSprite } from '../../content/script-landscape-sprites.js';
import type { SessionHost } from '../../session/index.js';

interface LandscapeSurface {
  addMapObjects(sprites: readonly MapObjectSprite[]): void;
  removeMapObject(sprite: MapObjectSprite): void;
  removeGroundWave(wave: GroundWave): void;
}

export function bindScriptLandscapes(
  host: Pick<SessionHost, 'landscapeEdits'>,
  surface: LandscapeSurface,
  initial: ReadonlyMap<number, MapObjectSprite>,
  spriteFor: ScriptLandscapeSprite,
  initialWaves: ReadonlyMap<number, GroundWave>,
): (events: readonly SimEvent[]) => void {
  const removed = new Set<number>();
  const added = new Map<number, MapObjectSprite>();
  const apply = (edits: LandscapeEditView): void => {
    for (const id of edits.removed) {
      if (removed.has(id)) continue;
      removed.add(id);
      const sprite = initial.get(id);
      if (sprite !== undefined) surface.removeMapObject(sprite);
      const wave = initialWaves.get(id);
      if (wave !== undefined) surface.removeGroundWave(wave);
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
  // Each answer is the whole edit state, so only the latest asked is applied.
  let asked = 0;
  const sync = (): void => {
    const request = ++asked;
    void host.landscapeEdits().then((edits) => {
      if (request === asked) apply(edits);
    });
  };
  sync();
  return (events) => {
    if (events.some((event) => event.kind === 'missionLandscapeChanged')) sync();
  };
}
