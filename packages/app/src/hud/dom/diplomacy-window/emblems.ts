import { type DrawItem, resolveLayers, type SpriteSheet } from '@open-northland/render';
import { JOB_SOLDIER_UNARMED } from '../../../catalog/jobs.js';
import { liveCivilizationTribes } from '../../../content/civilizations.js';
import type { FigureFrames } from '../../figures/figure-frames.js';
import { growFigureBounds } from '../../figures/vehicle-fit.js';
import type { BuildingThumbs } from '../building-thumb.js';
import { createStaticPictures, showPicture } from '../static-picture.js';

export type NationEmblemPainter = (
  image: HTMLImageElement,
  tribe: number,
  player: number,
  size: number,
) => boolean;

/** Civilizations use their headquarters, as in the lobby; other peoples use their own standing
 *  character. Paint only when the roster identity changes, from the world's loaded sprite sheet. */
export function createNationEmblems(
  sheet: SpriteSheet | undefined,
  thumbs: BuildingThumbs,
  frames: FigureFrames,
  headquarters: number | undefined,
  colourOf: ((player: number) => number) | undefined,
): NationEmblemPainter {
  const pictures = createStaticPictures();
  return (image, tribe, player, size) => {
    // The content's civilization list, which a pack's flagged tribes rows extends; the boot loaded it
    // before any HUD reads it.
    if (liveCivilizationTribes().includes(tribe))
      return headquarters !== undefined && thumbs.paint(image, headquarters, size, tribe);
    // An unloaded tribe must not silently acquire the base civilization's character.
    if (
      sheet?.characters?.byTribe?.[tribe] === undefined &&
      sheet?.characters?.animals?.byTribe[tribe] === undefined
    )
      return false;
    const item: DrawItem = {
      kind: 'settler',
      ref: tribe,
      x: 0,
      y: 0,
      depth: 0,
      tribe,
      player: colourOf?.(player) ?? player,
      state: 'idle',
      facing: 0,
      jobType: JOB_SOLDIER_UNARMED,
    };
    const layers = resolveLayers(sheet, item, 0);
    if (layers === null) return false;
    const bounds = growFigureBounds(null, layers);
    if (bounds === null) return false;
    const pixels = size * 2;
    const picture = pictures.picture(`${tribe}:${item.player}:${pixels}`, pixels, pixels, (ctx) => {
      const zoom = (pixels - 4) / Math.max(1, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      frames.draw(
        ctx,
        layers,
        item,
        zoom,
        (pixels - (bounds.maxX - bounds.minX) * zoom) / 2 - bounds.minX * zoom,
        (pixels - (bounds.maxY - bounds.minY) * zoom) / 2 - bounds.minY * zoom,
      );
    });
    if (picture === null) return false;
    showPicture(image, picture);
    return true;
  };
}
