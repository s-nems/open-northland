import type { TextureSource } from 'pixi.js';
import type { DrawItem } from '../../data/scene/index.js';
import { type AtlasFrame, lookupFrame, pickByJob, resolveSettlerBobId } from '../../data/sprites/index.js';
import { DEFAULT_FACING, movingFrameRef } from '../../data/sprites/settler.js';
import type { SettlerCharacter, SettlerCharacterSet } from '../sprite-sheet.js';
import { shadowLayerFor } from './layered-layers.js';
import type { ResolvedLayer } from './resolved-layer.js';

/**
 * One frame again, for the binder to project onto the ground under the character. An indexed sheet
 * carries the palette index in red and coverage in alpha, and a species sheet is plain RGB; either way
 * only the coverage reaches a silhouette, so both cast from the frame as it is. `rows` keeps that many
 * of the frame's top rows, which is how the head overlay casts beside the body instead of over it.
 */
function castLayerFor(source: TextureSource, frame: AtlasFrame, scale: number, rows?: number): ResolvedLayer {
  return {
    source,
    frame,
    scale,
    boundsExempt: true,
    shadow: true,
    cast: true,
    ...(rows !== undefined ? { castRows: rows } : {}),
  };
}

/**
 * Rows of the head frame that sit above the body frame's own top row; both anchor on the same feet
 * origin, so their `offsetY` compare directly. The projection is linear about that origin, so those rows
 * and only those land clear of the body's cast: the rest would paint a second silhouette over ground the
 * body already darkens. 0 means the head starts inside the body frame and casts nothing of its own.
 *
 * Approximation: the rule follows frame boxes, not coverage, so a head wider than the body's top rows
 * loses the fringe of its own silhouette there. Measured over every frame of the man, woman and boy
 * `generic_wait` and `generic_walk` clips, that costs a median 4% and at most 25% of the projected
 * body-and-head silhouette, against a doubled silhouette over 4-77 px of ground per frame at map zoom 1
 * if the whole head cast.
 */
function headCastRows(bodyFrame: AtlasFrame, headFrame: AtlasFrame): number {
  return Math.min(headFrame.height, Math.max(0, bodyFrame.offsetY - headFrame.offsetY));
}

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
    const layers: ResolvedLayer[] = [castLayerFor(animal.body.source, frame, 1)];
    if (shadow !== null) layers.push(shadow);
    layers.push(body);
    return layers;
  }
  const char = characterForItem(characters, item);
  if (char === undefined) return [];
  const body = char.body;
  const scale = char.scale ?? 1;
  const bob = resolveSettlerBobId(char.binding, item, tick, gaitClock);
  const bodyFrame = lookupFrame(body.atlas, bob);
  const heads = char.heads;
  const head = heads !== undefined && heads.length > 0 ? heads[item.ref % heads.length] : undefined;
  const headBob =
    char.headBinding !== undefined ? resolveSettlerBobId(char.headBinding, item, tick, gaitClock) : bob;
  const headFrame = head === undefined ? null : lookupFrame(head.atlas, headBob);
  const layers: ResolvedLayer[] = [];
  if (bodyFrame !== null) {
    layers.push(castLayerFor(body.source, bodyFrame, scale));
    if (head !== undefined && headFrame !== null) {
      const rows = headCastRows(bodyFrame, headFrame);
      if (rows > 0) layers.push(castLayerFor(head.source, headFrame, scale, rows));
    }
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
  if (head !== undefined && headFrame !== null) {
    layers.push({
      source: head.source,
      frame: headFrame,
      scale,
      atlasW: head.atlas.width,
      atlasH: head.atlas.height,
      head: true,
    });
  }
  return layers.length > 0 ? layers : null;
}

function characterForItem(characters: SettlerCharacterSet, item: DrawItem): SettlerCharacter | undefined {
  if (item.tribe !== undefined && characters.animals?.tribes.has(item.tribe))
    return characters.animals.byTribe[item.tribe];
  const table = (item.tribe !== undefined ? characters.byTribe?.[item.tribe] : undefined) ?? characters;
  const character = pickByJob(table, item.jobType, item.young === true, item.weaponGood);
  const variants = character.variants;
  return variants?.length ? (variants[item.ref % variants.length] ?? character) : character;
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

export function characterInterpolatesMotion(
  characters: SettlerCharacterSet | undefined,
  item: DrawItem,
): boolean {
  return (
    item.kind === 'settler' &&
    characters !== undefined &&
    characterForItem(characters, item)?.interpolateMotion === true
  );
}
