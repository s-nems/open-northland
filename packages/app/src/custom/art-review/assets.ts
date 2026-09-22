import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import house from '../../assets/custom/buildings/house-1/runtime.json';
import character from '../../assets/custom/characters/man-silver/runtime.json';
import { customBuildingAtlas, customBuildingManifest } from '../content/building-manifest.js';
import { customCharacterAtlas, customCharacterManifest } from '../content/character-manifest.js';

export const reviewCharacter = customCharacterManifest.parse(character);
const reviewBuilding = customBuildingManifest.parse(house);
export const reviewWalk = { frames: reviewCharacter.walkFrames, duration: reviewCharacter.walkDuration };

const urls = {
  grass: new URL('../../assets/custom/terrain/grass-base.png', import.meta.url).href,
  soil: new URL('../../assets/custom/terrain/soil.png', import.meta.url).href,
  house: new URL('../../assets/custom/buildings/house-1/house-painted-runtime.png', import.meta.url).href,
  walk: new URL('../../assets/custom/characters/man-silver/atlas.png', import.meta.url).href,
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
  const frame = customBuildingAtlas(reviewBuilding).frames.get(0);
  if (frame === undefined) throw new Error('Review building frame missing');
  const sprite = new Sprite(texture);
  sprite.scale.set(reviewBuilding.scale);
  sprite.position.set(frame.offsetX * reviewBuilding.scale, frame.offsetY * reviewBuilding.scale);
  house.addChild(sprite);
  return house;
}

export function reviewWalkTextures(texture: Texture): readonly Texture[] {
  const atlas = customCharacterAtlas(reviewCharacter);
  return Array.from({ length: reviewWalk.frames }, (_, index) => {
    const frame = atlas.frames.get(index);
    if (frame === undefined) throw new Error(`Review walk frame missing: ${index}`);
    return new Texture({
      source: texture.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
    });
  });
}
