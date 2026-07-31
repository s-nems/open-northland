import type { Container } from 'pixi.js';

/** The world layer's nodes, by the slot each occupies in the painter order. */
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
  readonly doorBadges: Container;
  readonly constructionSigns: Container;
  readonly bubbles: Container;
  readonly geometryDebug: Container;
}

/**
 * Mount the world layer's nodes back to front — this order IS the z-order, since the world layer does
 * not sort. Ground-level marks sit below the sprites so a house, tree or unit in front draws over
 * them; blood, badges and bubbles sit above so a spurt shows on the struck body and a marker floats
 * over its building. The fog wash covers ground and flat decor only: entities on fogged ground are
 * individually culled (pool + tall objects), so nothing legitimate draws above it inside the fog.
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
    layers.doorBadges,
    layers.constructionSigns,
    layers.bubbles,
    layers.geometryDebug,
  );
}
