import type { DrawItem } from '../../data/scene/index.js';
import { lookupFrame, pickByJob, resolveSettlerBobId } from '../../data/sprites/index.js';
import { DEFAULT_FACING, movingFrameRef } from '../../data/sprites/settler.js';
import type { SettlerCharacter, SettlerCharacterSet } from '../sprite-sheet.js';
import { shadowLayerFor } from './layered-layers.js';
import type { ResolvedLayer } from './resolved-layer.js';

/** Appearance variants use stable entity ids; optional head layers may use a separate motion binding. */
export function resolveCharacterLayers(
  characters: SettlerCharacterSet,
  item: DrawItem,
  tick: number,
  gaitClock: number,
): ResolvedLayer[] | null {
  // A wildlife entity resolves only through the species table: a listed-but-unbound tribe draws nothing,
  // while a bound tribe whose resolved bob has no frame is a real gap and falls to the placeholder.
  if (item.tribe !== undefined && characters.animals?.tribes.has(item.tribe) === true) {
    const animal = characterForItem(characters, item);
    if (animal === undefined) return [];
    const bob = resolveSettlerBobId(animal.binding, item, tick, gaitClock);
    const frame = lookupFrame(animal.body.atlas, bob);
    if (frame === null) return null;
    const body: ResolvedLayer = { source: animal.body.source, frame, scale: 1 };
    const shadow = shadowLayerFor(animal.body, bob, 1);
    return shadow === null ? [body] : [shadow, body];
  }
  const char = characterForItem(characters, item);
  if (char === undefined) return [];
  const variants = char.bodyVariants;
  const body = variants?.length ? (variants[item.ref % variants.length] ?? char.body) : char.body;
  const scale = char.scale ?? 1;
  const bob = resolveSettlerBobId(char.binding, item, tick, gaitClock);
  const layers: ResolvedLayer[] = [];
  const bodyFrame = lookupFrame(body.atlas, bob);
  if (bodyFrame !== null) {
    const shadow = shadowLayerFor(body, bob, scale);
    if (shadow !== null) layers.push(shadow);
    layers.push({
      source: body.source,
      frame: bodyFrame,
      scale,
      atlasW: body.atlas.width,
      atlasH: body.atlas.height,
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
        scale,
        atlasW: head.atlas.width,
        atlasH: head.atlas.height,
      });
    }
  }
  return layers.length > 0 ? layers : null;
}

function characterForItem(characters: SettlerCharacterSet, item: DrawItem): SettlerCharacter | undefined {
  if (item.tribe !== undefined && characters.animals?.tribes.has(item.tribe))
    return characters.animals.byTribe[item.tribe];
  const table = (item.tribe !== undefined ? characters.byTribe?.[item.tribe] : undefined) ?? characters;
  return pickByJob(table, item.jobType, item.young === true, item.weaponGood);
}

/** Converts measured foot travel to the selected clip's tick clock without changing movement. */
export function characterGaitRate(
  characters: SettlerCharacterSet | undefined,
  item: DrawItem,
  lastFacing?: number,
): number | undefined {
  if (characters === undefined || item.kind !== 'settler') return undefined;
  const char = characterForItem(characters, item);
  if (char === undefined) return undefined;
  const clip = movingFrameRef(char.binding, item);
  if (typeof clip === 'number' || 'frameLists' in clip) return undefined;
  const dir = (((item.facing ?? lastFacing ?? DEFAULT_FACING) % clip.dirs) + clip.dirs) % clip.dirs;
  const travel = clip.travelPerCycle?.[dir];
  if (travel === undefined || travel <= 0) return undefined;
  const ticks =
    clip.frameDurations?.reduce((sum, hold) => sum + hold, 0) ??
    (clip.frames ?? clip.stride) * (clip.ticksPerFrame ?? 1);
  return ticks / (travel * (char.scale ?? 1));
}
