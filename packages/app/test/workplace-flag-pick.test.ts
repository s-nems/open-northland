import { type Command, fx, ONE, systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/index.js';
import type { UnitOrderController } from '../src/view/unit-controls/orders.js';
import { createPickModeController } from '../src/view/unit-controls/pick-mode.js';
import { NO_TARGETS } from './support/pick-mode.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/** The settler panel's workplace pick for a flag trade: a lit building employs the gatherer, any other
 *  spot plants its flag there, and a gatherer holding a post leaves it for the flag. */

const PLAYER = 0;
const TRIBE = 1;
const GATHERER = 1;
const POSTED = 2;
const HUT = 10;
/** The posted gatherer's own hut, elsewhere on the map, so the lit hut keeps its open slot. */
const OTHER_HUT = 11;
/** An own building with no post for the trade, so it turns the gatherer down. */
const HOME = 12;
const SPOT = { col: 5, row: 6 };

const content = sandboxContent();
const gathererJob = content.jobs.find((job) => job.id === 'collector')?.typeId;
const hutType = content.buildings.find((row) =>
  row.workers.some((slot) => slot.jobType === gathererJob),
)?.typeId;
const homeType = content.buildings.find((row) => row.workers.length === 0)?.typeId;

const gatherer = (id: number, posted: boolean): Ent => ({
  id,
  components: {
    Settler: { tribe: TRIBE, jobType: gathererJob },
    Owner: { player: PLAYER },
    ...(posted ? { JobAssignment: { workplace: OTHER_HUT } } : {}),
  },
});

const WORLD = snapshotOf([
  gatherer(GATHERER, false),
  gatherer(POSTED, true),
  {
    id: HUT,
    components: {
      Building: { buildingType: hutType, tribe: TRIBE, built: ONE },
      Position: { x: fx.fromInt(2), y: fx.fromInt(2) },
      Owner: { player: PLAYER },
    },
  },
  {
    id: HOME,
    components: {
      Building: { buildingType: homeType, tribe: TRIBE, built: ONE },
      Position: { x: fx.fromInt(4), y: fx.fromInt(4) },
      Owner: { player: PLAYER },
    },
  },
]);

function harness(under: number | null): {
  pick: (units: readonly number[]) => string | null;
  issued: Command[];
  flags: { col: number; row: number; units: readonly number[] | undefined }[];
  flagActive: () => boolean;
} {
  const issued: Command[] = [];
  const flags: { col: number; row: number; units: readonly number[] | undefined }[] = [];
  const orders = {
    issueSetWorkFlag: (target: { col: number; row: number }, units?: readonly number[]) => {
      flags.push({ ...target, units });
      return true;
    },
  } as Partial<UnitOrderController> as UnitOrderController;
  const pickMode = createPickModeController({
    snapshot: () => WORLD,
    targets: { ...NO_TARGETS, owned: () => (under === null ? [] : [{ ref: under, x: 0, y: 0 }]) },
    content,
    mapSize: { width: 16, height: 16 },
    toWorld: () => ({ x: 0, y: 0 }),
    nodeAt: () => SPOT,
    enqueue: (command) => issued.push(command),
    orders: () => orders,
    vehicleOrders: () => {
      throw new Error('no vehicle order controller in this test');
    },
    setArmedCursor: () => undefined,
  });
  return {
    pick: (units) => {
      pickMode.arm({ kind: 'workplace-or-flag', units });
      expect(pickMode.flagActive()).toBe(true);
      return pickMode.handleMouseDown({ clientX: 0, clientY: 0, button: 0 } as MouseEvent);
    },
    issued,
    flags,
    flagActive: pickMode.flagActive,
  };
}

it('the sandbox content employs the gatherer somewhere and the sim calls it a flag trade', () => {
  expect(gathererJob).toBeDefined();
  expect(hutType).toBeDefined();
  expect(systems.jobUsesWorkFlag({ content }, gathererJob ?? -1)).toBe(true);
});

it('employs the gatherer at a lit building under the click', () => {
  const h = harness(HUT);
  expect(h.pick([GATHERER])).toBe('ordered');
  expect(h.issued).toMatchObject([
    { kind: 'assignWorkerGroup', building: HUT, members: [{ entity: GATHERER }] },
  ]);
  expect(h.flags).toEqual([]);
  expect(h.flagActive()).toBe(false);
});

it('refuses the press on an own building that turns the gatherer down, planting no flag', () => {
  const h = harness(HOME);
  expect(h.pick([POSTED])).not.toBe('ordered');
  expect(h.issued).toEqual([]);
  expect(h.flags).toEqual([]);
});

it('plants the flag where the click names no building', () => {
  const h = harness(null);
  expect(h.pick([GATHERER])).toBe('ordered');
  expect(h.issued).toEqual([]);
  expect(h.flags).toEqual([{ ...SPOT, units: [GATHERER] }]);
});

it('takes a posted gatherer off its post before planting its flag', () => {
  const h = harness(null);
  expect(h.pick([POSTED])).toBe('ordered');
  expect(h.issued).toEqual([{ kind: 'unassignWorker', entity: POSTED }]);
  expect(h.flags).toEqual([{ ...SPOT, units: [POSTED] }]);
});

it('lights the workplaces that employ the trade while armed', () => {
  const issued: Command[] = [];
  const pickMode = createPickModeController({
    snapshot: () => WORLD,
    targets: NO_TARGETS,
    content,
    mapSize: { width: 16, height: 16 },
    toWorld: () => ({ x: 0, y: 0 }),
    nodeAt: () => SPOT,
    enqueue: (command) => issued.push(command),
    orders: () => {
      throw new Error('no order controller in this test');
    },
    vehicleOrders: () => {
      throw new Error('no vehicle order controller in this test');
    },
    setArmedCursor: () => undefined,
  });
  pickMode.arm({ kind: 'workplace-or-flag', units: [GATHERER] });
  expect(pickMode.highlight()?.map((item) => item.id)).toEqual([HUT]);
  expect(issued).toEqual([]);
});
