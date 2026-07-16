import { indexById } from '@open-northland/data';
import type { Entity } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { resolveVikingBuilding } from '../src/catalog/buildings.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import {
  assignmentPriority,
  JOB_COLLECTOR,
  placeSandboxBuilding,
  spawnSandboxSettler,
  workerRoleOf,
} from '../src/game/sandbox/index.js';
import { buildingTypeOf, isBuilding, isSettler, num, ownerPlayerOf } from '../src/game/snapshot.js';
import { createSceneSim, getScene } from '../src/scenes/index.js';
import { computeDoorBadges } from '../src/view/projections/index.js';

/**
 * End-to-end proof of the door-badge chain over the REAL sandbox content (the seam the right-click
 * gesture drives): a player `assignWorker` command binds an owned settler to a sandbox workshop, and
 * {@link computeDoorBadges} then surfaces a badge at that building's door. This is what the browser
 * gesture ultimately does — select a settler, right-click a workshop — minus the mouse pick (covered by
 * picking.ts) and the pixel (covered by badge-layer.test.ts).
 */
describe('assignWorker → door badge, over sandbox content', () => {
  it('binds a settler to a workshop and the door badge appears', () => {
    const scene = getScene('sandbox');
    if (scene === undefined) throw new Error('sandbox scene missing');
    const sim = createSceneSim(scene);
    // The village staffs every slot it can, so the gesture needs its own open workshop: an extra pottery
    // on free ground plus a fresh collector beside it (the command re-jobs the settler on binding).
    const EXTRA = { x: 80, y: 20 } as const;
    placeSandboxBuilding(sim, 'work_pottery_00', EXTRA.x, EXTRA.y);
    spawnSandboxSettler(sim, JOB_COLLECTOR, EXTRA.x - 3, EXTRA.y);
    sim.step();

    const doorTable = indexById(sim.content.buildings);
    const potteryType = resolveVikingBuilding('work_pottery_00').typeId;

    const snap0 = sim.snapshot();
    const buildings = snap0.entities.filter((e) => isBuilding(e) && buildingTypeOf(e) === potteryType);
    // The extra pottery is the easternmost one (EXTRA.x is far right of the village) — selected by
    // position, not placement order, which the snapshot does not promise.
    const posX = (e: (typeof buildings)[number]): number =>
      num((e.components.Position as { x?: unknown } | undefined)?.x) ?? Number.NEGATIVE_INFINITY;
    const building = buildings.reduce<(typeof buildings)[number] | undefined>(
      (best, e) => (best === undefined || posX(e) > posX(best) ? e : best),
      undefined,
    );
    const settler = snap0.entities.findLast((e) => isSettler(e) && ownerPlayerOf(e) === HUMAN_PLAYER);
    if (building === undefined || settler === undefined)
      throw new Error('no assignable workshop / owned settler in the sandbox');

    // Build the priority exactly as the right-click gesture does, and assign the settler there.
    const jobPriority = assignmentPriority(doorTable.get(buildingTypeOf(building) ?? -1)?.workers);
    sim.enqueue({
      kind: 'assignWorker',
      entity: settler.id as Entity,
      building: building.id as Entity,
      jobPriority,
    });
    sim.step();

    const snap1 = sim.snapshot();
    // The settler is now bound to the chosen building …
    const bound = snap1.entities.find((e) => e.id === settler.id);
    const workplace = num(
      (bound?.components.JobAssignment as { workplace?: unknown } | undefined)?.workplace,
    );
    expect(workplace).toBe(building.id);
    // … and a badge appears at its door — never a gatherer (the right-click never assigns one).
    const badge = computeDoorBadges(snap1, doorTable, workerRoleOf).find((b) => b.id === building.id);
    expect(badge).toBeDefined();
    expect((badge?.craftsmen ?? 0) + (badge?.carriers ?? 0)).toBeGreaterThan(0);
  });
});
