import type { DrawItem } from '../../../data/scene/index.js';
import { type AtlasFrame, pickByJob, resolveSettlerBobId } from '../../../data/sprites/index.js';
import { DEFAULT_FACING, movingFrameRef } from '../../../data/sprites/settler.js';
import type { DirectionalAnim } from '../../../data/sprites/settler-bindings.js';
import type {
  PaletteLut,
  SettlerCharacter,
  SettlerCharacterSet,
  SpriteLayer,
  SpriteSheet,
} from '../../textures/sprite-sheet.js';
import { layerScale, resolveFromLayer, shadowLayerFor } from './layered.js';
import type { LayerBuffer, ResolvedLayer } from './resolved-layer.js';

/**
 * The derived variants of a memoized body or head record (see {@link resolveFromLayer}), keyed by that
 * record: it pins source, frame and scale. A head cast also depends on the body's contact line and crop.
 */
const castRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();
const anchoredCastRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();
const headCastRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();
const headRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();
const blobRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();
const glowRecords = new WeakMap<ResolvedLayer, readonly ResolvedLayer[]>();
/** A record drawn at a unit's visual scale, apart from the shared record every full-size unit draws. */
const scaledRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();

/** `of` at `factor` times its scale about the feet, or `of` itself for a full-size unit. */
function scaledLayer(of: ResolvedLayer | null, factor: number | undefined): ResolvedLayer | null {
  if (of === null || factor === undefined) return of;
  const scale = of.scale * factor;
  const cached = scaledRecords.get(of);
  if (cached?.scale === scale) return cached;
  const record: ResolvedLayer = { ...of, scale };
  scaledRecords.set(of, record);
  return record;
}

/**
 * The hero glow's eight copies of a layer's silhouette, painted in this order under it, each blending
 * the owner's glow colour over what lies beneath at its opacity. Original behavior: offsets in bob
 * pixels, opacities out of 256.
 */
const GLOW_COPIES: readonly { readonly dx: number; readonly dy: number; readonly alpha: number }[] = [
  { dx: -6, dy: 0, alpha: 40 / 256 },
  { dx: 6, dy: 0, alpha: 40 / 256 },
  { dx: 0, dy: -6, alpha: 40 / 256 },
  { dx: 0, dy: 6, alpha: 40 / 256 },
  { dx: -2, dy: -2, alpha: 64 / 256 },
  { dx: -2, dy: 2, alpha: 64 / 256 },
  { dx: 2, dy: -2, alpha: 64 / 256 },
  { dx: 2, dy: 2, alpha: 64 / 256 },
];

/** Bob px the farthest glow copy stands off its layer, on any side. */
export const GLOW_REACH = Math.max(...GLOW_COPIES.map(({ dx, dy }) => Math.max(Math.abs(dx), Math.abs(dy))));

function glowLayersFor(of: ResolvedLayer): readonly ResolvedLayer[] {
  let records = glowRecords.get(of);
  if (records === undefined) {
    records = GLOW_COPIES.map(({ dx, dy, alpha }) => ({
      source: of.source,
      frame: of.frame,
      scale: of.scale,
      dx: dx * of.scale,
      dy: dy * of.scale,
      boundsExempt: true,
      glow: alpha,
    }));
    glowRecords.set(of, records);
  }
  return records;
}

/**
 * One frame again, for the binder to project onto the ground under the character. An indexed sheet
 * carries the palette index in red and coverage in green, and a species sheet is plain RGB; either way
 * only the coverage reaches a silhouette (the world batch reads an indexed page's from green), so both
 * cast from the frame as it is. `rows` keeps that many
 * of the frame's top rows, which is how the head overlay casts beside the body instead of over it.
 */
function castLayerFor(of: ResolvedLayer, rows?: number, originY?: number): ResolvedLayer {
  const records =
    rows !== undefined ? headCastRecords : originY === undefined ? castRecords : anchoredCastRecords;
  const cached = records.get(of);
  if (cached !== undefined && cached.castRows === rows && cached.castOriginY === originY) return cached;
  const record: ResolvedLayer = {
    source: of.source,
    frame: of.frame,
    scale: of.scale,
    boundsExempt: true,
    shadow: true,
    cast: true,
    ...(originY !== undefined ? { castOriginY: originY } : {}),
    ...(rows !== undefined ? { castRows: rows } : {}),
  };
  records.set(of, record);
  return record;
}

function blobLayerFor(of: ResolvedLayer): ResolvedLayer {
  let record = blobRecords.get(of);
  if (record === undefined) {
    record = { ...of, castReplaced: true };
    blobRecords.set(of, record);
  }
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
  idleElapsed?: number,
): boolean {
  // No look at all is a listed-but-unbound wildlife tribe, which draws nothing. A look whose resolved bob
  // has no frame is a real gap and falls to the placeholder.
  const char = characterForItem(characters, item);
  if (char === undefined) return true;
  return pushComposedCharacterLayers(
    out,
    sheet,
    char,
    char.binding,
    char.headBinding,
    item,
    tick,
    gaitClock,
    idleElapsed,
  );
}

/** One composed figure, and what besides its look and bobs shaped it. */
interface Composition {
  readonly scale: number;
  readonly factor: number | undefined;
  readonly glowing: boolean;
  readonly body: SpriteLayer;
  readonly head: SpriteLayer | undefined;
  readonly layers: readonly ResolvedLayer[];
}

/** Head bob ids and head looks a composition key tells apart per body bob; a look past either composes
 *  without the memo. */
const HEAD_BOB_SPAN = 1 << 20;
const HEAD_LOOK_SPAN = 1 << 6;

/**
 * The last figure composed per look, body bob, head bob and head look: the pool composes every drawn
 * settler on every tick, and one walk frame of one look is on screen many times over.
 */
const compositions = new WeakMap<SettlerCharacter, Map<number, Composition>>();

/**
 * Append `char`'s cast silhouettes, authored foot blob (one or the other draws), glow, body and head for `binding`'s frame at
 * `item`'s state and facing; the head reads `headBinding` when the head moves apart from the body,
 * else the body's bob. False appends nothing and means the placeholder.
 */
export function pushComposedCharacterLayers(
  out: LayerBuffer,
  sheet: SpriteSheet,
  char: SettlerCharacter,
  binding: SettlerCharacter['binding'],
  headBinding: SettlerCharacter['headBinding'],
  item: DrawItem,
  tick: number,
  gaitClock: number,
  idleElapsed?: number,
  /** The ref whose head this figure wears; absent, the item's own. */
  headRef: number = item.ref,
): boolean {
  const scale = characterScale(sheet, char);
  const factor = item.visualScale;
  const bob = resolveSettlerBobId(binding, item, tick, gaitClock, idleElapsed);
  const heads = char.heads;
  const headLook = heads !== undefined && heads.length > 0 ? headRef % heads.length : 0;
  const headLayer = heads?.[headLook];
  const headBob =
    headBinding !== undefined ? resolveSettlerBobId(headBinding, item, tick, gaitClock, idleElapsed) : bob;
  const glowing = char.glow === 'always' || (item.glow === true && char.glow !== 'never');
  const keyed =
    Number.isInteger(bob) &&
    bob >= 0 &&
    Number.isInteger(headBob) &&
    headBob >= 0 &&
    headBob < HEAD_BOB_SPAN &&
    Number.isInteger(headLook) &&
    headLook >= 0 &&
    headLook < HEAD_LOOK_SPAN;
  if (!keyed) return pushAll(out, composeCharacter(char, headLayer, bob, headBob, scale, factor, glowing));
  let byBobs = compositions.get(char);
  if (byBobs === undefined) {
    byBobs = new Map();
    compositions.set(char, byBobs);
  }
  const key = (bob * HEAD_BOB_SPAN + headBob) * HEAD_LOOK_SPAN + headLook;
  let composed = byBobs.get(key);
  if (
    composed === undefined ||
    composed.head !== headLayer ||
    composed.scale !== scale ||
    composed.factor !== factor ||
    composed.glowing !== glowing ||
    // A look may be handed another atlas layer object over its life.
    composed.body !== char.body
  ) {
    composed = {
      scale,
      factor,
      glowing,
      body: char.body,
      head: headLayer,
      layers: composeCharacter(char, headLayer, bob, headBob, scale, factor, glowing),
    };
    byBobs.set(key, composed);
  }
  return pushAll(out, composed.layers);
}

function pushAll(out: LayerBuffer, layers: readonly ResolvedLayer[]): boolean {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer !== undefined) out.push(layer);
  }
  return layers.length > 0;
}

/** The figure's layers in paint order; empty when neither its body nor its head has a frame. */
function composeCharacter(
  char: SettlerCharacter,
  headLayer: SpriteLayer | undefined,
  bob: number,
  headBob: number,
  scale: number,
  factor: number | undefined,
  glowing: boolean,
): readonly ResolvedLayer[] {
  const layers: ResolvedLayer[] = [];
  // Every layer below derives from these records, so a scaled unit's cast, glow, box and outline follow.
  const body = scaledLayer(resolveFromLayer(char.body, bob, scale), factor);
  const head =
    headLayer === undefined ? null : scaledLayer(resolveFromLayer(headLayer, headBob, scale), factor);
  if (body !== null) {
    const originY =
      char.castAnchor === 'body-bottom' ? (body.frame.offsetY + body.frame.height) * body.scale : undefined;
    layers.push(castLayerFor(body, undefined, originY));
    if (head !== null) {
      const rows = headCastRows(body.frame, head.frame);
      if (rows > 0) layers.push(castLayerFor(head, rows, originY));
    }
    const shadow = scaledLayer(shadowLayerFor(char.body, bob, scale), factor);
    if (shadow !== null) layers.push(blobLayerFor(shadow));
  }
  if (glowing) {
    if (body !== null) layers.push(...glowLayersFor(body));
    if (head !== null) layers.push(...glowLayersFor(head));
  }
  if (body !== null) layers.push(body);
  if (head !== null) layers.push(headLayerFor(head));
  return layers;
}

/** The scale a look's layers draw at. */
export function characterScale(sheet: Pick<SpriteSheet, 'kindScales'>, char: SettlerCharacter): number {
  return layerScale(sheet, 'settler', char.scale);
}

function characterForItem(characters: SettlerCharacterSet, item: DrawItem): SettlerCharacter | undefined {
  if (item.tribe !== undefined && characters.animals?.tribes.has(item.tribe)) {
    const character = characters.animals.byTribe[item.tribe];
    return character === undefined ? undefined : characterVariant(character, item.ref);
  }
  if (isUnseenHuman(characters, item)) return undefined;
  return humanCharacter(
    characters,
    item.tribe,
    item.jobType,
    item.young === true,
    item.weaponGood,
    item.ref,
    item.humanForm,
  );
}

/** Whether `item` is an adult whose tribe has no look for its job in its native form: it draws nothing. */
export function isUnseenHuman(characters: SettlerCharacterSet, item: DrawItem): boolean {
  if (
    item.young === true ||
    item.humanForm === true ||
    item.jobType === undefined ||
    item.tribe === undefined
  )
    return false;
  return characters.byTribe?.[item.tribe]?.unseenJobs?.has(item.jobType) === true;
}

/** The look of `tribe`'s `jobType` in its native or human form, its variant picked by the stable entity
 *  id `ref`. */
export function humanCharacter(
  characters: SettlerCharacterSet,
  tribe: number | undefined,
  jobType: number | undefined,
  young: boolean,
  weaponGood: number | null | undefined,
  ref: number,
  humanForm = false,
): SettlerCharacter {
  const table = (tribe !== undefined ? characters.byTribe?.[tribe] : undefined) ?? characters;
  return characterVariant(
    pickByJob(humanForm ? (table.human ?? table) : table, jobType, young, weaponGood),
    ref,
  );
}

function characterVariant(character: SettlerCharacter, ref: number): SettlerCharacter {
  const variants = character.variants;
  return variants?.length ? (variants[ref % variants.length] ?? character) : character;
}

/** The LUT a settler draws through: the settler LUT for an indexed human look, none for a wildlife
 *  species or a look on a baked atlas. Reads the same job, weapon and variant pick the layers do. */
export function settlerPalette(sheet: SpriteSheet | undefined, item: DrawItem): PaletteLut | undefined {
  const characters = sheet?.characters;
  if (characters === undefined) return undefined;
  if (item.tribe !== undefined && characters.animals?.tribes.has(item.tribe) === true) return undefined;
  const character = humanCharacter(
    characters,
    item.tribe,
    item.jobType,
    item.young === true,
    item.weaponGood,
    item.ref,
    item.humanForm,
  );
  return character.indexed === false ? undefined : sheet?.palette;
}

/** Converts measured foot travel to the selected clip's tick clock without changing movement. */
export function characterGaitRate(
  sheet: Pick<SpriteSheet, 'characters' | 'kindScales'> | undefined,
  item: DrawItem,
  lastFacing?: number,
  /** `item`'s look, when the caller already picked it. */
  look?: SettlerCharacter,
): number | undefined {
  if (sheet?.characters === undefined || item.kind !== 'settler') return undefined;
  const char = look ?? characterForItem(sheet.characters, item);
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

/** The look a settler item draws, or undefined for any other kind, an unbound wildlife tribe or a sheet
 *  without characters. */
export function settlerCharacterOf(
  characters: SettlerCharacterSet | undefined,
  item: DrawItem,
): SettlerCharacter | undefined {
  return item.kind === 'settler' && characters !== undefined ? characterForItem(characters, item) : undefined;
}

/** {@link stepsOnWholeTicks} per binding object: bindings are immutable sheet data. */
const wholeTickBindings = new WeakMap<object, boolean>();

/** Whether every clip under `value` steps on whole ticks: no subtick clip, no fractional frame time. */
function stepsOnWholeTicks(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  const known = wholeTickBindings.get(value);
  if (known !== undefined) return known;
  let whole = true;
  if (Array.isArray(value)) {
    for (const entry of value) if (!stepsOnWholeTicks(entry)) whole = false;
  } else {
    const fields = value as Partial<DirectionalAnim> & Record<string, unknown>;
    if (fields.subtick === true) whole = false;
    if (fields.ticksPerFrame !== undefined && !Number.isInteger(fields.ticksPerFrame)) whole = false;
    if (fields.frameDurations?.some((hold) => !Number.isInteger(hold)) === true) whole = false;
    for (const key in fields) if (!stepsOnWholeTicks(fields[key])) whole = false;
  }
  wholeTickBindings.set(value, whole);
  return whole;
}

/**
 * Whether `char`'s frame choice reads its clocks only through whole ticks: then two presents of one item
 * in one tick pick the same frames unless the animation clock crossed a whole tick between them.
 */
export function characterStepsOnWholeTicks(char: SettlerCharacter): boolean {
  return stepsOnWholeTicks(char.binding) && stepsOnWholeTicks(char.headBinding);
}
