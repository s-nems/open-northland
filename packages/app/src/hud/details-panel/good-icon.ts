import { type Container, Sprite } from 'pixi.js';
import { GENERIC_GOOD_ICON, type GoodIcon, makeGoodSprite } from '../../content/goods-gfx.js';
import type { Rect } from '../geometry.js';
import type { DetailsPanelAssets } from './assets.js';

export function createGoodIcon(
  assets: DetailsPanelAssets,
  scale: number,
  front: Container,
  resolution: { readonly w: number; readonly h: number },
) {
  const placeGoodIcon = (icon: GoodIcon, r: Rect): void => {
    if (assets.goods === null) return;
    const made = makeGoodSprite(assets.goods, icon);
    if (made === null) return;
    made.sprite.flipY = true;
    front.addChild(made.sprite);
    const { w, h } = resolution;
    // The state-1 pile frames vary in native size (~12-26 px); shrink each into the icon box, never
    // upscaling past the panel scale, so a big pile doesn't overrun the amount plate.
    const fit = Math.min(1, r.w / (made.frame.width * scale), r.h / (made.frame.height * scale));
    const drawScale = scale * fit;
    const x = Math.round(r.x + r.w / 2 - (made.frame.offsetX + made.frame.width / 2) * drawScale);
    const y = Math.round(r.y + r.h / 2 - (made.frame.offsetY + made.frame.height / 2) * drawScale);
    made.sprite.place(x, y, drawScale, w, h);
  };

  const goodIcon = (goodId: string, r: Rect): void => {
    const texture =
      assets.packGoods?.get(goodId) ?? assets.animalGoods?.get(goodId) ?? assets.vehicleGoods?.get(goodId);
    if (!texture) {
      placeGoodIcon(assets.goods?.icon(goodId) ?? GENERIC_GOOD_ICON, r);
      return;
    }
    const sprite = new Sprite(texture);
    const fit = Math.min(r.w / texture.width, r.h / texture.height);
    sprite.scale.set(fit);
    sprite.position.set(
      Math.round(r.x + (r.w - sprite.width) / 2),
      Math.round(r.y + (r.h - sprite.height) / 2),
    );
    front.addChild(sprite);
  };

  return goodIcon;
}
