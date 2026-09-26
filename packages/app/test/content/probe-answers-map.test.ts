import { existsSync } from 'node:fs';
import { components, type NodeGridAnswer, nodeGridAccepts, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapPath, realMapWorld } from './real-map-world.js';

const { Building, Owner } = components;

const MAP_ID = 'magiczny_las';
const SEAT = 0;

/** The nodes where the answer and the live probe part, empty when they agree everywhere. */
function disagreements(answer: NodeGridAnswer | null, live: (hx: number, hy: number) => boolean): string[] {
  if (answer === null) throw new Error('no answer on a decoded map');
  const { area } = answer;
  const parted: string[] = [];
  for (let hy = area.minHy; hy <= area.maxHy; hy++) {
    for (let hx = area.minHx; hx <= area.maxHx; hx++) {
      if (nodeGridAccepts(answer, hx, hy) !== live(hx, hy)) parted.push(`${hx},${hy}`);
    }
  }
  return parted;
}

function seatTribe(sim: Simulation): number {
  for (const e of sim.world.query(Building, Owner)) {
    if (sim.world.get(e, Owner).player === SEAT) return sim.world.get(e, Building).tribe;
  }
  throw new Error(`seat ${SEAT} holds no building`);
}

/** The plain-data probe answers a host hands across threads, checked node for node against the live
 *  probes over a whole decoded map. */
describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))('probe answers on a decoded map', () => {
  it('answer every node of the map as the live probes do', { timeout: 120_000 }, async () => {
    // Progression off, so the seat's technology gate admits the house and the grid has ground to agree on.
    const { sim, ir } = await realMapWorld({
      mapId: MAP_ID,
      aiSeats: [],
      humanSeats: [SEAT],
      rules: { fog: null, progression: false, needs: null },
    });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('a decoded map has terrain');
    const map = { minHx: 0, minHy: 0, maxHx: terrain.width - 1, maxHy: terrain.height - 1 };
    const house = ir.buildings?.find((row) => row.id === 'home_level_00')?.typeId;
    if (house === undefined) throw new Error('no home_level_00 row in the served IR');
    const tribe = seatTribe(sim);

    const building = sim.placementProbe(house, SEAT, tribe);
    if (building === null) throw new Error('no building probe');
    const answer = sim.placementAnswer(house, map, SEAT, tribe);
    expect(disagreements(answer, (hx, hy) => building.canPlace(hx, hy))).toEqual([]);
    expect(answer?.accepted.some((node) => node === 1)).toBe(true);

    const signpost = sim.signpostProbe(SEAT);
    if (signpost === null) throw new Error('no signpost probe');
    expect(disagreements(sim.signpostAnswer(SEAT, map), (hx, hy) => signpost.canPlace(hx, hy))).toEqual([]);

    const wall = terrain.landscapes?.types.find(
      (type) => type.wall !== undefined && type.wall.gate === undefined,
    );
    if (wall === undefined) return;
    const palisade = sim.palisadeProbe(wall.typeId);
    if (palisade === null) throw new Error('no wall probe');
    expect(
      disagreements(sim.palisadeAnswer(wall.typeId, map), (hx, hy) => palisade.canPlace(hx, hy)),
    ).toEqual([]);
  });
});
