import {
  type AtlasFrame,
  type ElevationField,
  halfCellToScreen,
  type MapObjectSprite,
} from '@open-northland/render';
import { Graphics, type Renderer, type TextureSource } from 'pixi.js';
import { drawsAsFlatDecor, landscapeRecordsByName } from '../ir/joins.js';
import type { ContentIr } from '../ir/rows.js';
import { forEachPlacement } from '../map-placements.js';
import type { LoadedMapObjects, MapObjectsData } from '../objects.js';
import { ownPropFrameIndex } from './prop-manifest.js';
import { type LoadedOwnProp, loadOwnProps } from './props.js';

/** The mint dot standing in for a placement no own prop covers. */
export interface PlaceholderGfx {
  readonly source: TextureSource;
  readonly frames: readonly AtlasFrame[];
}

export async function loadOwnMapObjects(
  renderer: Renderer,
  objects: MapObjectsData,
  ir: ContentIr,
  elevation: ElevationField,
): Promise<LoadedMapObjects> {
  const props = await loadOwnProps();
  const byName = new Map(
    props.flatMap((prop) => prop.manifest.editNames.map((name) => [name, prop] as const)),
  );
  const art = new Graphics().circle(5, 5, 4).fill(0x66d5b0).stroke({ color: 0x173f39, width: 1 });
  const texture = renderer.generateTexture(art);
  art.destroy();
  const placeholder: PlaceholderGfx = {
    source: texture.source,
    frames: [
      {
        x: 0,
        y: 0,
        width: texture.width,
        height: texture.height,
        offsetX: -texture.width / 2,
        offsetY: -texture.height / 2,
      },
    ],
  };
  return placeOwnMapObjects(objects, ir, elevation, byName, placeholder);
}

/** Resolve each placement to its own prop's frame for the placement's level, or to the placeholder. A
 *  placement's paint order follows its original record, so grass and bushes stay flat ground decor. */
export function placeOwnMapObjects(
  objects: MapObjectsData,
  ir: ContentIr,
  elevation: ElevationField,
  propsByName: ReadonlyMap<string, LoadedOwnProp>,
  placeholder: PlaceholderGfx,
): LoadedMapObjects {
  const records = landscapeRecordsByName(ir);
  // Per type: the prop and its level-indexed single-frame states, shared by every placement of the type.
  const byType = objects.types.map((name) => {
    const prop = propsByName.get(name);
    const record = records.get(name);
    return {
      prop,
      states: prop === undefined ? [] : [...prop.layer.atlas.frames.values()].map((frame) => [frame]),
      decor: record !== undefined && drawsAsFlatDecor(record),
    };
  });
  const sprites: MapObjectSprite[] = [];
  const byPlacement = new Map<number, MapObjectSprite>();
  forEachPlacement(objects.placements, (hx, hy, type, ordinal) => {
    const resolved = byType[type];
    const prop = resolved?.prop;
    const states = resolved?.states ?? [];
    const point = halfCellToScreen(hx, hy);
    const sprite: MapObjectSprite = {
      ...point,
      source: prop?.layer.source ?? placeholder.source,
      frames: states[ownPropFrameIndex(objects.levels?.[ordinal], states.length)] ?? placeholder.frames,
      scale: prop?.manifest.scale ?? 1,
      ...(prop?.manifest.brightness === undefined ? {} : { brightness: prop.manifest.brightness }),
      ...(prop?.manifest.sway === undefined ? {} : { sway: prop.manifest.sway }),
      phase: 0,
      decor: resolved?.decor === true,
      lift: elevation.liftAtNode(hx, hy),
    };
    sprites.push(sprite);
    byPlacement.set(ordinal, sprite);
  });
  return { sprites, byPlacement };
}
