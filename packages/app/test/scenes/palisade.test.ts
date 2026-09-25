import type { Entity, Simulation } from '@open-northland/sim';
import { components, hexDistanceBetween, nodeOfPosition } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { GOOD_WOOD } from '../../src/game/sandbox/index.js';
import { sandboxPalisadeTypes } from '../../src/game/sandbox/palisades.js';
import {
  firstTravellerCrossed,
  PALISADE_GATE,
  PALISADE_GATE_CLOSE_TICK,
  PALISADE_GATE_REOPEN_TICK,
  PALISADE_RUN_TICKS,
  PALISADE_WORK_SITES,
  palisadeAt,
  palisadeGateIsOpen,
  palisadeScene,
  secondTravellerCrossed,
} from '../../src/scenes/palisade.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

const { Carrying, Health, Palisade, Position, Stockpile, SupplyRun, UnderConstruction } = components;

sceneAcceptance(palisadeScene, import.meta.url);

/** The segment standing at a node, failing the test where it is missing rather than asserting it away. */
function segmentAt(sim: Simulation, hx: number, hy: number): Entity {
  const wall = palisadeAt(sim, hx, hy);
  if (wall === null) throw new Error(`expected a palisade at ${hx},${hy}`);
  return wall;
}

it('uses the source repair deltas for wall and gate records', () => {
  const types = sandboxPalisadeTypes();
  expect(
    types.filter((type) => type.wall?.gate !== undefined).map((type) => type.wall?.repairPerStrike),
  ).toEqual([1, 1, 1, 1, 1, 1]);
  expect(
    types.filter((type) => type.wall?.gate === undefined).map((type) => type.wall?.repairPerStrike),
  ).toEqual([3, 3, 3, 3, 3, 3]);
});

it('places adjacent wall anchors through ordinary commands and mutates the world', () => {
  const sim = createSceneSim(palisadeScene);
  sim.step();

  const ordinaryPlacements = sim.commands.log
    .map((entry) => entry.command)
    .filter((command) => command.kind === 'placePalisade')
    .filter((command) => command.force !== true && command.underConstruction !== true);
  expect(ordinaryPlacements.map((command) => [command.x, command.y])).toEqual([
    [30, 36],
    [31, 36],
    [32, 36],
  ]);
  for (const command of ordinaryPlacements) {
    expect(sim.world.has(segmentAt(sim, command.x, command.y), UnderConstruction)).toBe(false);
  }
});

it('converts a five-wall span by clearing its two neighbours and keeping the outer posts', () => {
  const sim = createSceneSim(palisadeScene);
  for (let hx = PALISADE_GATE.hx - 2; hx <= PALISADE_GATE.hx + 2; hx++) {
    expect(palisadeAt(sim, hx, PALISADE_GATE.hy)).not.toBeNull();
  }

  sim.step();

  const gate = segmentAt(sim, PALISADE_GATE.hx, PALISADE_GATE.hy);
  expect(sim.world.get(gate, Palisade).gate?.open).toBe(false);
  expect(palisadeAt(sim, PALISADE_GATE.hx - 1, PALISADE_GATE.hy)).toBeNull();
  expect(palisadeAt(sim, PALISADE_GATE.hx + 1, PALISADE_GATE.hy)).toBeNull();
  // The gate's own body covers these two, so they stay standing inside it as the source leaves them.
  expect(palisadeAt(sim, PALISADE_GATE.hx - 2, PALISADE_GATE.hy)).not.toBeNull();
  expect(palisadeAt(sim, PALISADE_GATE.hx + 2, PALISADE_GATE.hy)).not.toBeNull();
});

it('plants exclusive builder flags before fetching wood and completes two real segments', () => {
  const sim = createSceneSim(palisadeScene);
  const source = [...sim.world.query(Stockpile)].find(
    (entity) => (sim.world.get(entity, Stockpile).amounts.get(GOOD_WOOD) ?? 0) === 2,
  );
  if (source === undefined) throw new Error('expected the work yard warehouse to hold both wood units');

  let sawUnplantedClaim = false;
  let sawTwoExclusiveClaims = false;
  let sawPlantedBeforeFetch = false;
  let sawPlantedAfterTravel = false;
  const distanceAtClaim = new Map<number, number>();

  for (let tick = 0; tick < PALISADE_RUN_TICKS; tick++) {
    sim.step();
    const walls = PALISADE_WORK_SITES.owned.flatMap((node) => {
      const wall = palisadeAt(sim, node.hx, node.hy);
      return wall === null ? [] : [{ wall, node }];
    });
    const claims = walls.flatMap(({ wall, node }) => {
      const reservation = sim.world.get(wall, Palisade).reservation;
      return reservation === null ? [] : [{ wall, node, ...reservation }];
    });

    sawUnplantedClaim ||= claims.some((claim) => !claim.planted);
    if (claims.length >= 2) {
      sawTwoExclusiveClaims ||= new Set(claims.map((claim) => claim.builder)).size === claims.length;
    }

    for (const claim of claims) {
      const supply = sim.world.tryGet(claim.builder, SupplyRun);
      if (supply?.site === claim.wall)
        expect(claim.builder).toBe(sim.world.get(claim.wall, Palisade).reservation?.builder);
      const at = nodeOfPosition(
        sim.world.get(claim.builder, Position).x,
        sim.world.get(claim.builder, Position).y,
      );
      const distance = hexDistanceBetween(at.hx, at.hy, claim.node.hx, claim.node.hy);
      if (!distanceAtClaim.has(claim.builder)) distanceAtClaim.set(claim.builder, distance);
      if (!claim.planted) continue;
      sawPlantedAfterTravel ||= distance < (distanceAtClaim.get(claim.builder) ?? distance);
      if (
        (sim.world.get(source, Stockpile).amounts.get(GOOD_WOOD) ?? 0) === 2 &&
        !sim.world.has(claim.builder, Carrying) &&
        !sim.world.has(claim.builder, SupplyRun)
      ) {
        sawPlantedBeforeFetch = true;
      }
    }
  }

  expect(sawUnplantedClaim).toBe(true);
  expect(sawTwoExclusiveClaims).toBe(true);
  expect(sawPlantedBeforeFetch).toBe(true);
  expect(sawPlantedAfterTravel).toBe(true);

  const owned = PALISADE_WORK_SITES.owned.map((node) => palisadeAt(sim, node.hx, node.hy));
  const completed = owned.filter(
    (wall): wall is NonNullable<typeof wall> => wall !== null && !sim.world.has(wall, UnderConstruction),
  );
  expect(completed).toHaveLength(2);
  for (const wall of completed) expect(sim.world.get(wall, Health)).toEqual({ hitpoints: 100, max: 100 });

  const claimed = owned.filter(
    (wall): wall is NonNullable<typeof wall> =>
      wall !== null &&
      sim.world.has(wall, UnderConstruction) &&
      sim.world.get(wall, Palisade).reservation?.planted === true,
  );
  expect(claimed).toHaveLength(1);
  const unclaimed = segmentAt(sim, PALISADE_WORK_SITES.unclaimed.hx, PALISADE_WORK_SITES.unclaimed.hy);
  expect(sim.world.has(unclaimed, UnderConstruction)).toBe(true);
  expect(sim.world.get(unclaimed, Palisade).reservation).toBeNull();
});

it('a closed gate holds the second traveller until the commanded reopen', () => {
  const sim = createSceneSim(palisadeScene);
  sim.run(PALISADE_GATE_CLOSE_TICK + 80);
  expect(firstTravellerCrossed(sim)).toBe(true);
  expect(palisadeGateIsOpen(sim)).toBe(false);
  expect(secondTravellerCrossed(sim)).toBe(false);

  sim.run(PALISADE_GATE_REOPEN_TICK + 270 - sim.tick);
  expect(palisadeGateIsOpen(sim)).toBe(true);
  expect(secondTravellerCrossed(sim)).toBe(true);
});
