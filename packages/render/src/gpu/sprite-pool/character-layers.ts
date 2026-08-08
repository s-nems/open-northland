import type { DrawItem } from '../../data/scene/index.js';
import { lookupFrame, pickByJob, resolveSettlerBobId } from '../../data/sprites/index.js';
import type { SettlerCharacterSet } from '../sprite-sheet.js';
import { shadowLayerFor } from './layered-layers.js';
import type { ResolvedLayer } from './resolved-layer.js';

/**
 * A per-job settler character's layers: the job's own body frame plus one head overlay picked by entity
 * id (ids are never reused, so a crowd shows stable varied faces) - the render-side analogue of the
 * original's per-individual random head. The head may resolve through its own binding, so a carry
 * variant whose head bobs are empty plays the base walk's head.
 */
export function resolveCharacterLayers(
  characters: SettlerCharacterSet,
  item: DrawItem,
  tick: number,
  gaitClock: number,
): ResolvedLayer[] | null {
  // A wildlife entity resolves only through the species table: a listed-but-unbound tribe draws nothing,
  // while a bound tribe whose resolved bob has no frame is a real gap and falls to the placeholder.
  if (item.tribe !== undefined && characters.animals?.tribes.has(item.tribe) === true) {
    const animal = characters.animals.byTribe[item.tribe];
    if (animal === undefined) return [];
    const bob = resolveSettlerBobId(animal.binding, item, tick, gaitClock);
    const frame = lookupFrame(animal.body.atlas, bob);
    if (frame === null) return null;
    const body: ResolvedLayer = { source: animal.body.source, frame, scale: 1 };
    const shadow = shadowLayerFor(animal.body, bob, 1);
    return shadow === null ? [body] : [shadow, body];
  }
  const char = pickByJob(characters, item.jobType, item.young === true, item.weaponGood);
  const bob = resolveSettlerBobId(char.binding, item, tick, gaitClock);
  const layers: ResolvedLayer[] = [];
  const bodyFrame = lookupFrame(char.body.atlas, bob);
  if (bodyFrame !== null) {
    layers.push({
      source: char.body.source,
      frame: bodyFrame,
      scale: 1,
      atlasW: char.body.atlas.width,
      atlasH: char.body.atlas.height,
    });
  }
  const heads = char.heads;
  if (heads !== undefined && heads.length > 0) {
    const head = heads[item.ref % heads.length];
    const headBob =
      char.headBinding !== undefined ? resolveSettlerBobId(char.headBinding, item, tick, gaitClock) : bob;
    const headFrame = head === undefined ? null : lookupFrame(head.atlas, headBob);
    if (head !== undefined && headFrame !== null) {
      layers.push({
        source: head.source,
        frame: headFrame,
        scale: 1,
        atlasW: head.atlas.width,
        atlasH: head.atlas.height,
      });
    }
  }
  return layers.length > 0 ? layers : null;
}
