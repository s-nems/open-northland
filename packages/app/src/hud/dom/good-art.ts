import { loadGoodsManifest } from '../../content/goods-gfx.js';
import { fetchJsonOrNull } from '../../content/net.js';
import { type GoodIconSource, ownGoodIconSource } from '../../content/own-assets/goods.js';

/**
 * A good's icon for a DOM surface, drawn as a CSS background crop of its sheet: the project's own art
 * when it exists, else the original's recoloured pile atlas (`/bobs/ls_goods.<palette>.png`), the
 * same frame the Pixi panels show. `null` when neither is served.
 */

/** The served atlas manifest's fields this reader needs. */
interface AtlasJson {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly {
    readonly bobId: number;
    readonly rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }[];
}

const atlasByPalette = new Map<string, Promise<AtlasJson | null>>();

function paletteAtlas(stem: string): Promise<AtlasJson | null> {
  let pending = atlasByPalette.get(stem);
  if (pending === undefined) {
    pending = fetchJsonOrNull<AtlasJson>(`/bobs/${stem}.atlas.json`);
    atlasByPalette.set(stem, pending);
  }
  return pending;
}

export async function goodIconSource(goodId: string): Promise<GoodIconSource | null> {
  const own = ownGoodIconSource(goodId);
  if (own !== undefined) return own;
  const manifest = await loadGoodsManifest();
  const icon = manifest?.icons[goodId];
  if (manifest === null || icon === undefined) return null;
  // The preview stem names one palette's sheet; every palette's sheet sits beside it, same packing.
  const stem = manifest.previewStem.replace(/\.[^.]+$/, `.${icon.palette}`);
  const atlas = await paletteAtlas(stem);
  const frame = atlas?.frames.find((f) => f.bobId === icon.frame);
  if (atlas === null || frame === undefined) return null;
  return { url: `/bobs/${stem}.png`, sheet: { width: atlas.width, height: atlas.height }, rect: frame.rect };
}

/**
 * Icons are sized by area, not by their longest side, so a thin sword and a round loaf carry about
 * the same visual mass (FOUNDATION.md): the sprite's square root of area lands on `mass` design px,
 * capped so its longest side stays inside the box with a margin.
 */
export const GOOD_ICON_BOX_PX = 29;
const GOOD_ICON_MASS_PX = 22.5;
const GOOD_ICON_MARGIN_PX = 1;

/** The inline style that crops `source` into a `GOOD_ICON_BOX_PX` square element. */
export function goodIconStyle(source: GoodIconSource): string {
  const { rect, sheet } = source;
  const scale = Math.min(
    GOOD_ICON_MASS_PX / Math.sqrt(rect.width * rect.height),
    (GOOD_ICON_BOX_PX - GOOD_ICON_MARGIN_PX) / Math.max(rect.width, rect.height),
  );
  const px = (n: number): string => `${n.toFixed(2)}px`;
  const left = (GOOD_ICON_BOX_PX - rect.width * scale) / 2 - rect.x * scale;
  const top = (GOOD_ICON_BOX_PX - rect.height * scale) / 2 - rect.y * scale;
  return `background-image:url("${source.url}");background-size:${px(sheet.width * scale)} ${px(sheet.height * scale)};background-position:${px(left)} ${px(top)};`;
}
