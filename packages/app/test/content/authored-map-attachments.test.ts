import { existsSync } from 'node:fs';
import { components, type Entity, halfCellMapFromCells } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { runAuthoredMap } from '../../src/game/world/index.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';
import { realMapPath, realMapWorld } from './real-map-world.js';

const { Building, JobAssignment, Residence, Settler } = components;

const MAP_CELLS = 40;
/** Real `[GfxHouse]` EditNames and `[jobtype]` slugs - the join keys a decoded map authors. */
const HOME = 'viking home';
const SMITHY = 'viking smithy';
const TOWER = 'viking tower';
const SMITH = 'smith';
const ARCHER = 'soldier_bow_short';
const VIKING = 'viking';

function grassMap(cells: number) {
  return halfCellMapFromCells({
    width: cells,
    height: cells,
    typeIds: new Array(cells * cells).fill(TERRAIN_OPEN),
  });
}

type Merged = Awaited<ReturnType<typeof loadContentUnderTest>>['merge'];

function joinRows(merge: Merged) {
  return {
    // A bob without an EditName carries no join key, so it cannot name an authored `sethouse`.
    buildingBobs: merge.content.buildingBobs.flatMap((b) =>
      b.editName === undefined
        ? []
        : [{ editName: b.editName, level: b.level, typeId: b.typeId, tribeId: b.tribeId }],
    ),
    buildings: merge.content.buildings.map((b) => ({ typeId: b.typeId, id: b.id, kind: b.kind })),
    jobs: merge.content.jobs.map((j) => ({ typeId: j.typeId, id: j.id, name: j.id })),
    tribes: merge.content.tribes.map((t) => ({ typeId: t.typeId, id: t.id })),
    goods: merge.content.goods.map((g) => ({ typeId: g.typeId, id: g.id, name: g.id })),
  };
}

function jobTypeOf(merge: Merged, id: string): number {
  const job = merge.content.jobs.find((j) => j.id === id);
  if (job === undefined) throw new Error(`the real content has no \`${id}\` job`);
  return job.typeId;
}

/** The number of `jobType` posts the building drawn by `editName` at level 0 offers. */
function slotCount(merge: Merged, editName: string, jobType: number): number {
  const bob = merge.content.buildingBobs.find((b) => b.editName === editName && b.level === 0);
  const type = merge.content.buildings.find((b) => b.typeId === bob?.typeId);
  const slot = type?.workers.find((w) => w.jobType === jobType);
  if (slot === undefined) throw new Error(`the real \`${editName}\` offers no job ${jobType}`);
  return slot.count;
}

/**
 * A decoded map authors a settler's home and workplace as `attachtohouse` rows in its `sethuman` block.
 * This covers the half after the decoder - the anchor join and the `spawnSettler` command - over the real
 * building kinds and worker slots, so a rescoped kind or a renamed worker job surfaces here instead of
 * silently returning every imported settler to homeless and unposted.
 */
describe.runIf(hasRealIr())('authored decoded-map settlers - the attachtohouse targets', () => {
  it('routes each attachment by the real building kind, with the slot column disagreeing', async () => {
    const { merge } = await loadContentUnderTest();
    // A home of its own per settler and a smithy per smith: `viking home` level 0 holds one family and
    // `viking smithy` one smith, so shared targets would refuse on capacity and hide what is being tested.
    const homeA = { hx: 8, hy: 8 };
    const homeB = { hx: 20, hy: 8 };
    const smithyA = { hx: 30, hy: 30 };
    const smithyB = { hx: 34, hy: 34 };
    const entities = {
      buildings: [
        { name: HOME, level: 0, player: HUMAN_PLAYER, ...homeA },
        { name: HOME, level: 0, player: HUMAN_PLAYER, ...homeB },
        { name: SMITHY, level: 0, player: HUMAN_PLAYER, ...smithyA },
        { name: SMITHY, level: 0, player: HUMAN_PLAYER, ...smithyB },
      ],
      humans: [
        // The corpus pair: slot 1 the home, slot 2 the workplace.
        {
          role: SMITH,
          tribe: VIKING,
          player: HUMAN_PLAYER,
          hx: 10,
          hy: 10,
          attach: [
            { ...homeA, slot: 1 },
            { ...smithyA, slot: 2 },
          ],
        },
        // One mod map authors slot 2 for a home as well; the target's kind is what decides.
        { role: SMITH, tribe: VIKING, player: HUMAN_PLAYER, hx: 12, hy: 12, attach: [{ ...homeB, slot: 2 }] },
        // The stray slot the corpus carries once (32), on a workplace.
        {
          role: SMITH,
          tribe: VIKING,
          player: HUMAN_PLAYER,
          hx: 14,
          hy: 14,
          attach: [{ ...smithyB, slot: 32 }],
        },
        { role: SMITH, tribe: VIKING, player: HUMAN_PLAYER, hx: 16, hy: 16 }, // nothing authored
      ],
      animals: [],
    };
    const sim = runAuthoredMap(7, 1, grassMap(MAP_CELLS), entities, joinRows(merge), {
      content: merge.content,
    });
    expect(sim).not.toBeNull();
    if (sim === null) return;

    // Every house and smith resolved - a dropped join would pass the rest vacuously.
    const buildings = [...sim.world.query(Building)];
    expect(buildings).toHaveLength(4);
    const settlers = [...sim.world.query(Settler)];
    expect(settlers).toHaveLength(4);
    type Four = [Entity, Entity, Entity, Entity]; // the two length assertions above are the proof
    const [houseA, houseB, forgeA, forgeB] = buildings as Four;
    const [pair, homeBySlotTwo, workByStraySlot, unattached] = settlers as Four;

    expect(sim.world.get(pair, Residence).home).toBe(houseA);
    expect(sim.world.get(pair, JobAssignment).workplace).toBe(forgeA);
    expect(sim.world.get(homeBySlotTwo, Residence).home).toBe(houseB);
    expect(sim.world.has(homeBySlotTwo, JobAssignment)).toBe(false);
    expect(sim.world.get(workByStraySlot, JobAssignment).workplace).toBe(forgeB);
    expect(sim.world.has(workByStraySlot, Residence)).toBe(false);
    expect(sim.world.has(unattached, Residence)).toBe(false);
    expect(sim.world.has(unattached, JobAssignment)).toBe(false);
  });

  // 45 of the corpus's attachments post a bow soldier to a tower - the one class whose admission runs
  // through `garrisonPostOpenTo`, which admits a settler only in the fighter trade it already holds.
  it('mans a real tower with the archers a map attaches to it, up to its own slot count', async () => {
    const { merge } = await loadContentUnderTest();
    const archerJob = jobTypeOf(merge, ARCHER);
    const slots = slotCount(merge, TOWER, archerJob);
    const towerAt = { hx: 30, hy: 30 };
    const entities = {
      buildings: [{ name: TOWER, level: 0, player: HUMAN_PLAYER, ...towerAt }],
      // One more archer than the tower has short-bow posts, so the cap is proven rather than assumed.
      humans: Array.from({ length: slots + 1 }, (_, i) => ({
        role: ARCHER,
        tribe: VIKING,
        player: HUMAN_PLAYER,
        hx: 10 + i,
        hy: 10,
        attach: [{ ...towerAt, slot: 2 }],
      })),
      animals: [],
    };

    const sim = runAuthoredMap(7, 1, grassMap(MAP_CELLS), entities, joinRows(merge), {
      content: merge.content,
    });
    expect(sim).not.toBeNull();
    if (sim === null) return;

    const tower = [...sim.world.query(Building)][0];
    const settlers = [...sim.world.query(Settler)];
    expect(settlers).toHaveLength(slots + 1);
    const manned = settlers.filter((e) => sim.world.tryGet(e, JobAssignment)?.workplace === tower);
    expect(manned).toHaveLength(slots);
    // Manned in their own class, never downgraded into the tower's carrier posts.
    for (const e of settlers) expect(sim.world.get(e, Settler).jobType).toBe(archerJob);
  });
});

/** The corpus map with the most `attachtohouse` rows, and the one whose towers this feature mans. */
const CORPUS_MAP = 'tale_of_six_sons_multiplayer';

/**
 * The whole chain over one real decoded map, from the generated `content/maps/*.json` to the settlers
 * standing in their buildings. Every other test here builds its own entity rows, so this is the only
 * one that reads what the pipeline actually wrote.
 */
describe.runIf(hasRealIr() && existsSync(realMapPath(CORPUS_MAP)))('a real decoded map, end to end', () => {
  it('lands its authored attachments at tick 0', { timeout: 120_000 }, async () => {
    const { sim } = await realMapWorld({ mapId: CORPUS_MAP, aiSeats: [] });
    const housed = [...sim.world.query(Residence)].length;
    const posted = [...sim.world.query(JobAssignment)].length;
    // Measured against the owned copy; both move only on an intentional content or gate change.
    expect(housed).toBe(3);
    expect(posted).toBe(27);
  });
});
