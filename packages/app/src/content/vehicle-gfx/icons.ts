import { DEFAULT_FACING, frameOf, type SpriteSheet, type VehicleLook } from '@open-northland/render';
import { Rectangle, Texture } from 'pixi.js';

/**
 * A vehicle good's HUD icon is the vehicle itself, standing: the wait clip's frame at the default facing,
 * cut from the loaded vehicle atlas. A vehicle good has no `ls_goods` pile (it is built on a yard, never
 * shelved), so the generic heap it would otherwise draw reads as a pile of wood.
 */

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
    const layer = look === undefined ? undefined : sheet.families?.[look.layer];
    const frame =
      look === undefined ? undefined : layer?.atlas.frames.get(frameOf(look.idle, DEFAULT_FACING, 0));
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
