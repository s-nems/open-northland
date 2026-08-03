import type { Container } from 'pixi.js';

export interface WorldSceneLayers {
  readonly terrain: Container;
  readonly decor: Container;
  readonly fog: Container;
  readonly constructionPlots: Container;
  readonly placementWash: Container;
  readonly selection: Container;
  readonly bones: Container;
  readonly sprites: Container;
  readonly blood: Container;
  readonly damageSmoke: Container;
  readonly constructionSigns: Container;
  readonly bubbles: Container;
  readonly hearts: Container;
  readonly geometryDebug: Container;
}

/**
 * Mount the world layer's nodes back to front. This order is the z-order: the world layer does not sort.
 * A mark that must occlude like a sprite rather than stack over the whole scene takes no slot here and
 * joins the sorted sprite layer instead. The fog wash covers ground and flat decor only, because entities
 * on fogged ground are culled individually by the pool and the tall-object gate.
 */
export function mountPainterOrder(world: Container, layers: WorldSceneLayers): void {
  world.addChild(
    layers.terrain,
    layers.decor,
    layers.fog,
    layers.constructionPlots,
    layers.placementWash,
    layers.selection,
    layers.bones,
    layers.sprites,
    layers.blood,
    layers.damageSmoke,
    layers.constructionSigns,
    layers.bubbles,
    layers.hearts,
    layers.geometryDebug,
  );
}
