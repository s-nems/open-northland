import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { WHEAT_WORK_REPEATS } from '../../../catalog/farming.js';
import { EXTENDED_GOODS } from '../../../catalog/goods.js';
import { HUNTER_GENERAL_XP_TRACK, huntPreyRows } from '../../../catalog/hunting.js';
import type { GoodRef } from '../../../content/settler-gfx/index.js';
import { buildSandboxBuildings } from '../building-set.js';
import { sandboxArmor, sandboxWeapons } from '../combat.js';
import { GOOD_WHEAT, JOB_FARMER_SLOT } from '../ids/index.js';
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

/**
 * The sandbox farmer-wheat track: the extracted `baserepeatcounter 2` (`humanjobexperiencetypes.ini`
 * type 46) against the sandbox's own ids (the farm employs the SLOT job, not the plain farmer id), so
 * `workRepeatsFor` paces a sandbox field action like a real-content one. `experienceFactor` is 0 HERE,
 * not the extracted 100: the sandbox farm is the calibration target of `farm-pacing.test.ts` (a flat
 * ~10 grain per farmer per 10 min, measured without training), and an accruing track would master the
 * crew mid-measurement. Real content indexes the extracted row, training included.
 */
const FARMER_WHEAT_XP_TRACK = {
  typeId: 46,
  id: 'farmer_wheat',
  name: 'farmer wheat',
  jobType: JOB_FARMER_SLOT,
  goodType: GOOD_WHEAT,
  experienceFactor: 0,
  baseRepeatCounter: WHEAT_WORK_REPEATS,
} as const;

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
    armor: sandboxArmor(),
    tribes: [...tribes.values()],
    animals: buildSandboxAnimals(),
    // The hunter's prey/yield table and XP track (`catalog/hunting.ts`), resolved against the stable
    // sandbox id tables - the same authored balance the real-content merge applies. The farmer track
    // carries the extracted stroke count the field loop reads (`catalog/farming.ts`).
    huntPrey: huntPreyRows(EXTENDED_GOODS, SANDBOX_ANIMAL_TRIBES),
    jobExperience: [HUNTER_GENERAL_XP_TRACK, FARMER_WHEAT_XP_TRACK],
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
