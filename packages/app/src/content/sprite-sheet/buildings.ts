import type { BuildingTypeBinding, SpriteLayer } from '@open-northland/render';
import { diag } from '../../diag/index.js';
import type { WorldTribes } from '../../game/world-tribes.js';
import { buildingBinding, candidateFamilies, referencedFamilyLayers } from '../building-gfx/index.js';
import { loadLayer, MissingAtlasError } from '../ir/load.js';
import type { ContentIr } from '../ir/rows.js';

/** The building half of the sheet: the per-tribe binding and exactly the family atlases it draws from. */
export interface BuildingSheet {
  readonly binding: BuildingTypeBinding;
  readonly families: Record<string, SpriteLayer>;
}

/**
 * Load the building bodies of every tribe in `tribes`, the first of which is the base. Two reductions:
 * the first, over every family those tribes' rows name, says which atlases the winning rows actually draw
 * from, and the second rebuilds the binding over the ones that loaded, so a type whose page is missing
 * degrades to the base tribe's bob instead of drawing a stranger's frame id. Restricting the load to the
 * tribes a world fields is what keeps the page count off the whole content tree, not what makes it small:
 * a civilization costs roughly its own 15 house atlases, and a six-civilization world still wants half a
 * gigabyte of decoded pages.
 */
export async function loadBuildingSheet(
  ir: ContentIr | null,
  tribes: WorldTribes,
  shadowStems: ReadonlyMap<string, string>,
): Promise<BuildingSheet> {
  const candidates = candidateFamilies(ir, tribes);
  const wanted = referencedFamilyLayers(buildingBinding(ir, tribes, candidates));
  const families: Record<string, SpriteLayer> = {};
  await Promise.all(
    candidates
      .filter((family) => wanted.has(family.layer))
      .map(async (family) => {
        try {
          families[family.layer] = await loadLayer(family.layer, shadowStems.get(family.layer));
        } catch (err) {
          if (!(err instanceof MissingAtlasError)) throw err; // a real decode bug still surfaces
          // Undecoded content: the types on this page fall back to the base tribe's body, which looks
          // right enough to go unnoticed without a word here.
          diag.warn('content', `building page '${family.layer}' is not decoded - falling back`);
        }
      }),
  );
  const loaded = candidates.filter((family) => families[family.layer] !== undefined);
  return { binding: buildingBinding(ir, tribes, loaded), families };
}
