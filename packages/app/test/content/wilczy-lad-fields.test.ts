import { footprintCellDx } from '@open-northland/data';
import { isIndoorSettler } from '@open-northland/render';
import { components, nodeOfPosition } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { realMapWorld } from './real-map-world.js';

it('loads the ripe fields around the starting farm as workable crops', async () => {
  const { sim, content } = await realMapWorld({ mapId: 'wilczy_lad', aiSeats: [], humanSeats: [0] });
  const at = [...sim.world.query(components.Crop, components.Position)].filter((entity) => {
    const pos = sim.world.get(entity, components.Position);
    const node = nodeOfPosition(pos.x, pos.y);
    return Math.abs(node.hx - 162) + Math.abs(node.hy - 249) <= 16;
  });
  expect(at.length).toBeGreaterThan(0);
  const startingField = at.find((entity) => sim.world.get(entity, components.Crop).stage === 5);
  expect(startingField).toBeDefined();
  if (startingField === undefined) return;
  expect(sim.world.get(startingField, components.Crop)).toMatchObject({ farm: null, stage: 5 });
  expect(sim.world.get(startingField, components.Resource).remaining).toBe(1);
  expect(sim.world.has(startingField, components.LandscapeResource)).toBe(true);

  const farm = [...sim.world.query(components.Building, components.Position)].find((entity) => {
    const pos = sim.world.get(entity, components.Position);
    const node = nodeOfPosition(pos.x, pos.y);
    return node.hx === 162 && node.hy === 249;
  });
  const wheat = content.goods.find((good) => good.id === 'wheat')?.typeId;
  expect(farm).toBeDefined();
  expect(wheat).toBeDefined();
  if (farm === undefined || wheat === undefined) return;
  const footprint = content.buildings.find(
    (building) => building.typeId === sim.world.get(farm, components.Building).buildingType,
  )?.footprint;
  expect(footprint).toBeDefined();
  if (footprint === undefined) return;
  const farmZone = new Set(
    footprint.reserved.map((cell) => `${162 + footprintCellDx(249, cell)},${249 + cell.dy}`),
  );
  expect(farmZone.has('160,250')).toBe(true);
  expect(farmZone.has('161,250')).toBe(true);
  const cropNodes = [...sim.world.query(components.Crop, components.Position)].map((entity) => {
    const position = sim.world.get(entity, components.Position);
    const node = nodeOfPosition(position.x, position.y);
    return `${node.hx},${node.hy}`;
  });
  expect(cropNodes.some((node) => farmZone.has(node))).toBe(false);
  const farmer = [...sim.world.query(components.Settler, components.JobAssignment)].find(
    (entity) => sim.world.get(entity, components.JobAssignment).workplace === farm,
  );
  expect(farmer).toBeDefined();
  if (farmer === undefined) return;

  let doorDeposit = false;
  let sowCount = 0;
  for (let tick = 0; tick < 2_000; tick++) {
    sim.step();
    const atomic = sim.world.tryGet(farmer, components.CurrentAtomic);
    if (atomic?.effect.kind === 'sow') {
      sowCount++;
      expect(farmZone.has(`${atomic.effect.x},${atomic.effect.y}`)).toBe(false);
    }
    if (atomic?.effect.kind === 'harvest') {
      const position = sim.world.get(atomic.effect.resource, components.Position);
      const node = nodeOfPosition(position.x, position.y);
      expect(farmZone.has(`${node.hx},${node.hy}`)).toBe(false);
    }
    if (atomic?.effect.kind === 'pileup' && atomic.effect.store === farm) {
      const position = sim.world.get(farmer, components.Position);
      const node = nodeOfPosition(position.x, position.y);
      doorDeposit ||= node.hx === 162 && node.hy === 250;
      const snapshot = sim.snapshot();
      const drawn = snapshot.entities.find((entity) => entity.id === farmer);
      expect(drawn).toBeDefined();
      if (drawn !== undefined) expect(isIndoorSettler(snapshot, drawn.components)).toBe(true);
    }
  }

  expect(doorDeposit).toBe(true);
  expect(sowCount).toBeGreaterThan(0);
  expect(sim.world.get(farm, components.Stockpile).amounts.get(wheat) ?? 0).toBeGreaterThan(0);
});
