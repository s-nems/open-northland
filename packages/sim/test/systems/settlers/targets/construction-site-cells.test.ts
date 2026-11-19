import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Owner, Position, UnderConstruction } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import { collectTargets } from '../../../../src/systems/settlers/targets/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { grassCellMap as grassMap } from '../../../fixtures/terrain.js';

const HEADQUARTERS = 1;
const VIKING = 1;
const PLAYER = 0;
/** A vehicle house added to testContent: its site is raised by the workshop worker alone. */
const VEHICLE_YARD = 900;
const HANDCART = 1;
const WOOD = 1;

function yardContent() {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: VEHICLE_YARD,
        id: 'handcart_yard',
        kind: 'vehicle',
        vehicleType: HANDCART,
        construction: [{ goodType: WOOD, amount: 1 }],
        hitpoints: 100,
      },
    ],
  });
}

function siteAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  sim.world.add(e, Owner, { player: PLAYER });
  sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  return e;
}

function fixture() {
  const sim = new Simulation({ seed: 1, content: yardContent(), map: grassMap(16, 8) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  const pass = () => collectTargets(sim.world, ctxOf(sim), terrain);
  return { sim, pass };
}

describe('constructionSiteCells - the planner site index kept across ticks', () => {
  it('is one index across passes that follows sites begun, finished and razed between them', () => {
    const { sim, pass } = fixture();
    const sites = [siteAt(sim, 2, 1), siteAt(sim, 6, 3), siteAt(sim, 10, 5)];
    const first = pass().constructionSiteCells;
    const [finished, razed] = sites;
    if (finished === undefined || razed === undefined) throw new Error('fixture sites missing');
    siteAt(sim, 13, 6);
    sim.world.remove(finished, UnderConstruction);
    sim.world.destroy(razed);
    const next = pass();
    expect(next.constructionSiteCells).toBe(first);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('moves a site between the served and the vehicle lists when its type changes in place', () => {
    const { sim, pass } = fixture();
    const site = siteAt(sim, 6, 3);
    const here = sim.terrain?.nodeAt(6, 6);
    if (here === undefined) throw new Error('fixture map missing');
    const any = () => ({ payload: null });
    const first = pass();
    expect(first.constructionSites).toEqual([site]);
    expect(first.vehicleSites).toEqual([]);

    sim.world.mut(site, Building).buildingType = VEHICLE_YARD;
    const asYard = pass();
    expect(asYard.constructionSiteCells).toBe(first.constructionSiteCells);
    expect(asYard.constructionSites).toEqual([]);
    expect(asYard.vehicleSites).toEqual([site]);
    expect(asYard.constructionSiteCells.nearest(here, here, any)).toBeNull();
    expect(sim.world.verifyCaches()).toEqual([]);

    sim.world.mut(site, Building).buildingType = HEADQUARTERS;
    const back = pass();
    expect(back.constructionSites).toEqual([site]);
    expect(back.vehicleSites).toEqual([]);
    expect(back.constructionSiteCells.nearest(here, here, any)?.entity).toBe(site);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
