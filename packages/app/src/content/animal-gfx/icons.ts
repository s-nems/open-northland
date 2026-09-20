import type { SpriteFrameRef, SpriteSheet } from '@open-northland/render';
import { Rectangle, Texture } from 'pixi.js';

/**
 * A species good's HUD icon: one standing frame of the animal itself, cut from the body atlas the sheet
 * already holds for the map.
 *
 * Approximation: the original draws nothing here. Its stock rows carry the `{gfxgood:<type>,1}` escape,
 * which resolves a good's pile graphic through its `landscapetype`, and sheep and cattle sit on the void
 * type that has no `ls_goods` record - so the engine skips the icon and does not even reserve its column.
 * A shrunken animal names the row far better than the neutral heap our own fallback would draw.
 */

/** The facing the icon is cut at: `0` is SW in the body strip's block order, the near-side view whose
 *  silhouette still reads as the animal once it is shrunk into a row's icon box. */
const ICON_FACING = 0;

const iconsBySheet = new WeakMap<SpriteSheet, Map<string, Texture>>();

/** The species goods' icon textures by good id, empty without a loaded sheet or animal looks. Memoized
 *  per sheet: a `Texture` pins a resize listener on its shared source, so one map serves every remount. */
export function animalGoodIcons(
  sheet: SpriteSheet | undefined,
  goods: readonly { readonly typeId: number; readonly id: string }[],
  tribeOfGood: ((goodType: number) => number | null) | undefined,
): ReadonlyMap<string, Texture> {
  if (sheet === undefined || tribeOfGood === undefined) return new Map();
  const cached = iconsBySheet.get(sheet);
  if (cached !== undefined) return cached;
  const icons = new Map<string, Texture>();
  for (const good of goods) {
    const tribe = tribeOfGood(good.typeId);
    const texture = tribe === null ? undefined : animalIcon(sheet, tribe);
    if (texture !== undefined) icons.set(good.id, texture);
  }
  iconsBySheet.set(sheet, icons);
  return icons;
}

/** One animal tribe's standing frame, or undefined when its look never bound. */
function animalIcon(sheet: SpriteSheet, tribe: number): Texture | undefined {
  const character = sheet.characters?.animals?.byTribe[tribe];
  if (character === undefined) return undefined;
  const frame = character.body.atlas.frames.get(standingBobId(character.binding.idle, ICON_FACING));
  if (frame === undefined) return undefined;
  return new Texture({
    source: character.body.source,
    frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
  });
}

/** The bob id a binding rests on at `facing` - the renderer's idle pick for the two shapes an animal
 *  binding carries, without the draw item a real frame pick is built around. */
function standingBobId(ref: SpriteFrameRef, facing: number): number {
  if (typeof ref === 'number') return ref;
  if ('frameLists' in ref) {
    const lists = ref.frameLists;
    if (lists.length === 0) return ref.start;
    return ref.start + (lists[facing % lists.length]?.[0] ?? 0);
  }
  return ref.start + (facing % ref.dirs) * ref.stride;
}
