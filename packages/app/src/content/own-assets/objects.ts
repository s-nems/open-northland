import { type ElevationField, halfCellToScreen, type MapObjectSprite } from '@open-northland/render';
import { Graphics, type Renderer } from 'pixi.js';
import { forEachPlacement } from '../map-placements.js';
import type { LoadedMapObjects, MapObjectsData } from '../objects.js';
import { ownPropFrameIndex } from './prop-manifest.js';
import { loadOwnProps } from './props.js';

export async function loadOwnMapObjects(
  renderer: Renderer,
  objects: MapObjectsData,
  elevation: ElevationField,
): Promise<LoadedMapObjects> {
  const props = await loadOwnProps();
  const byName = new Map(
    props.flatMap((prop) => {
      const resolved = { ...prop, states: [...prop.layer.atlas.frames.values()].map((frame) => [frame]) };
      return prop.manifest.editNames.map((name) => [name, resolved] as const);
    }),
  );
  const art = new Graphics().circle(5, 5, 4).fill(0x66d5b0).stroke({ color: 0x173f39, width: 1 });
  const texture = renderer.generateTexture(art);
  art.destroy();
  const frames = [
    {
      x: 0,
      y: 0,
      width: texture.width,
      height: texture.height,
      offsetX: -texture.width / 2,
      offsetY: -texture.height / 2,
    },
  ];
  const sprites: MapObjectSprite[] = [];
  const byPlacement = new Map<number, MapObjectSprite>();
  forEachPlacement(objects.placements, (hx, hy, type, ordinal) => {
    const prop = byName.get(objects.types[type] ?? '');
    const point = halfCellToScreen(hx, hy);
    const sprite: MapObjectSprite = {
      ...point,
      source: prop?.layer.source ?? texture.source,
      frames: prop?.states[ownPropFrameIndex(objects.levels?.[ordinal], prop.states.length)] ?? frames,
      scale: prop?.manifest.scale ?? 1,
      ...(prop?.manifest.brightness === undefined ? {} : { brightness: prop.manifest.brightness }),
      ...(prop?.manifest.sway === undefined ? {} : { sway: prop.manifest.sway }),
      phase: 0,
      decor: false,
      lift: elevation.liftAtNode(hx, hy),
    };
    sprites.push(sprite);
    byPlacement.set(ordinal, sprite);
  });
  return { sprites, byPlacement };
}
