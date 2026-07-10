import { indexById } from '@vinland/data';
import type { Entity } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { JOB_CARRIER } from '../src/game/sandbox/ids.js';
import { isBuilding, isSettler, num, ownerPlayerOf } from '../src/game/snapshot.js';
import { createSceneSim, getScene } from '../src/scenes/index.js';
import { computeDoorBadges } from '../src/view/door-badges.js';

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
    sim.step();

    const doorTable = indexById(sim.content.buildings);
    const workshopTypes = new Set(
      [...doorTable].filter(([, b]) => b.workers.length > 0).map(([typeId]) => typeId),
    );

    const snap0 = sim.snapshot();
    const building = snap0.entities.find(
      (e) =>
        isBuilding(e) &&
        workshopTypes.has(num((e.components.Building as { buildingType?: unknown }).buildingType) ?? -1),
    );
    const settler = snap0.entities.find((e) => isSettler(e) && ownerPlayerOf(e) === HUMAN_PLAYER);
    if (building === undefined || settler === undefined)
      throw new Error('no workshop / owned settler in the sandbox');

    // No badge for this building before anyone is assigned.
    expect(computeDoorBadges(snap0, doorTable, JOB_CARRIER).some((b) => b.id === building.id)).toBe(false);

    sim.enqueue({ kind: 'assignWorker', entity: settler.id as Entity, building: building.id as Entity });
    sim.step();

    const snap1 = sim.snapshot();
    const badge = computeDoorBadges(snap1, doorTable, JOB_CARRIER).find((b) => b.id === building.id);
    expect(badge).toBeDefined();
    expect((badge?.workers ?? 0) + (badge?.carriers ?? 0)).toBeGreaterThan(0);
  });
});
