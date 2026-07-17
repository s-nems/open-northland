import { components, type Entity, halfCellMapFromCells, nodeOfPosition } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { runAuthoredSlice } from '../../src/slice/vertical-slice.js';
import { hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

const { Settler } = components;

/** A real viking `sethouse` name whose type carries a walk-block body (`work_well_00`, typeId 10) — the
 *  join key a decoded map authors, resolved here exactly as `resolveAuthoredPlacements` does it. */
const WELL_EDIT_NAME = 'viking well';
const WELL_LEVEL = 0;
const MAP_CELLS = 40;
const ANCHOR = { hx: 20 * 2, hy: 20 * 2 };

/** The raw IR lanes this test joins over — `buildingBobs` is a graphics lane the sim `ContentSet` does
 *  not carry, so it comes from {@link rawIrUnderTest} (see helpers). */
interface IrRows {
  buildingBobs?: readonly { editName?: string; level?: number; typeId?: number; tribeId?: number }[];
  buildings?: readonly {
    typeId?: number;
    id?: string;
    footprint?: {
      blocked?: readonly { dx: number; dy: number }[];
      door?: { dx: number; dy: number };
    };
  }[];
}

function grassMap(cells: number) {
  return halfCellMapFromCells({
    width: cells,
    height: cells,
    typeIds: new Array(cells * cells).fill(TERRAIN_OPEN),
  });
}

/**
 * Authored maps really do place humans inside houses: a `sethuman` half-cell falls inside a `sethouse`
 * walk-block on 64 of the 122 entity-bearing decoded maps (1041 of 35279 humans, measured over
 * `content/maps/*.json` against the real `[GfxHouse]` footprints). The map load cannot fix this from the
 * building side — `enqueuePlacements` sends every `placeBuilding` before any `spawnSettler`, so a
 * building's own eviction pass runs while its future occupant does not exist yet — so `spawnSettler`
 * pushes such a settler out itself (`evictSettlerFromBlockedSpawn`). Without it the settler is walled in
 * for the whole game: `findPath` exempts only the START node, so no route out of a body ever resolves.
 *
 * This is the real-content twin of the synthetic `sim/test/movement/evict.test.ts` cases — same rule,
 * but over the real join, the real extracted footprint, and the real enqueue order.
 */
describe.runIf(hasRealIr())('authored decoded-map humans — spawns inside house bodies', () => {
  it('a human authored onto a house body cell is pushed out onto ground it can leave', async () => {
    const { merge } = await loadContentUnderTest();
    const ir = rawIrUnderTest() as IrRows;

    const bob = (ir.buildingBobs ?? []).find(
      (b) => b.editName === WELL_EDIT_NAME && (b.level ?? 0) === WELL_LEVEL,
    );
    expect(bob?.typeId).toBeDefined();
    const footprint = (ir.buildings ?? []).find((b) => b.typeId === bob?.typeId)?.footprint;
    const blocked = footprint?.blocked ?? [];
    expect(blocked.length).toBeGreaterThan(0); // the fixture type must really wall its ground off

    // The authored records: a well, and a human standing on the well's anchor. The anchor is a body cell
    // (offset 0,0) and is not the door, so this human spawns inside the walls — the map bug, in miniature.
    const door = footprint?.door;
    expect(blocked.some((c) => c.dx === 0 && c.dy === 0)).toBe(true);
    expect(door?.dx === 0 && door?.dy === 0).toBe(false);
    const entities = {
      buildings: [
        { name: WELL_EDIT_NAME, level: WELL_LEVEL, player: HUMAN_PLAYER, hx: ANCHOR.hx, hy: ANCHOR.hy },
      ],
      humans: [{ role: 'civilist', tribe: 'viking', player: HUMAN_PLAYER, hx: ANCHOR.hx, hy: ANCHOR.hy }],
      animals: [],
    };
    const rows = {
      buildingBobs: ir.buildingBobs,
      buildings: merge.content.buildings.map((b) => ({ typeId: b.typeId, id: b.id, kind: b.kind })),
      jobs: merge.content.jobs.map((j) => ({ typeId: j.typeId, id: j.id, name: j.id })),
      tribes: merge.content.tribes.map((t) => ({ typeId: t.typeId, id: t.id })),
    };

    const sim = runAuthoredSlice(
      7,
      1,
      grassMap(MAP_CELLS),
      entities,
      rows,
      undefined,
      undefined,
      merge.content,
    );
    expect(sim).not.toBeNull();
    if (sim === null) return;

    const settlers = [...sim.world.query(Settler)];
    expect(settlers.length).toBe(1); // the one authored human — a dropped join would pass vacuously
    const p = sim.world.get(settlers[0] as Entity, components.Position);
    const at = nodeOfPosition(p.x, p.y);

    // The well's walk-block body, in world half-cells — the door stays a passable stand, exactly as
    // `buildingBlockedCells` carves it out.
    const body = new Set(blocked.map((c) => `${ANCHOR.hx + c.dx},${ANCHOR.hy + c.dy}`));
    if (door) body.delete(`${ANCHOR.hx + door.dx},${ANCHOR.hy + door.dy}`);
    expect(body.has(`${at.hx},${at.hy}`)).toBe(false); // pushed off the walls…
    expect(at.hx === ANCHOR.hx && at.hy === ANCHOR.hy).toBe(false); // …and really moved off its anchor
  }, 120000);
});
