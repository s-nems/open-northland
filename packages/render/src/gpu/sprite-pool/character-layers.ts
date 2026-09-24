import type { DrawItem } from '../../data/scene/index.js';
import { type AtlasFrame, pickByJob, resolveSettlerBobId } from '../../data/sprites/index.js';
import { DEFAULT_FACING, movingFrameRef } from '../../data/sprites/settler.js';
import type { SettlerCharacter, SettlerCharacterSet, SpriteSheet } from '../sprite-sheet.js';
import { layerScale, resolveFromLayer, shadowLayerFor } from './layered-layers.js';
import type { LayerBuffer, ResolvedLayer } from './resolved-layer.js';

/**
 * The derived variants of a memoized body or head record (see {@link resolveFromLayer}), keyed by that
 * record: it pins source, frame and scale, so only a head cast's row count can differ.
 */
const castRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();
const headCastRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();
const headRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();

/**
 * One frame again, for the binder to project onto the ground under the character. An indexed sheet
 * carries the palette index in red and coverage in alpha, and a species sheet is plain RGB; either way
 * only the coverage reaches a silhouette, so both cast from the frame as it is. `rows` keeps that many
 * of the frame's top rows, which is how the head overlay casts beside the body instead of over it.
 */
function castLayerFor(of: ResolvedLayer, rows?: number): ResolvedLayer {
  const records = rows === undefined ? castRecords : headCastRecords;
  const cached = records.get(of);
  if (cached !== undefined && cached.castRows === rows) return cached;
  const record: ResolvedLayer = {
    source: of.source,
    frame: of.frame,
    scale: of.scale,
    boundsExempt: true,
    shadow: true,
    cast: true,
    ...(rows !== undefined ? { castRows: rows } : {}),
  };
  records.set(of, record);
  return record;
}

function headLayerFor(of: ResolvedLayer): ResolvedLayer {
  let record = headRecords.get(of);
  if (record === undefined) {
    record = { ...of, head: true };
    headRecords.set(of, record);
  }
  return record;
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

/**
 * Append a character's layers; false appends nothing and means the placeholder. Appearance variants use
 * stable entity ids; optional head layers may use a separate motion binding. A wildlife species is a
 * character with no head overlay, so it takes the same path.
 */
export function pushCharacterLayers(
  out: LayerBuffer,
  sheet: SpriteSheet,
  characters: SettlerCharacterSet,
  item: DrawItem,
  tick: number,
  gaitClock: number,
): boolean {
  // No look at all is a listed-but-unbound wildlife tribe, which draws nothing. A look whose resolved bob
  // has no frame is a real gap and falls to the placeholder.
  const char = characterForItem(characters, item);
  if (char === undefined) return true;
  const scale = characterScale(sheet, char);
  const bob = resolveSettlerBobId(char.binding, item, tick, gaitClock);
  const body = resolveFromLayer(char.body, bob, scale);
  const heads = char.heads;
  const headLayer = heads !== undefined && heads.length > 0 ? heads[item.ref % heads.length] : undefined;
  const headBob =
    char.headBinding !== undefined ? resolveSettlerBobId(char.headBinding, item, tick, gaitClock) : bob;
  const head = headLayer === undefined ? null : resolveFromLayer(headLayer, headBob, scale);
  if (body !== null) {
    out.push(castLayerFor(body));
    if (head !== null) {
      const rows = headCastRows(body.frame, head.frame);
      if (rows > 0) out.push(castLayerFor(head, rows));
    }
    const shadow = shadowLayerFor(char.body, bob, scale);
    if (shadow !== null) out.push(shadow);
    out.push(body);
  }
  if (head !== null) out.push(headLayerFor(head));
  return body !== null || head !== null;
}

function characterScale(sheet: Pick<SpriteSheet, 'kindScales'>, char: SettlerCharacter): number {
  return layerScale(sheet, 'settler', char.scale);
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
  sheet: Pick<SpriteSheet, 'characters' | 'kindScales'> | undefined,
  item: DrawItem,
  lastFacing?: number,
): number | undefined {
  if (sheet?.characters === undefined || item.kind !== 'settler') return undefined;
  const char = characterForItem(sheet.characters, item);
  if (char === undefined) return undefined;
  const clip = movingFrameRef(char.binding, item);
  if (typeof clip === 'number' || 'frameLists' in clip) return undefined;
  const dir = (((item.facing ?? lastFacing ?? DEFAULT_FACING) % clip.dirs) + clip.dirs) % clip.dirs;
  const travel = clip.travelPerCycle?.[dir];
  if (travel === undefined || travel <= 0) return undefined;
  const ticks =
    clip.frameDurations?.reduce((sum, hold) => sum + hold, 0) ??
    (clip.frames ?? clip.stride) * (clip.ticksPerFrame ?? 1);
  return ticks / (travel * characterScale(sheet, char));
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
