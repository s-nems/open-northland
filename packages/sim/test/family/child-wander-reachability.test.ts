import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  components as c,
  fx,
  nodeOfPosition,
  ONE,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { planChildWander } from '../../src/systems/family/wander.js';
import { routeRegions, stampResourceFootprintData } from '../../src/systems/footprint/index.js';
import { ADULT_AGE_TICKS, CHILD_AGE_TICKS } from '../../src/systems/lifecycle/ageclass.js';
import { PlannerSpacing } from '../../src/systems/settlers/planner/spacing.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

function setup(blocked = true, map: TerrainMap = grassNodeMap(24, 24)) {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    buildings: [...base.buildings, { typeId: 88, id: 'home_child_test', kind: 'home', homeSize: 3 }],
    jobs: [...base.jobs, { typeId: 4, id: 'child_male' }],
  });
  const sim = new Simulation({ seed: 7, content, map });
  const w = sim.world,
    terrain = sim.terrain;
  if (terrain === undefined) throw new Error('terrain missing');
  const home = w.create();
  w.add(home, c.Building, { buildingType: 88, tribe: 1, built: ONE, level: 0 });
  w.add(home, c.Position, positionOfNode(8, 12));
  w.add(home, c.Owner, { player: 0 });
  const child = w.create();
  w.add(child, c.Position, positionOfNode(6, 12));
  c.addPerson(w, child, {
    tribe: 1,
    jobType: 4,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  w.add(child, c.Owner, { player: 0 });
  w.add(child, c.Health, { hitpoints: 5000, max: 5000 });
  w.add(child, c.Age, { ticks: CHILD_AGE_TICKS });
  w.add(child, c.Residence, { home });
  const wall = w.create();
  w.add(wall, c.Position, positionOfNode(0, 0));
  const walk = [];
  if (blocked) for (let x = 9; x <= 10; x++) for (let y = 0; y < 24; y++) walk.push({ dx: x, dy: y });
  stampResourceFootprintData(w, wall, { walk, build: [], work: [] });
  return { sim, child, wall, terrain };
}

function stroll(f: ReturnType<typeof setup>, tick = 0) {
  const ctx = { ...ctxOf(f.sim), tick };
  planChildWander(f.sim.world, ctx, f.terrain, f.child, PlannerSpacing.forTick(f.sim.world, ctx, f.terrain));
  return f.sim.world.tryGet(f.child, c.MoveGoal)?.cell;
}

describe('child stroll reachability', () => {
  it('keeps a young child strolling in its accessible home yard without failed walks or lost reports', () => {
    const { sim, child, terrain } = setup();
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    expect(
      routeRegions(sim.world, ctxOf(sim), terrain).unroutable(terrain.nodeAt(6, 12), terrain.nodeAt(12, 10)),
    ).toBe(true);
    let moved = false;
    for (let i = 0; i < 1200; i++) {
      sim.step();
      const p = sim.world.get(child, c.Position);
      const node = nodeOfPosition(p.x, p.y);
      moved ||= node.hx !== 6 || node.hy !== 12;
      expect(node.hx).toBeLessThan(9);
      expect(sim.world.tryGet(child, c.PathRequest)?.failed).not.toBe(true);
      expect(sim.world.has(child, c.Stranded)).toBe(false);
      expect(sim.events.current().some((e) => e.kind === 'settlerLost' && e.entity === child)).toBe(false);
    }
    expect(moved).toBe(true);
    expect(sim.world.get(child, c.Age).ticks).toBeLessThan(ADULT_AGE_TICKS);
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('preserves stroll random draws and admits the far yard after a passage opens', () => {
    const blocked = setup(),
      open = setup(false);
    let rejected = 0;
    for (let i = 0; i < 1200; i++) {
      const proposed = stroll(open);
      const selected = stroll(blocked);
      expect(blocked.sim.rng.getState()).toBe(open.sim.rng.getState());
      if (proposed !== undefined && open.terrain.coordsOf(proposed).x > 10) {
        expect(selected).toBeUndefined();
        rejected++;
      }
      blocked.sim.world.remove(blocked.child, c.MoveGoal);
      open.sim.world.remove(open.child, c.MoveGoal);
    }
    expect(rejected).toBeGreaterThan(0);
    blocked.sim.world.destroy(blocked.wall);
    let crossed = false;
    for (let i = 0; i < 1200; i++) {
      const target = stroll(blocked);
      crossed ||= target !== undefined && blocked.terrain.coordsOf(target).x > 10;
      blocked.sim.world.remove(blocked.child, c.MoveGoal);
    }
    expect(crossed).toBe(true);
  });

  it('skips strolls across an uncrossable terrain component', () => {
    const typeIds = new Array<number>(24 * 24).fill(0);
    for (let x = 9; x <= 10; x++) for (let y = 0; y < 24; y++) typeIds[y * 24 + x] = 1;
    const f = setup(false, { ...grassNodeMap(24, 24), typeIds });
    const here = f.terrain.nodeAt(6, 12);
    expect(f.terrain.componentOf(here)).not.toBe(f.terrain.componentOf(f.terrain.nodeAt(12, 12)));
    let walks = 0;
    for (let i = 0; i < 1200; i++) {
      const target = stroll(f);
      if (target !== undefined) {
        expect(f.terrain.componentOf(target)).toBe(f.terrain.componentOf(here));
        walks++;
      }
      f.sim.world.remove(f.child, c.MoveGoal);
    }
    expect(walks).toBeGreaterThan(0);
  });

  it('skips a remembered failed stroll and admits it after memo expiry', () => {
    const f = setup(false);
    let before = f.sim.rng.getState();
    let target = stroll(f);
    for (let i = 0; i < 1200 && (target === undefined || target === f.terrain.nodeAt(6, 12)); i++) {
      f.sim.world.remove(f.child, c.MoveGoal);
      before = f.sim.rng.getState();
      target = stroll(f);
    }
    if (target === undefined) throw new Error('seed produced no stroll');
    f.sim.world.remove(f.child, c.MoveGoal);
    f.sim.world.add(f.child, c.UnreachableGoals, { entries: [{ cell: target, until: 100 }] });
    f.sim.rng.setState(before);
    expect(stroll(f)).toBeUndefined();
    f.sim.rng.setState(before);
    expect(stroll(f, 100)).toBe(target);
  });
});
