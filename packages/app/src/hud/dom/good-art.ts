import type { ContentSet } from '@open-northland/data';
import { loadGoodsManifest } from '../../content/goods-gfx.js';
import { type SpriteIconFrame, servedAtlas, spriteGoodIcon } from '../../content/sprite-good-icons.js';
import { diag } from '../../diag/index.js';
import type { GoodIconSource, PresentationPack } from '../../presentation/pack.js';

/**
 * A good's icon for a DOM surface, drawn as a CSS background crop of its sheet: the presentation pack's
 * icon when it has one, else the original's recoloured pile atlas (`/bobs/ls_goods.<palette>.png`), the
 * same frame the Pixi panels show, else a vehicle's or an animal's own sprite for a good with no pile.
 * `null` when nothing is served.
 */

async function pileIcon(goodId: string): Promise<SpriteIconFrame | null> {
  const manifest = await loadGoodsManifest();
  const icon = manifest?.icons[goodId];
  if (manifest === null || icon === undefined) return null;
  // The preview stem names one palette's sheet; every palette's sheet sits beside it, same packing.
  const stem = manifest.previewStem.replace(/\.[^.]+$/, `.${icon.palette}`);
  const atlas = await servedAtlas(stem);
  return atlas === null ? null : { stem, atlas, bobId: icon.frame };
}

export async function goodIconSource(
  goodId: string,
  pack: PresentationPack | null,
  content: ContentSet | null,
): Promise<GoodIconSource | null> {
  const packed = pack?.goodIconSource(goodId);
  if (packed !== undefined) return packed;
  const icon = (await pileIcon(goodId)) ?? (content === null ? null : await spriteGoodIcon(content, goodId));
  const frame = icon?.atlas.frames.find((f) => f.bobId === icon.bobId);
  if (icon === null || frame === undefined) return null;
  const { atlas, stem } = icon;
  return { url: `/bobs/${stem}.png`, sheet: { width: atlas.width, height: atlas.height }, rect: frame.rect };
}

/**
 * Icons are sized by area, not by their longest side, so a thin sword and a round loaf carry about
 * the same visual mass (FOUNDATION.md): the sprite's square root of area lands on `mass` design px,
 * capped so its longest side stays inside the box with a margin.
 */
export const GOOD_ICON_BOX_PX = 25;
const GOOD_ICON_MASS_PX = 19.5;
const GOOD_ICON_MARGIN_PX = 1;

/** An empty icon slot: a `boxPx` box centring the frame element `goodIconStyle` fills. */
export function goodIconMarkup(boxPx = GOOD_ICON_BOX_PX): string {
  return `<span class="on-good" aria-hidden="true" style="width:${boxPx}px;height:${boxPx}px"><i class="on-good__frame"></i></span>`;
}

/** The frame element's inline style: sized to the scaled frame exactly, so the sheet shows nothing
 *  beside a thin sprite (a background the size of the box would leak the neighbouring frames in). A
 *  smaller box keeps the same mass-to-box proportion. */
export function goodIconStyle(source: GoodIconSource, boxPx = GOOD_ICON_BOX_PX): string {
  const { rect, sheet } = source;
  const proportion = boxPx / GOOD_ICON_BOX_PX;
  const scale = Math.min(
    (GOOD_ICON_MASS_PX * proportion) / Math.sqrt(rect.width * rect.height),
    (boxPx - GOOD_ICON_MARGIN_PX * proportion) / Math.max(rect.width, rect.height),
  );
  const px = (n: number): string => `${n.toFixed(2)}px`;
  return `width:${px(rect.width * scale)};height:${px(rect.height * scale)};background-image:url("${source.url}");background-size:${px(sheet.width * scale)} ${px(sheet.height * scale)};background-position:${px(-rect.x * scale)} ${px(-rect.y * scale)};`;
}

/** Fills a `goodIconMarkup` frame with a good's icon at `boxPx`; the frame's style is replaced once the
 *  source resolves, and a frame that left the document meanwhile is skipped. */
export type GoodIconPainter = (frame: HTMLElement, goodId: string, boxPx: number) => void;

/** One painter per game: the icon a good resolves to follows the pack and the content that game draws
 *  with, and a menu-to-game swap builds a new painter in the same document. */
export function createGoodIconPainter(
  pack: PresentationPack | null,
  content: ContentSet | null,
): GoodIconPainter {
  const sources = new Map<string, Promise<GoodIconSource | null>>();
  return (frame, goodId, boxPx) => {
    let pending = sources.get(goodId);
    if (pending === undefined) {
      pending = goodIconSource(goodId, pack, content);
      sources.set(goodId, pending);
    }
    pending
      .then((source) => {
        if (source !== null && frame.isConnected) frame.style.cssText = goodIconStyle(source, boxPx);
      })
      .catch((error: unknown) => diag.warn('hud', `good icon ${goodId}: ${String(error)}`));
  };
}
