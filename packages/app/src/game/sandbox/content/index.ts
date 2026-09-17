import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { WHEAT_WORK_REPEATS } from '../../../catalog/farming.js';
import { EXTENDED_GOODS } from '../../../catalog/goods.js';
import { HUNTER_GENERAL_XP_TRACK, huntPreyRows } from '../../../catalog/hunting.js';
import { JOB_COLLECTOR } from '../../../catalog/jobs.js';
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
import { buildSandboxVehicles } from './catalog/vehicles.js';
import type { SandboxContentExtras, WorldContentOptions } from './types.js';

export type { SandboxContentExtras, WorldContentOptions } from './types.js';

/**
 * Source basis: extracted `humanjobexperiencetypes.ini` type 46, rebound to the sandbox's farm slot job.
 * `experienceFactor` is 0 rather than the extracted 100 so training cannot shift the flat grain rate
 * `farm-pacing.test.ts` calibrates; real content indexes the extracted row instead.
 */
const FARMER_WHEAT_XP_TRACK = {
  typeId: 46,
  id: 'farmer_wheat',
  name: 'farmer wheat',
  jobType: JOB_FARMER_SLOT,
  goodTypes: [GOOD_WHEAT],
  experienceFactor: 0,
  baseRepeatCounter: WHEAT_WORK_REPEATS,
} as const;

/**
 * Source basis: extracted `humanjobexperiencetypes.ini` type 2. It carries no `baserepeatcounter`, so a
 * novice collector's stroke-counted gathers (felling, mining) cost the default ten strokes per unit.
 */
const COLLECTOR_GENERAL_XP_TRACK = {
  typeId: 2,
  id: 'collector_general',
  name: 'collector general',
  jobType: JOB_COLLECTOR,
  experienceFactor: 100,
} as const;

/** The goods rows are built loosely typed; the vehicle holds key on their `typeId`. */
function hasTypeId(row: object): row is { readonly typeId: number } {
  return typeof (row as { typeId?: unknown }).typeId === 'number';
}

export function sandboxContent(map?: TerrainTypeIds, extras: SandboxContentExtras = {}): ContentSet {
  const buildings = buildSandboxBuildings(extras);
  const jobs = buildSandboxJobs(extras);
  const tribes = buildSandboxTribes([...jobs.keys()], extras);
  const goods = buildSandboxGoods(extras);
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { mod: 'opennorthland-global-sandbox' }, locale: 'eng' },
    goods,
    vehicles: buildSandboxVehicles(goods.filter(hasTypeId), [...jobs.keys()]),
    jobs: [...jobs.values()],
    buildings: [...buildings.values()].sort((a, b) => a.typeId - b.typeId),
    landscape: sandboxLandscape(map),
    landscapeGfx: sandboxLandscapeGfx(),
    gatheringPipeline: sandboxGatheringPipeline(),
    weapons: sandboxWeapons(),
    armor: sandboxArmor(),
    tribes: [...tribes.values()],
    animals: buildSandboxAnimals(),
    huntPrey: huntPreyRows(EXTENDED_GOODS, SANDBOX_ANIMAL_TRIBES),
    jobExperience: [COLLECTOR_GENERAL_XP_TRACK, HUNTER_GENERAL_XP_TRACK, FARMER_WHEAT_XP_TRACK],
    atomicAnimations: buildSandboxAtomicAnimations(),
  });
}

/**
 * A real-content override wins whole: it already ships footprints and names, so the overlays apply only
 * to the sandbox catalog.
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

export function sandboxGoods(): readonly GoodRef[] {
  return sandboxContent().goods.map((good) => ({ typeId: good.typeId, id: good.id }));
}
