import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import type { GoodRef } from '../../../content/settler-gfx/index.js';
import { buildSandboxBuildings } from '../building-set.js';
import { sandboxWeapons } from '../combat.js';
import {
  sandboxGatheringPipeline,
  sandboxLandscape,
  sandboxLandscapeGfx,
  type TerrainTypeIds,
} from '../landscape.js';
import { buildSandboxAtomicAnimations } from './catalog/atomic-animations.js';
import { buildSandboxGoods } from './catalog/goods.js';
import { buildSandboxJobs } from './catalog/jobs.js';
import { buildSandboxTribes } from './catalog/tribes.js';
import type { SandboxContentExtras } from './types.js';

export type { SandboxContentExtras } from './types.js';

/** The complete validated clean-room content set shared by scenes and the playable vertical slice. */
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
    atomicAnimations: buildSandboxAtomicAnimations(),
  });
}

/** The good identity view consumed by settler graphics bindings. */
export function sandboxGoods(): readonly GoodRef[] {
  return sandboxContent().goods.map((good) => ({ typeId: good.typeId, id: good.id }));
}
