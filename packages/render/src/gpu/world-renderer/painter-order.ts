import type { Container } from 'pixi.js';

export interface WorldSceneLayers {
  readonly terrain: Container;
  readonly decorShadows: Container;
  readonly decor: Container;
  readonly wakes: Container;
  /** Rain splashes, water rings and ground wisps: over the ground, under the fog and every sprite. */
  readonly weatherGround: Container;
  readonly fog: Container;
  readonly constructionPlots: Container;
  readonly placementWash: Container;
  readonly selection: Container;
  readonly bones: Container;
  readonly sprites: Container;
  /** Over the sprites: an order's acknowledgement or a refused goal must not hide behind the rock or tree
   *  it marks. */
  readonly orderMarkers: Container;
  readonly blood: Container;
  readonly damageSmoke: Container;
  readonly constructionSigns: Container;
  readonly bubbles: Container;
  readonly hearts: Container;
  readonly geometryDebug: Container;
}

/** Mount back to front. This order is the z-order: the world layer does not sort. */
export function mountPainterOrder(world: Container, layers: WorldSceneLayers): void {
  world.addChild(
    layers.terrain,
    layers.decorShadows,
    layers.decor,
    layers.wakes,
    layers.weatherGround,
    layers.fog,
    layers.constructionPlots,
    layers.placementWash,
    layers.selection,
    layers.bones,
    layers.sprites,
    layers.orderMarkers,
    layers.blood,
    layers.damageSmoke,
    layers.constructionSigns,
    layers.bubbles,
    layers.hearts,
    layers.geometryDebug,
  );
}
