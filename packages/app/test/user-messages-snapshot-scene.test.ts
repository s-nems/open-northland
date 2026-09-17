import { components, type Entity, ONE, systems, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  staffBuildingFully,
} from '../src/game/sandbox/index.js';
import { ownerPlayerOf, workplaceOf } from '../src/game/snapshot.js';
import {
  createSnapshotMessageSource,
  IDLE_SWEEPS_BEFORE_MESSAGE,
  SNAPSHOT_SWEEP_INTERVAL_TICKS,
  type SnapshotMessageSource,
} from '../src/hud/tool-panel/messages/from-snapshot.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import type { MessageText } from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE } from '../src/hud/tool-panel/messages/types.js';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import type { SceneWorld } from '../src/scenes/types.js';

const plain = (full: string): MessageText => ({ subject: null, short: full, full });
const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null }),
  training: (course, subjectName, jobName) => plain(`${course}:${subjectName}:${jobName}`),
  building: () => 'Dom',
  player: () => 'Gracz',
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  text: (type) => plain(String(type)),
};

/** A staffed warehouse with nothing on the ground to haul: its carriers have no work from the first tick. */
const IDLE_CREW: SceneWorld = {
  seed: 3,
  terrain: grassTerrain(24, 16),
  build: (sim) => {
    const store = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, 12, 6, HUMAN_PLAYER);
    staffBuildingFully(sim, store, HUMAN_PLAYER);
  },
};

function registeredScene(id: string): SceneWorld {
  const scene = SCENES.find((s) => s.id === id);
  if (scene === undefined) throw new Error(`${id} scene missing`);
  return scene;
}

function adultsOf(snapshot: WorldSnapshot): number[] {
  return snapshot.entities
    .filter((e) => e.components.Person !== undefined && e.components.Age === undefined)
    .filter((e) => ownerPlayerOf(e) === HUMAN_PLAYER)
    .map((e) => e.id);
}

/** Sweep the source once per interval for `sweeps` intervals; the sweep index of each entity's first
 *  nothing-to-do note. */
function firstIdleNotes(
  scene: SceneWorld,
  sweeps: number,
): { firstAt: Map<number, number>; last: WorldSnapshot } {
  const sim = createSceneSim(scene);
  sim.run(2); // drain the scene's spawn and placement commands
  const source: SnapshotMessageSource = createSnapshotMessageSource(HUMAN_PLAYER);
  const firstAt = new Map<number, number>();
  for (let i = 0; i < sweeps; i++) {
    sim.run(SNAPSHOT_SWEEP_INTERVAL_TICKS);
    for (const r of source.sweep(sim.snapshot(), naming)) {
      if (r.pending.type !== USER_MESSAGE_TYPE.nothingToDo) continue;
      const entity = r.pending.subject?.entity ?? -1;
      if (!firstAt.has(entity)) firstAt.set(entity, i);
    }
  }
  return { firstAt, last: sim.snapshot() };
}

/** The snapshot source against the sim's real serialization, so the component keys it reads stay honest. */
describe('user messages read off real scene snapshots', () => {
  it('reads the need bars of the sim snapshot', () => {
    const sim = createSceneSim(registeredScene('gossip'));
    sim.run(2);
    const [subject] = adultsOf(sim.snapshot());
    if (subject === undefined) throw new Error('no adult to test with');
    const s = sim.world.mut(subject as Entity, components.Settler);
    s.hunger = ONE;
    s.fatigue = systems.NEED_CRITICAL_THRESHOLD;
    sim.run(1);
    const raised = createSnapshotMessageSource(HUMAN_PLAYER)
      .sweep(sim.snapshot(), naming)
      .filter((r) => r.pending.subject?.entity === subject)
      .map((r) => r.pending.type);
    expect(raised).toEqual([USER_MESSAGE_TYPE.hungry, USER_MESSAGE_TYPE.starving, USER_MESSAGE_TYPE.tired]);
  });

  it('reports every carrier of a store with nothing to haul, once it has idled long enough', () => {
    const { firstAt, last } = firstIdleNotes(IDLE_CREW, 4 * IDLE_SWEEPS_BEFORE_MESSAGE);
    const carriers = adultsOf(last).filter((id) => {
      const e = last.entities.find((x) => x.id === id);
      return e !== undefined && workplaceOf(e) !== undefined;
    });
    expect(carriers.length).toBeGreaterThan(0);
    expect([...firstAt.keys()].sort((a, b) => a - b)).toEqual(carriers);
    for (const sweep of firstAt.values())
      expect(sweep).toBeGreaterThanOrEqual(IDLE_SWEEPS_BEFORE_MESSAGE - 1);
  });

  it('leaves the warehouse crew alone while it is hauling', () => {
    const { firstAt } = firstIdleNotes(registeredScene('warehouse'), 8 * IDLE_SWEEPS_BEFORE_MESSAGE);
    expect(firstAt.size).toBe(0);
  });
});
