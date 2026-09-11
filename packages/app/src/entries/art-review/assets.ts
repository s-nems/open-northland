import { Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import character from '../../assets/own/characters/man-silver/runtime.json';

export const reviewWalk = { frames: character.walkFrames, duration: character.walkDuration };

const urls = {
  grass: new URL('../../../../../docs/art/terrain/grass/grass-base.png', import.meta.url).href,
  soil: new URL('../../../../../docs/art/terrain/grass/soil.png', import.meta.url).href,
  house: new URL('../../../../../docs/art/diagnostics/cottage/cottage-alpha.png', import.meta.url).href,
  walk: new URL(
    '../../../../../docs/art/characters/appearances/man-silver/sprites/walk-SW-88px.png',
    import.meta.url,
  ).href,
};

export async function loadReviewAssets(): Promise<Record<keyof typeof urls, Texture>> {
  const [grass, soil, house, walk] = await Promise.all([
    Assets.load<Texture>(urls.grass),
    Assets.load<Texture>(urls.soil),
    Assets.load<Texture>(urls.house),
    Assets.load<Texture>(urls.walk),
  ]);
  grass.source.scaleMode = 'linear';
  soil.source.scaleMode = 'linear';
  grass.source.autoGenerateMipmaps = true;
  soil.source.autoGenerateMipmaps = true;
  house.source.scaleMode = 'linear';
  return { grass, soil, house, walk };
}

export function contactShadow(width: number, height: number): Graphics {
  const shadow = new Graphics();
  for (const [scale, alpha] of [
    [1.4, 0.04],
    [1.15, 0.07],
    [1, 0.12],
  ]) {
    if (scale === undefined || alpha === undefined) continue;
    shadow.ellipse(0, 0, width * scale, height * scale).fill({ color: 0x302820, alpha });
  }
  return shadow;
}

export function reviewHouse(texture: Texture): Container {
  const house = new Container();
  const size = 260;
  const sprite = new Sprite(texture);
  sprite.width = size;
  sprite.height = size;
  sprite.position.set(-size / 2, -size * 0.91);
  house.addChild(sprite);
  return house;
}
