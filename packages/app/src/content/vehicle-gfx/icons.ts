import {
  type AtlasFrame,
  DEFAULT_FACING,
  frameOf,
  type SpriteAtlas,
  type SpriteSheet,
  type VehicleBinding,
  type VehicleLook,
} from '@open-northland/render';
import { Rectangle, Texture } from 'pixi.js';

/**
 * A vehicle good's HUD icon is the vehicle itself, standing: the wait clip's frame at the default facing,
 * cut from the loaded vehicle atlas. A vehicle good has no `ls_goods` pile (it is built on a yard, never
 * shelved), so the generic heap it would otherwise draw reads as a pile of wood. An indexed look's atlas
 * holds palette indices, not colours, so its icon cuts from the baked copy of its standing frames the
 * loader files under {@link vehicleIconStem}.
 */

const RGBA_BYTES = 4;

function standingFrame(look: VehicleLook): number {
  return frameOf(look.idle, DEFAULT_FACING, 0);
}

/** The family an indexed body's icons cut from; a loader-built page, not a served stem. */
export function vehicleIconStem(indexedStem: string): string {
  return `${indexedStem}.icons`;
}

/** The standing frame of every indexed look, by its indexed stem: what the loader bakes icons from. */
export function indexedStandingFrames(binding: VehicleBinding | undefined): Map<string, Set<number>> {
  const byStem = new Map<string, Set<number>>();
  for (const looks of Object.values(binding?.byTribe ?? {})) {
    for (const look of Object.values(looks)) {
      if (look.indexed !== true) continue;
      const frames = byStem.get(look.layer) ?? new Set<number>();
      frames.add(standingFrame(look));
      byStem.set(look.layer, frames);
    }
  }
  return byStem;
}

/** A decoded RGBA page, row-major from the top-left. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

/**
 * Copy `ids` out of a decoded baked page side by side into one small RGBA page, keeping their ids and
 * draw offsets; `undefined` when the page holds none of them.
 */
export function packIconFrames(
  image: RgbaImage,
  atlas: SpriteAtlas,
  ids: Iterable<number>,
): { readonly pixels: Uint8Array; readonly atlas: SpriteAtlas } | undefined {
  const picked: [number, AtlasFrame][] = [];
  for (const id of ids) {
    const frame = atlas.frames.get(id);
    const inside =
      frame !== undefined && frame.x + frame.width <= image.width && frame.y + frame.height <= image.height;
    if (inside && frame.width > 0 && frame.height > 0) picked.push([id, frame]);
  }
  if (picked.length === 0) return undefined;
  const width = picked.reduce((sum, [, f]) => sum + f.width, 0);
  const height = picked.reduce((max, [, f]) => Math.max(max, f.height), 0);
  const pixels = new Uint8Array(width * height * RGBA_BYTES);
  const frames = new Map<number, AtlasFrame>();
  let x = 0;
  for (const [id, f] of picked) {
    for (let row = 0; row < f.height; row++) {
      const from = ((f.y + row) * image.width + f.x) * RGBA_BYTES;
      pixels.set(image.data.subarray(from, from + f.width * RGBA_BYTES), (row * width + x) * RGBA_BYTES);
    }
    frames.set(id, { x, y: 0, width: f.width, height: f.height, offsetX: f.offsetX, offsetY: f.offsetY });
    x += f.width;
  }
  return { pixels, atlas: { width, height, frames } };
}

/** The content slice the icon join reads: a good's yard house, the house's vehicle, the vehicle's
 *  harnessed form. */
export interface VehicleIconContent {
  readonly goods: readonly { readonly id: string; readonly vehicleHouse?: number | undefined }[];
  readonly buildings: readonly { readonly typeId: number; readonly vehicleType?: number | undefined }[];
  readonly vehicles: readonly {
    readonly typeId: number;
    readonly transformVehicleType?: number | undefined;
  }[];
}

/** A cart that recruits a draught animal is drawn as the harnessed type it becomes: the ox cart's yard
 *  spawns the ox-less cart (6 -> 2), and the player ordered the ox cart. */
function finalVehicleType(content: VehicleIconContent, vehicleType: number): number {
  const seen = new Set<number>();
  let current = vehicleType;
  while (!seen.has(current)) {
    seen.add(current);
    const next = content.vehicles.find((v) => v.typeId === current)?.transformVehicleType;
    if (next === undefined) return current;
    current = next;
  }
  return vehicleType;
}

/** The type the good's yard turns out, in its final form; undefined for an ordinary ware. */
export function vehicleTypeOfGood(content: VehicleIconContent, goodId: string): number | undefined {
  const good = content.goods.find((g) => g.id === goodId);
  if (good?.vehicleHouse === undefined) return undefined;
  const spawned = content.buildings.find((b) => b.typeId === good.vehicleHouse)?.vehicleType;
  return spawned === undefined ? undefined : finalVehicleType(content, spawned);
}

/** The base tribe's look for a type, else any tribe's: the shipped bodies are shared across tribes, so
 *  the icon is the same picture whichever tribe owns the shop. */
function anyTribeLook(sheet: SpriteSheet, vehicleType: number): VehicleLook | undefined {
  const binding = sheet.bindings.vehicle;
  if (binding === undefined) return undefined;
  const base = binding.byTribe[binding.fallbackTribe]?.[vehicleType];
  if (base !== undefined) return base;
  for (const looks of Object.values(binding.byTribe)) {
    const look = looks[vehicleType];
    if (look !== undefined) return look;
  }
  return undefined;
}

const iconsBySheet = new WeakMap<SpriteSheet, ReadonlyMap<string, Texture>>();

/**
 * Good string id -> standing-vehicle texture for every vehicle good the sheet can draw. Memoized per
 * sheet, which outlives every panel mount: a `Texture` pins a resize listener on its shared source.
 */
export function vehicleGoodIcons(
  sheet: SpriteSheet | undefined,
  content: VehicleIconContent,
): ReadonlyMap<string, Texture> {
  if (sheet === undefined) return new Map();
  const cached = iconsBySheet.get(sheet);
  if (cached !== undefined) return cached;
  const icons = new Map<string, Texture>();
  for (const good of content.goods) {
    if (good.vehicleHouse === undefined) continue;
    const vehicleType = vehicleTypeOfGood(content, good.id);
    const look = vehicleType === undefined ? undefined : anyTribeLook(sheet, vehicleType);
    if (look === undefined) continue;
    // Without its baked icon page an indexed look has no icon: the generic heap beats a red silhouette.
    const layer = sheet.families?.[look.indexed === true ? vehicleIconStem(look.layer) : look.layer];
    const frame = layer?.atlas.frames.get(standingFrame(look));
    if (layer === undefined || frame === undefined) continue;
    // The frame's feet-anchor offset is discarded: the icon is centred on the picture's bounding box.
    icons.set(
      good.id,
      new Texture({
        source: layer.source,
        frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
      }),
    );
  }
  iconsBySheet.set(sheet, icons);
  return icons;
}
