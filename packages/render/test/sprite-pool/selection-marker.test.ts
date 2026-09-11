import { Texture } from 'pixi.js';
import { expect, it } from 'vitest';
import { LayerBinder } from '../../src/gpu/sprite-pool/bind-layers.js';
import { createPooled } from '../../src/gpu/sprite-pool/pooled-entity.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';

it('transforms ground geometry with the sprite offset and source scale, then clears it on fallback', () => {
  const binder = new LayerBinder(new TextureCache(), undefined);
  const pe = createPooled('building', undefined);
  const item = { ref: 1, kind: 'building', x: 100, y: 200, depth: 200 } as const;
  const frame = { camera: { offsetX: 0, offsetY: 0, scale: 2 }, screenW: 800, screenH: 600 };
  binder.bind(
    pe,
    item,
    [
      {
        source: Texture.WHITE.source,
        scale: 0.5,
        frame: {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          offsetX: -100,
          offsetY: -180,
          selectionEllipse: { cx: 110, cy: 170, rx: 70, ry: 25 },
        },
      },
    ],
    frame,
    1,
  );
  expect(pe.selectionEllipse).toEqual({ cx: 5, cy: -5, rx: 35, ry: 12.5 });
  binder.bind(pe, item, null, frame, 2);
  expect(pe.selectionEllipse).toBeUndefined();
  pe.container.destroy({ children: true });
});
