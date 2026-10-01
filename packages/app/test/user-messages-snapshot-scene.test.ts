import {
  cellAnchorNode,
  components,
  type Entity,
  ONE,
  type Simulation,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ANIMAL_TRIBE_HARES } from '../src/catalog/animal-tribes.js';
import { grassTerrain } from '../src/catalog/buildings.js';
import { JOB_CIVILIST, JOB_COLLECTOR, JOB_HUNTER } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import {
  BUILDING_FARM,
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnWorkersAtDoor,
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
import { PRODUCTION_STALL_GRACE_TICKS } from '../src/hud/tool-panel/messages/workshop-stalls.js';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import type { SceneWorld } from '../src/scenes/types.js';

const plain = (full: string): MessageText => ({ short: full, full });
const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null, female: false }),
  building: () => 'Dom',
  vehicle: () => 'Wóz',
  player: () => 'Gracz',
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  text: (type) => plain(String(type)),
};

/** Long enough for a lonely settler's chat, two talk rounds, and the work after it. */
const HUNTER_WATCH_SWEEPS = 150;
/** A farm's sow, water and reap rounds, with the lonely farmer's chat among them. */
const FARM_WATCH_SWEEPS = 300;

/** A staffed warehouse with nothing on the ground to haul: its carriers have no work from the first tick. */
const IDLE_CREW: SceneWorld = {
  seed: 3,
  terrain: grassTerrain(24, 16),
  build: (sim) => {
    const store = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, 12, 6, HUMAN_PLAYER);
    staffBuildingFully(sim, store, HUMAN_PLAYER);
  },
};

/** A collector posted at a store on grass with nothing to gather anywhere. */
const BARE_COLLECTOR: SceneWorld = {
  seed: 5,
  terrain: grassTerrain(24, 16),
  build: (sim) => {
    const store = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, 12, 6, HUMAN_PLAYER);
    const collector = spawnSettlerDirect(sim, JOB_COLLECTOR, 12, 10, HUMAN_PLAYER);
    sim.world.add(collector, components.JobAssignment, { workplace: store });
  },
};

/** Some 120 half-cell nodes east of the store, well past its hunters' 48-node ground. */
const FAR_HERD_CELL = { x: 80, y: 8 } as const;

/** A hunter posted at a store on grass, with the only game a herd far past its hunting ground. */
const FAR_GAME_HUNTER: SceneWorld = {
  seed: 7,
  terrain: grassTerrain(90, 16),
  build: (sim) => {
    const store = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, 12, 6, HUMAN_PLAYER);
    const hunter = spawnSettlerDirect(sim, JOB_HUNTER, 12, 10, HUMAN_PLAYER);
    sim.world.add(hunter, components.JobAssignment, { workplace: store });
    const herd = cellAnchorNode(FAR_HERD_CELL.x, FAR_HERD_CELL.y);
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: ANIMAL_TRIBE_HARES, x: herd.hx, y: herd.hy });
  },
};

/** A settler whose company bar sits on the seek line: it leaves its work for one exchange of chat, which
 *  outlasts the sweeps before the note. */
function makeLonely(sim: Simulation, e: Entity): void {
  sim.world.mut(e, components.SettlerNeeds).enjoyment = systems.NEED_DRIVE_THRESHOLD;
}

const CHAT_PARTNER_CELL = { x: 9, y: 9 } as const;
const ENABLER_CELL = { x: 2, y: 2 } as const;
const FARMERS = 2;

/** A lonely hunter of a store, an idle civilian to chat with, and hares in its hunting ground. */
const CHATTY_HUNTER: SceneWorld = {
  seed: 11,
  // A chat ends on the seeker's refilled bar, which only the needs rule refills.
  needs: true,
  terrain: grassTerrain(26, 20),
  build: (sim) => {
    const store = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, 12, 6, HUMAN_PLAYER);
    const hunter = spawnSettlerDirect(sim, JOB_HUNTER, 12, 10, HUMAN_PLAYER);
    sim.world.add(hunter, components.JobAssignment, { workplace: store });
    makeLonely(sim, hunter);
    spawnSettlerDirect(sim, JOB_CIVILIST, CHAT_PARTNER_CELL.x, CHAT_PARTNER_CELL.y, HUMAN_PLAYER);
    const herd = cellAnchorNode(18, 12);
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: ANIMAL_TRIBE_HARES, x: herd.hx, y: herd.hy });
  },
};

/** A farm on open grass with its two farmers, one of them lonely, and an idle civilian beside it to chat with. */
const CHATTY_FARM: SceneWorld = {
  seed: 13,
  needs: true,
  terrain: grassTerrain(26, 20),
  build: (sim) => {
    // The farm is `jobEnablesHouse`-gated on a collector, as in the chain scene.
    spawnSettlerDirect(sim, JOB_COLLECTOR, ENABLER_CELL.x, ENABLER_CELL.y, HUMAN_PLAYER);
    const farm = placeBuiltSandboxBuilding(sim, BUILDING_FARM, 12, 8, HUMAN_PLAYER);
    spawnWorkersAtDoor(sim, farm, FARMERS);
    const [farmer] = farmersOf(sim);
    if (farmer === undefined) throw new Error('the farm took no farmer');
    makeLonely(sim, farmer);
    spawnSettlerDirect(sim, JOB_CIVILIST, CHAT_PARTNER_CELL.x, CHAT_PARTNER_CELL.y, HUMAN_PLAYER);
  },
};

/** The farm's crew, read off its bindings. */
function farmersOf(sim: Simulation): Entity[] {
  return [...sim.world.query(components.JobAssignment)].filter(
    (e) =>
      sim.world.tryGet(sim.world.get(e, components.JobAssignment).workplace, components.Building)
        ?.buildingType === BUILDING_FARM,
  );
}

/** What the sweeps saw of `workers` over `sweeps` intervals: the company chats each held, the sweeps it
 *  spent on a clip that is not a chat's, and the nothing-to-do notes raised about any of them. */
function watchWorkers(
  scene: SceneWorld,
  pick: (sim: Simulation) => readonly Entity[],
  sweeps: number,
): { chatted: Set<number>; workedAfterChat: Set<number>; idleNotes: number[] } {
  const sim = createSceneSim(scene);
  sim.run(2);
  const workers = new Set<number>(pick(sim));
  const source = createSnapshotMessageSource(HUMAN_PLAYER);
  const chatted = new Set<number>();
  const workedAfterChat = new Set<number>();
  const idleNotes: number[] = [];
  for (let i = 0; i < sweeps; i++) {
    sim.run(SNAPSHOT_SWEEP_INTERVAL_TICKS);
    for (const id of workers) {
      const e = id as Entity;
      if ((sim.world.tryGet(e, components.Chat)?.kind ?? null) === 'company') chatted.add(id);
      else if (chatted.has(id) && sim.world.tryGet(e, components.CurrentAtomic)?.effect.kind !== undefined) {
        if (sim.world.get(e, components.CurrentAtomic).effect.kind !== 'idle') workedAfterChat.add(id);
      }
    }
    for (const r of source.sweep(sim.snapshot(), naming)) {
      const subject = r.pending.subject?.entity;
      if (r.pending.type === USER_MESSAGE_TYPE.nothingToDo && subject !== undefined && workers.has(subject)) {
        idleNotes.push(subject);
      }
    }
  }
  return { chatted, workedAfterChat, idleNotes };
}

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

/** The reasons the nothing-to-do notes give over two idle runs, with the sim answering every ask. */
function idleReasonsIn(scene: SceneWorld): string[] {
  const sim = createSceneSim(scene);
  sim.run(2);
  const source = createSnapshotMessageSource(HUMAN_PLAYER, {
    types: [],
    workStatus: (entity, asked) => ({ status: sim.workStatus(entity as Entity), asked }),
  });
  const reasons = new Set<string>();
  for (let i = 0; i < 2 * IDLE_SWEEPS_BEFORE_MESSAGE; i++) {
    sim.run(SNAPSHOT_SWEEP_INTERVAL_TICKS);
    for (const r of source.sweep(sim.snapshot(), naming)) {
      if (r.pending.type === USER_MESSAGE_TYPE.nothingToDo) reasons.add(r.pending.idle?.kind ?? 'none');
    }
  }
  return [...reasons];
}

/** The snapshot source against the sim's real serialization, so the component keys it reads stay honest. */
describe('user messages read off real scene snapshots', () => {
  it('reads the need bars of the sim snapshot', () => {
    const sim = createSceneSim(registeredScene('gossip'));
    sim.run(2);
    const [subject] = adultsOf(sim.snapshot());
    if (subject === undefined) throw new Error('no adult to test with');
    const s = sim.world.mut(subject as Entity, components.SettlerNeeds);
    s.hunger = ONE;
    s.fatigue = systems.NEED_CRITICAL_THRESHOLD;
    sim.run(1);
    const raised = createSnapshotMessageSource(HUMAN_PLAYER)
      .sweep(sim.snapshot(), naming)
      .filter((r) => r.pending.subject?.entity === subject)
      .map((r) => r.pending.type);
    expect(raised).toEqual([USER_MESSAGE_TYPE.starving, USER_MESSAGE_TYPE.tired]);
  });

  it('raises no card for the carriers of a store with nothing to haul, however long they idle', () => {
    const { firstAt, last } = firstIdleNotes(IDLE_CREW, 4 * IDLE_SWEEPS_BEFORE_MESSAGE);
    const carriers = adultsOf(last).filter((id) => {
      const e = last.entities.find((x) => x.id === id);
      return e !== undefined && workplaceOf(e) !== undefined;
    });
    expect(carriers.length).toBeGreaterThan(0);
    expect(firstAt.size).toBe(0);
  });

  it('leaves the warehouse crew alone while it is hauling', () => {
    const { firstAt } = firstIdleNotes(registeredScene('warehouse'), 8 * IDLE_SWEEPS_BEFORE_MESSAGE);
    expect(firstAt.size).toBe(0);
  });

  it('never reports a hunter idle while it chats for company and then goes hunting', () => {
    const hunters = (sim: Simulation): Entity[] =>
      [...sim.world.query(components.Settler)].filter(
        (e) => sim.world.get(e, components.Settler).jobType === JOB_HUNTER,
      );
    const seen = watchWorkers(CHATTY_HUNTER, hunters, HUNTER_WATCH_SWEEPS);
    expect(seen.chatted.size).toBe(1);
    expect(seen.workedAfterChat).toEqual(seen.chatted);
    expect(seen.idleNotes).toEqual([]);
  });

  it('never reports a farmer idle through its field cycle, its chats and its waits at the farm', () => {
    const seen = watchWorkers(CHATTY_FARM, farmersOf, FARM_WATCH_SWEEPS);
    expect(seen.chatted.size).toBeGreaterThan(0);
    expect(seen.workedAfterChat).toEqual(seen.chatted);
    expect(seen.idleNotes).toEqual([]);
  });

  it('names why a collector of a store on bare grass stands idle', () => {
    expect(idleReasonsIn(BARE_COLLECTOR)).toEqual(['noResourceInArea']);
  });

  it('names why a hunter of a store with no game in its ground stands idle', () => {
    expect(idleReasonsIn(FAR_GAME_HUNTER)).toEqual(['noGame']);
  });

  it('names why a store carrier has nothing to haul on its panel only', () => {
    expect(idleReasonsIn(IDLE_CREW)).toEqual([]);
    const sim = createSceneSim(IDLE_CREW);
    sim.run(IDLE_SWEEPS_BEFORE_MESSAGE * SNAPSHOT_SWEEP_INTERVAL_TICKS);
    const carrier = adultsOf(sim.snapshot())[0];
    if (carrier === undefined) throw new Error('no carrier');
    expect(sim.workStatus(carrier as Entity)).toEqual({ kind: 'nothingToCarry' });
  });

  it('reports both store-reach bakeries stalled, naming why, once the grace has passed', () => {
    const sim = createSceneSim(registeredScene('store-reach'));
    sim.run(2);
    const source = createSnapshotMessageSource(HUMAN_PLAYER, {
      types: sim.content.buildings.filter((b) => b.recipes.length > 0).map((b) => b.typeId),
      workStatus: (entity, asked) => ({ status: sim.workStatus(entity as Entity), asked }),
    });
    const reasons = new Map<number, string>();
    const sweeps = PRODUCTION_STALL_GRACE_TICKS / SNAPSHOT_SWEEP_INTERVAL_TICKS + 2;
    for (let i = 0; i < sweeps; i++) {
      sim.run(SNAPSHOT_SWEEP_INTERVAL_TICKS);
      for (const r of source.sweep(sim.snapshot(), naming)) {
        expect(r.pending.type).not.toBe(USER_MESSAGE_TYPE.nothingToDo);
        if (r.pending.type !== USER_MESSAGE_TYPE.productionStalled) continue;
        reasons.set(r.pending.subject?.entity ?? -1, r.pending.stall?.reason ?? '');
      }
    }
    expect([...reasons.values()].sort()).toEqual(['inputOutOfReach', 'outputOutOfReach']);
  });
});
