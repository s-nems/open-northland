import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { EXTENDED_GOODS } from '../../../catalog/goods.js';
import { HUNTER_GENERAL_XP_TRACK, huntPreyRows } from '../../../catalog/hunting.js';
import type { GoodRef } from '../../../content/settler-gfx/index.js';
import { buildSandboxBuildings } from '../building-set.js';
import { sandboxWeapons } from '../combat.js';
import {
  sandboxGatheringPipeline,
  sandboxLandscape,
  sandboxLandscapeGfx,
  type TerrainTypeIds,
} from '../landscape.js';
import { buildSandboxAnimals, SANDBOX_ANIMAL_TRIBES } from './catalog/animals.js';
import { buildSandboxAtomicAnimations } from './catalog/atomic-animations.js';
import { buildSandboxGoods } from './catalog/goods.js';
import { buildSandboxJobs } from './catalog/jobs.js';
import { buildSandboxTribes } from './catalog/tribes.js';
import type { SandboxContentExtras, WorldContentOptions } from './types.js';

export type { SandboxContentExtras, WorldContentOptions } from './types.js';

/** The complete validated hand-authored content set shared by scenes and the playable vertical slice. */
export function sandboxContent(map?: TerrainTypeIds, extras: SandboxContentExtras = {}): ContentSet {
  const buildings = buildSandboxBuildings(extras);
  const jobs = buildSandboxJobs(extras);
  const tribes = buildSandboxTribes([...jobs.keys()], extras);
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'opennorthland-global-sandbox' }, locale: 'eng' },
    goods: buildSandboxGoods(extras),
    jobs: [...jobs.values()],
    buildings: [...buildings.values()].sort((a, b) => a.typeId - b.typeId),
    landscape: sandboxLandscape(map),
    landscapeGfx: sandboxLandscapeGfx(),
    gatheringPipeline: sandboxGatheringPipeline(),
    weapons: sandboxWeapons(),
    tribes: [...tribes.values()],
    animals: buildSandboxAnimals(),
    // The hunter's prey/yield table and XP track (`catalog/hunting.ts`), resolved against the stable
    // sandbox id tables — the same authored balance the real-content merge applies.
    huntPrey: huntPreyRows(EXTENDED_GOODS, SANDBOX_ANIMAL_TRIBES),
    jobExperience: [HUNTER_GENERAL_XP_TRACK],
    atomicAnimations: buildSandboxAtomicAnimations(),
  });
}

/**
 * The content a world runs on: the real-content override when present, otherwise the sandbox catalog
 * for `map` with the options' footprint/name overlays (plus any extra catalog rows). Real content
 * already ships footprints and names, so an override ignores the overlays entirely. This is the one
 * place that resolution rule lives.
 */
export function resolveWorldContent(
  map: TerrainTypeIds | undefined,
  options: WorldContentOptions,
  extras?: SandboxContentExtras,
): ContentSet {
  return (
    options.content ??
    sandboxContent(map, {
      ...extras,
      ...(options.footprints !== undefined ? { buildingFootprints: options.footprints } : {}),
      ...(options.goodNames !== undefined ? { goodNames: options.goodNames } : {}),
    })
  );
}

/** The good identity view consumed by settler graphics bindings. */
export function sandboxGoods(): readonly GoodRef[] {
  return sandboxContent().goods.map((good) => ({ typeId: good.typeId, id: good.id }));
}
