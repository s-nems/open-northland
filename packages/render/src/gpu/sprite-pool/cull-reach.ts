import type { Viewport } from '../../data/projection/index.js';
import { OVERHEAD_BASE_GAP, OVERHEAD_STEP } from '../../data/scene/overhead-column.js';
import {
  type AtlasFrame,
  type BuildingDraw,
  type ByJobTable,
  DECOR_BINDING_KEY,
  type LayeredBobRef,
  lookupFrame,
  type ResourceLevelRef,
  type ResourceTypeBinding,
  type SignpostBinding,
  type SpriteKind,
  type StockpileBinding,
} from '../../data/sprites/index.js';
import { SHADOW_BLUR_PADDING } from '../textures/soft-shadow-cache.js';
import type {
  SettlerCharacter,
  SettlerCharacterSet,
  SpriteLayer,
  SpriteSheet,
} from '../textures/sprite-sheet.js';
import { characterScale, GLOW_REACH } from './layers/character.js';
import { layerScale } from './layers/layered.js';
import { placeholderBounds } from './placeholder.js';
import { SNAP_DISTANCE } from './presentation/motion.js';
import { OUTLINE_REACH } from './selection-effects.js';

/** Px a drawing reaches past its feet anchor on each side. */
export interface Reach {
  readonly up: number;
  readonly down: number;
  readonly left: number;
  readonly right: number;
}

/** What one kind of entity can draw around its draw item's anchor. */
export interface KindReach {
  /** Its art in world px: every frame its looks or bindings resolve, at their scale, with shadow twins,
   *  glows and the placeholder marker it draws without a frame. */
  readonly art: Reach;
  /** Whether it casts a projected shadow, which the shadow style shears sideways. */
  readonly casts: boolean;
  /** How far its drawn feet may stand from the item's anchor: an interpolating look lerps from the last
   *  tick's anchor, within the snap distance; every other drawing stands on the anchor. */
  readonly slack: number;
  /** The marks drawn off its drawn bounds or feet at world size (the over-head column, the feet ring). */
  readonly worldMarks: Reach;
  /** The marks that keep their screen size when zoomed out (the selection outline, the control-group
   *  label): screen px below zoom 1, world px at zoom 1 and closer. */
  readonly screenMarks: Reach;
}

/** The kinds the pool culls on their own reach; another kind keeps the scene's box. */
export type KindReaches = Partial<Record<SpriteKind, KindReach>>;

/** World px the tallest over-head icon stands over its hot spot. Approximation: the need bubble's
 *  32 px frame draws 27 px tall; this leaves the import marker's icon up to 36 px. */
const OVERHEAD_ICON_HEIGHT = 36;
/** The over-head column at its fullest: the base gap, every slot's step and the top icon. */
const OVERHEAD_COLUMN =
  OVERHEAD_BASE_GAP +
  Object.values(OVERHEAD_STEP).reduce((sum, step) => sum + step, 0) +
  OVERHEAD_ICON_HEIGHT;
/** World px the settler's feet ring and the bubble reach around the feet and the art's centre: the
 *  ring's 20 x 11 ellipse and half the 54 px wide bubble. */
const SETTLER_RING = { side: 28, down: 12 } as const;
/** Screen px (zoomed out) the control-group label reaches from the feet: a list of up to ten groups
 *  centred under them, about 68 px wide and 10 px deep at its 7 px font. */
const GROUP_LABEL = { side: 40, down: 12 } as const;

const NO_MARKS: Reach = { up: 0, down: 0, left: 0, right: 0 };
/** The selection outline, the screen-sized mark every culled kind wears. */
const OUTLINE_MARKS: Reach = {
  up: OUTLINE_REACH,
  down: OUTLINE_REACH,
  left: OUTLINE_REACH,
  right: OUTLINE_REACH,
};
const SETTLER_WORLD_MARKS: Reach = {
  up: OVERHEAD_COLUMN,
  down: SETTLER_RING.down,
  left: SETTLER_RING.side,
  right: SETTLER_RING.side,
};
const SETTLER_SCREEN_MARKS: Reach = {
  up: OUTLINE_REACH,
  down: GROUP_LABEL.down + OUTLINE_REACH,
  left: GROUP_LABEL.side,
  right: GROUP_LABEL.side,
};

/** The fields of a look table, checked against the interface so a new one cannot be missed. */
const TABLE_FIELDS: {
  readonly [K in keyof ByJobTable<SettlerCharacter>]-?: 'table' | 'looks' | 'look' | 'none';
} = {
  human: 'table',
  byJob: 'looks',
  youngByJob: 'looks',
  fixedByJob: 'looks',
  byWeaponGood: 'looks',
  unarmedByJob: 'looks',
  unseenJobs: 'none',
  default: 'look',
};

/** The look fields that draw layers or name further looks. */
const LOOK_FIELDS: {
  readonly [K in keyof SettlerCharacter]-?: 'layer' | 'layers' | 'looks' | 'look' | 'none';
} = {
  paletteJobType: 'none',
  body: 'layer',
  indexed: 'none',
  palette: 'none',
  variants: 'looks',
  interpolateMotion: 'none',
  scale: 'none',
  castAnchor: 'none',
  heads: 'layers',
  binding: 'none',
  headBinding: 'none',
  glow: 'none',
  cartDriver: 'look',
};

/** The bob refs of a landscape binding's fields. */
const RESOURCE_FIELDS: { readonly [K in keyof ResourceTypeBinding]-?: 'levels' | 'ref' | 'none' } = {
  flatByGood: 'none',
  flatByGfxIndex: 'none',
  byGood: 'levels',
  byGfxIndex: 'levels',
  default: 'ref',
};
const STOCKPILE_FIELDS: { readonly [K in keyof StockpileBinding]-?: 'lists' | 'list' | 'ref' } = {
  byGood: 'lists',
  flag: 'list',
  flagsByPlayer: 'lists',
  default: 'ref',
};
const SIGNPOST_FIELDS: { readonly [K in keyof SignpostBinding]-?: 'list' | 'ref' | 'bindings' } = {
  post: 'ref',
  boards: 'list',
  byPlayer: 'bindings',
};

class ReachUnion {
  up = 0;
  down = 0;
  left = 0;
  right = 0;

  frame(frame: AtlasFrame, scale: number, pad: number): void {
    let left = -frame.offsetX * scale;
    let right = (frame.offsetX + frame.width) * scale;
    let up = -frame.offsetY * scale;
    let down = (frame.offsetY + frame.height) * scale;
    if (frame.tilt !== undefined) {
      // A tilted frame turns about its bottom-centre: any turn stays within its reach from there.
      const pivotX = (frame.offsetX + frame.width / 2) * scale;
      const radius = Math.hypot(frame.width / 2, frame.height) * scale;
      left = radius - pivotX;
      right = radius + pivotX;
      up = radius - down;
      down += radius;
    }
    this.box(up + pad, down + pad, left + pad, right + pad);
  }

  /** Every frame of `layer`, widened by `pad` (the glow copies its frames), and of its shadow twin,
   *  widened by the soft shadow's blur. */
  layer(layer: Pick<SpriteLayer, 'atlas' | 'shadow'>, scale: number, pad: number): void {
    for (const frame of layer.atlas.frames.values())
      if (frame.width > 0 && frame.height > 0) this.frame(frame, scale, pad);
    for (const frame of layer.shadow?.atlas.frames.values() ?? [])
      if (frame.width > 0 && frame.height > 0) this.frame(frame, scale, SHADOW_BLUR_PADDING * scale);
  }

  /** One bob of `layer` and, with `shadow`, its shadow twin's frame of the same id, blurred. */
  bob(layer: Pick<SpriteLayer, 'atlas' | 'shadow'>, bob: number, scale: number, shadow: boolean): void {
    const frame = lookupFrame(layer.atlas, bob);
    if (frame !== null) this.frame(frame, scale, 0);
    const twin = shadow && layer.shadow !== undefined ? lookupFrame(layer.shadow.atlas, bob) : null;
    if (twin !== null) this.frame(twin, scale, SHADOW_BLUR_PADDING * scale);
  }

  placeholder(kind: SpriteKind): void {
    const marker = placeholderBounds(kind);
    this.box(-marker.minY, marker.maxY, -marker.minX, marker.maxX);
  }

  box(up: number, down: number, left: number, right: number): void {
    this.up = Math.max(this.up, up);
    this.down = Math.max(this.down, down);
    this.left = Math.max(this.left, left);
    this.right = Math.max(this.right, right);
  }

  reach(): Reach {
    return { up: this.up, down: this.down, left: this.left, right: this.right };
  }
}

/** Every look a settler can draw, and whether any of them interpolates its motion. */
function settlerReach(sheet: SpriteSheet): KindReach {
  const union = new ReachUnion();
  union.placeholder('settler');
  // A sheet without looks draws the shared body and its overlays at the settler kind's scale.
  const sharedScale = layerScale(sheet, 'settler', undefined);
  union.layer(sheet, sharedScale, 0);
  for (const overlay of sheet.overlays ?? []) union.layer(overlay, sharedScale, 0);
  let slack = 0;
  const seen = new Set<SettlerCharacter>();
  const look = (char: SettlerCharacter | undefined): void => {
    if (char === undefined || seen.has(char)) return;
    seen.add(char);
    const scale = characterScale(sheet, char);
    const glow = GLOW_REACH * scale;
    if (char.interpolateMotion === true) slack = SNAP_DISTANCE;
    for (const key of Object.keys(LOOK_FIELDS) as (keyof SettlerCharacter)[]) {
      const field = LOOK_FIELDS[key];
      if (field === 'layer') union.layer(char.body, scale, glow);
      else if (field === 'layers') for (const head of char.heads ?? []) union.layer(head, scale, glow);
      else if (field === 'looks') for (const variant of char.variants ?? []) look(variant);
      else if (field === 'look') look(char.cartDriver);
    }
  };
  const table = (looks: ByJobTable<SettlerCharacter> | undefined): void => {
    if (looks === undefined) return;
    for (const key of Object.keys(TABLE_FIELDS) as (keyof ByJobTable<SettlerCharacter>)[]) {
      const value = looks[key];
      if (value === undefined) continue;
      const field = TABLE_FIELDS[key];
      if (field === 'none') continue;
      if (field === 'table') table(value as ByJobTable<SettlerCharacter>);
      else if (field === 'look') look(value as SettlerCharacter);
      else for (const char of Object.values(value as Record<number, SettlerCharacter>)) look(char);
    }
  };
  const characters: SettlerCharacterSet | undefined = sheet.characters;
  table(characters);
  for (const tribe of Object.values(characters?.byTribe ?? {})) table(tribe);
  for (const animal of Object.values(characters?.animals?.byTribe ?? {})) look(animal);
  return {
    art: union.reach(),
    casts: true,
    slack,
    worldMarks: SETTLER_WORLD_MARKS,
    screenMarks: SETTLER_SCREEN_MARKS,
  };
}

function unwrap(ref: LayeredBobRef): BuildingDraw {
  return typeof ref === 'number' ? { bob: ref } : ref;
}

function resourceDraws(binding: number | ResourceTypeBinding | undefined): BuildingDraw[] {
  if (binding === undefined) return [];
  if (typeof binding === 'number') return [{ bob: binding }];
  const draws: BuildingDraw[] = [];
  const level = (ref: ResourceLevelRef | null): void => {
    if (ref === null) return;
    if (typeof ref === 'number' || 'bob' in ref) draws.push(unwrap(ref));
    else
      for (const bob of ref.frames) draws.push(ref.layer === undefined ? { bob } : { bob, layer: ref.layer });
  };
  for (const key of Object.keys(RESOURCE_FIELDS) as (keyof ResourceTypeBinding)[]) {
    const field = RESOURCE_FIELDS[key];
    if (field === 'ref') draws.push(unwrap(binding.default));
    else if (field === 'levels') {
      const levels = binding[key as 'byGood' | 'byGfxIndex'];
      for (const list of Object.values(levels ?? {})) for (const ref of list) level(ref);
    }
  }
  return draws;
}

function stockpileDraws(binding: number | StockpileBinding | undefined): BuildingDraw[] {
  if (binding === undefined) return [];
  if (typeof binding === 'number') return [{ bob: binding }];
  const draws: BuildingDraw[] = [];
  for (const key of Object.keys(STOCKPILE_FIELDS) as (keyof StockpileBinding)[]) {
    if (key === 'default') draws.push(unwrap(binding.default));
    else if (key === 'flag') for (const ref of binding.flag) draws.push(unwrap(ref));
    else
      for (const list of Object.values(binding[key] ?? {})) for (const ref of list) draws.push(unwrap(ref));
  }
  return draws;
}

function signpostDraws(binding: SignpostBinding | undefined): BuildingDraw[] {
  if (binding === undefined) return [];
  const draws: BuildingDraw[] = [];
  for (const key of Object.keys(SIGNPOST_FIELDS) as (keyof SignpostBinding)[]) {
    const field = SIGNPOST_FIELDS[key];
    if (field === 'ref') draws.push(unwrap(binding.post));
    else if (field === 'list') for (const ref of binding.boards) draws.push(unwrap(ref));
    else for (const own of binding.byPlayer ?? []) draws.push(...signpostDraws(own));
  }
  return draws;
}

/**
 * The art of a landscape kind drawing `draws` from their families at the family's scale. With
 * `bobFallback`, a draw whose family is not loaded reads its bob as the resolver falls back: off the
 * kind's own layer, else off the shared body atlas and its overlays. Undefined when a drawn layer sways:
 * its lean follows the wind, which no fixed reach bounds.
 */
function landscapeReach(
  sheet: SpriteSheet,
  kind: SpriteKind,
  draws: readonly BuildingDraw[],
  options: { readonly bobFallback: boolean; readonly shadow: boolean },
): KindReach | undefined {
  const union = new ReachUnion();
  union.placeholder(kind);
  const kindLayer = sheet.kindLayers?.[kind];
  const kindScale = layerScale(sheet, kind, undefined);
  for (const draw of draws) {
    const family = draw.layer === undefined ? undefined : sheet.families?.[draw.layer];
    if (family !== undefined && draw.layer !== undefined) {
      if (family.sway !== undefined) return undefined;
      union.bob(family, draw.bob, layerScale(sheet, kind, sheet.familyScales?.[draw.layer]), options.shadow);
    } else if (options.bobFallback && kindLayer !== undefined) {
      if (kindLayer.sway !== undefined) return undefined;
      union.bob(kindLayer, draw.bob, kindScale, options.shadow);
    } else if (options.bobFallback) {
      union.bob(sheet, draw.bob, kindScale, false);
      for (const overlay of sheet.overlays ?? []) union.bob(overlay, draw.bob, kindScale, false);
    }
  }
  return { art: union.reach(), casts: false, slack: 0, worldMarks: NO_MARKS, screenMarks: OUTLINE_MARKS };
}

/** What each kind the pool culls on its own can draw from `sheet`; none without a sheet, where every
 *  entity draws the placeholder and the scene's box decides. */
export function kindReaches(sheet: SpriteSheet | undefined): KindReaches {
  if (sheet === undefined) return {};
  const reaches: Partial<Record<SpriteKind, KindReach>> = { settler: settlerReach(sheet) };
  const layered = { bobFallback: false, shadow: true } as const;
  const add = (kind: SpriteKind, reach: KindReach | undefined): void => {
    if (reach !== undefined) reaches[kind] = reach;
  };
  add(
    'resource',
    landscapeReach(sheet, 'resource', resourceDraws(sheet.bindings.resource), {
      bobFallback: true,
      shadow: true,
    }),
  );
  for (const kind of Object.keys(DECOR_BINDING_KEY) as (keyof typeof DECOR_BINDING_KEY)[])
    add(kind, landscapeReach(sheet, kind, resourceDraws(sheet.bindings[DECOR_BINDING_KEY[kind]]), layered));
  add('stockpile', landscapeReach(sheet, 'stockpile', stockpileDraws(sheet.bindings.stockpile), layered));
  add(
    'signpost',
    landscapeReach(sheet, 'signpost', signpostDraws(sheet.bindings.signpost), {
      bobFallback: false,
      shadow: false,
    }),
  );
  return reaches;
}

/**
 * The box a drawing's feet (its item's anchor raised by its lift) must stand in for anything it draws to
 * reach `screen` (world px) at `zoom`: its art, a cast shadow sheared `castShear` px sideways per px of
 * caster height, its slack and its marks.
 */
export function cullBox(screen: Viewport, reach: KindReach, castShear: number, zoom: number): Viewport {
  const { art, slack, worldMarks: world, screenMarks: held } = reach;
  const cast = reach.casts ? castShear * (art.up + art.down) : 0;
  const screenScale = 1 / Math.min(zoom, 1);
  return {
    minX: screen.minX - art.right - cast - slack - world.right - held.right * screenScale,
    maxX: screen.maxX + art.left + cast + slack + world.left + held.left * screenScale,
    minY: screen.minY - art.down - slack - world.down - held.down * screenScale,
    maxY: screen.maxY + art.up + slack + world.up + held.up * screenScale,
  };
}
