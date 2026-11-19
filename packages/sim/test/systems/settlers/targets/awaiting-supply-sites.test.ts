import { describe, expect, it } from 'vitest';
import {
  Owner,
  Position,
  RoadSite,
  sameSideAs,
  UnderConstruction,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, positionOfNode, Simulation } from '../../../../src/index.js';
import { soloSitesAwaitingSupply } from '../../../../src/systems/settlers/drives/economy/awaiting-supply-sites.js';
import { InteractionCellIndex, QUALIFIES } from '../../../../src/systems/settlers/targets/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { grassCellMap } from '../../../fixtures/terrain.js';

const VIKING = 1;
const WOOD = 1;
const MAP_CELLS = 24;
/** More sites than the index scans linearly, so its ring grids answer. */
const SITES = 90;
const ROUNDS = 12;
const PLAYERS = 2;

describe('soloSitesAwaitingSupply - the staging index kept across reads', () => {
  it('answers every search as an index built fresh over the sites with supply inbound', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('fixture map missing');
    const ctx = ctxOf(sim);
    const sites: Entity[] = [];
    for (let i = 0; i < SITES; i++) {
      const site = sim.world.create();
      const hx = (i * 7) % terrain.width;
      const hy = (i * 11) % terrain.height;
      sim.world.add(site, Position, positionOfNode(hx, hy));
      sim.world.add(site, RoadSite, {
        tribe: VIKING,
        construction: [{ goodType: WOOD, amount: 1 }],
        reservation: null,
      });
      sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
      sim.world.add(site, Owner, { player: i % PLAYERS });
      sites.push(site);
    }
    const inbound = new Map<Entity, unknown>();
    expect(soloSitesAwaitingSupply(sim.world, ctx, terrain, inbound, 'road')).toBeNull();
    for (let round = 0; round < ROUNDS; round++) {
      // Supply starts and ends at a shifting share of the sites, and a site is finished now and then.
      for (const [i, site] of sites.entries()) {
        if ((i + round) % 3 === 0) inbound.delete(site);
        else if ((i * round) % 5 === 1) inbound.set(site, null);
      }
      const finished = sites[round * 5];
      if (finished !== undefined) sim.world.remove(finished, UnderConstruction);
      const held = soloSitesAwaitingSupply(sim.world, ctx, terrain, inbound, 'road');
      const awaiting = [...inbound.keys()].filter((site) => sim.world.has(site, UnderConstruction));
      if (awaiting.length === 0) {
        expect(held).toBeNull();
        continue;
      }
      if (held === null) throw new Error(`round ${round}: no index over ${awaiting.length} sites`);
      const fresh = new InteractionCellIndex(sim.world, ctx, terrain, awaiting);
      for (let probe = 0; probe < PLAYERS * 3; probe++) {
        const here = terrain.nodeAt((probe * 13 + round) % terrain.width, (probe * 17) % terrain.height);
        const onSide = sameSideAs(sim.world, probe % PLAYERS);
        const accept = () => QUALIFIES;
        expect(held.nearest(here, here, accept, undefined, undefined, onSide)?.entity).toBe(
          fresh.nearest(here, here, accept, undefined, undefined, onSide)?.entity,
        );
      }
    }
  });

  it('verifies clean while a filed site destroyed since the last read waits to be dropped', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('fixture map missing');
    const ctx = ctxOf(sim);
    const inbound = new Map<Entity, unknown>();
    const sites: Entity[] = [];
    for (let i = 0; i < DESTROY_SITES; i++) {
      const site = sim.world.create();
      sim.world.add(site, Position, positionOfNode(i * 3, i * 2));
      sim.world.add(site, RoadSite, {
        tribe: VIKING,
        construction: [{ goodType: WOOD, amount: 1 }],
        reservation: null,
      });
      sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
      sim.world.add(site, Owner, { player: i % PLAYERS });
      inbound.set(site, null);
      sites.push(site);
    }
    const held = soloSitesAwaitingSupply(sim.world, ctx, terrain, inbound, 'road');
    if (held === null) throw new Error('no index over the filed sites');
    held.filedOnSide(0);
    const [destroyed] = sites;
    if (destroyed === undefined) throw new Error('no site to destroy');
    sim.world.destroy(destroyed);

    expect(sim.world.verifyCaches()).toEqual([]);
    inbound.delete(destroyed);
    soloSitesAwaitingSupply(sim.world, ctx, terrain, inbound, 'road');
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});

const DESTROY_SITES = 4;
