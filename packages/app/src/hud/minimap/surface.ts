import {
  cellColourResolver,
  flatTileColour,
  rasterizeTerrain,
  type SceneTerrain,
} from '@open-northland/render';
import { BufferImageSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Rect } from '../geometry.js';
import type { MinimapFrame } from './frame.js';

/** Ground-raster px per device px: 2 pins the GPU's linear downscale at full averaging, so the per-cell
 *  mosaic's diamond edges resolve smooth at any DPR. */
export const RASTER_OVERSAMPLE = 2;
/** How far (native frame px) the black hole backdrop underlaps the braid's top/right inner edge, since
 *  'full' keying opens the braid's near-black crevices. Must stay under the braid's top strip. */
export const HOLE_UNDERLAP_NATIVE_PX = 8;
/** The letterbox bars + hole backdrop (matches the frame art's near-black window). */
const HOLE_COLOUR = 0x000000;
/** The flat fallback frame (bare checkout - no GUI art): parchment-dark border strokes. */
const FALLBACK_FRAME_COLOUR = 0x2c241a;

export interface MinimapSurfaceDeps {
  /** The surface parents one layer container here on creation, so the caller's fog mask and dots, added
   *  after it, stay above the still layers. */
  readonly container: Container;
  readonly terrain: SceneTerrain;
  readonly cellColours?: Uint32Array | undefined;
  readonly colourOf?: ((typeId: number) => number | undefined) | undefined;
  /** The frame's map hole and the map picture inside it, in constant panel-local px. */
  readonly hole: Rect;
  readonly map: Rect;
  readonly artScale: number;
  readonly resolution: () => number;
  readonly loadFrame: (artScale: number, resolution: number) => Promise<MinimapFrame | null>;
}

export interface MinimapSurface {
  /** Re-bake the ground raster and the braid when a live DPR change moved the renderer resolution. */
  syncResolution(): void;
  dispose(): void;
}

export async function createMinimapSurface(deps: MinimapSurfaceDeps): Promise<MinimapSurface> {
  const { container, terrain, cellColours, colourOf, hole, map, artScale, resolution, loadFrame } = deps;
  /** Captured before the await, so a DPR change landing mid-load still differs and triggers a re-bake. */
  let bakedResolution = resolution();
  let frame = await loadFrame(artScale, bakedResolution);

  const layers = new Container();
  container.addChild(layers);

  const underlap = frame !== null ? HOLE_UNDERLAP_NATIVE_PX * artScale : 0;
  const holeBg = new Graphics();
  holeBg.rect(hole.x, hole.y - underlap, hole.w + underlap, hole.h + underlap).fill(HOLE_COLOUR);
  layers.addChild(holeBg);

  if (frame !== null) {
    frame.display.position.set(0, 0);
    layers.addChild(frame.display);
  } else {
    const fallbackFrame = new Graphics();
    fallbackFrame
      .rect(hole.x - 1, hole.y - 1, hole.w + 2, hole.h + 2)
      .stroke({ width: 2, color: FALLBACK_FRAME_COLOUR });
    layers.addChild(fallbackFrame);
  }

  const colourOfType = (typeId: number): number => colourOf?.(typeId) ?? flatTileColour(typeId);
  const colourOfCell = cellColourResolver(cellColours, colourOfType);
  const bakeGround = (): Texture => {
    const pxW = Math.max(1, Math.round(map.w * RASTER_OVERSAMPLE * resolution()));
    const pxH = Math.max(1, Math.round(map.h * RASTER_OVERSAMPLE * resolution()));
    const rgba = rasterizeTerrain(terrain, colourOfCell, pxW, pxH);
    return new Texture({
      source: new BufferImageSource({ resource: rgba, width: pxW, height: pxH, scaleMode: 'linear' }),
    });
  };
  let groundTex = bakeGround();
  const ground = new Sprite(groundTex);
  ground.position.set(map.x, map.y);
  ground.width = map.w;
  ground.height = map.h;
  layers.addChild(ground);

  let disposed = false;
  /** Monotonic guard: only the newest in-flight frame re-bake may swap the braid in. */
  let frameEpoch = 0;
  const reloadFrame = (): void => {
    if (frame === null) return;
    const epoch = ++frameEpoch;
    void loadFrame(artScale, bakedResolution).then((next) => {
      if (next === null) return;
      if (disposed || epoch !== frameEpoch || frame === null) {
        next.dispose();
        return;
      }
      const at = layers.getChildIndex(frame.display);
      frame.dispose();
      frame = next;
      next.display.position.set(0, 0);
      layers.addChildAt(next.display, at);
    });
  };

  return {
    syncResolution: (): void => {
      if (resolution() === bakedResolution) return;
      bakedResolution = resolution();
      const nextTex = bakeGround();
      ground.texture = nextTex;
      groundTex.destroy(true);
      groundTex = nextTex;
      reloadFrame();
    },
    dispose: (): void => {
      disposed = true;
      frame?.dispose();
      groundTex.destroy(true);
      layers.destroy({ children: true });
    },
  };
}
