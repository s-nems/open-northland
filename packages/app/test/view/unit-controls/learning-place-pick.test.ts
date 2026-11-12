import { type Command, fx, ONE, systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { JOB_CIVILIST, JOB_SOLDIER_UNARMED } from '../../../src/catalog/jobs.js';
import { sandboxContent } from '../../../src/game/sandbox/index.js';
import { createAnsweredOrders } from '../../../src/view/unit-controls/orders/answered.js';
import type { UnitOrderController } from '../../../src/view/unit-controls/orders/controller.js';
import { createPickModeController } from '../../../src/view/unit-controls/pick-mode.js';
import { NO_TARGETS } from '../../support/pick-mode.js';
import { type Ent, snapshotOf } from '../../support/snapshot.js';

/** The action ring's "assign learning place" reaches both learning houses, standing or still foundations:
 *  a barracks drills at once, a school opens its course dialog, since the course is the player's choice. */

const PLAYER = 0;
const TRIBE = 1;
const PUPIL = 1;
const SCHOOL = 10;
const BARRACKS = 11;

const content = sandboxContent();
const schoolType = content.buildings.find((row) => systems.isSchoolType(row))?.typeId;
const barracksType = content.buildings.find((row) => systems.isBarracksType(row))?.typeId;

const house = (id: number, buildingType: number | undefined, x: number, standing: boolean): Ent => ({
  id,
  components: {
    Building: { buildingType, tribe: TRIBE, built: standing ? ONE : fx.fromInt(0) },
    Position: { x: fx.fromInt(x), y: fx.fromInt(2) },
    Owner: { player: PLAYER },
    ...(standing ? {} : { UnderConstruction: { labor: fx.fromInt(0) } }),
  },
});

const worldOf = (standing: boolean, jobType = JOB_CIVILIST): ReturnType<typeof snapshotOf> =>
  snapshotOf([
    {
      id: PUPIL,
      components: { Settler: { tribe: TRIBE, jobType }, Owner: { player: PLAYER } },
    },
    house(SCHOOL, schoolType, 2, standing),
    house(BARRACKS, barracksType, 8, standing),
  ]);
const STANDING = worldOf(true);
const FOUNDATIONS = worldOf(false);

function harness(
  under: number,
  world = STANDING,
): {
  press: () => void;
  bare: () => void;
  shiftPress: () => ReturnType<ReturnType<typeof createPickModeController>['handleMouseDown']>;
  armed: () => boolean;
  issued: Command[];
  schools: number[][];
} {
  const issued: Command[] = [];
  const schools: number[][] = [];
  const orders = {
    openSchool: (houseId: number, units: readonly number[]) => {
      schools.push([houseId, ...units]);
      return true;
    },
  } as Partial<UnitOrderController> as UnitOrderController;
  const pickMode = createPickModeController({
    answered: createAnsweredOrders(),
    snapshot: () => world,
    targets: { ...NO_TARGETS, owned: () => [{ ref: under, x: 0, y: 0 }] },
    content,
    mapSize: { width: 16, height: 16 },
    toWorld: () => ({ x: 0, y: 0 }),
    nodeAt: () => ({ col: 0, row: 0 }),
    enqueue: (command) => issued.push(command),
    orders: () => orders,
    vehicleOrders: () => {
      throw new Error('no vehicle order controller in this test');
    },
    setArmedCursor: () => undefined,
  });
  return {
    press: () => {
      pickMode.arm({ kind: 'learning-place', units: [PUPIL] });
      expect(pickMode.highlight()?.map((item) => item.id)).toEqual([BARRACKS, SCHOOL]);
      expect(pickMode.handleMouseDown({ clientX: 0, clientY: 0, button: 0 } as MouseEvent)).toBe('ordered');
    },
    bare: () => {
      pickMode.arm({ kind: 'learning-place', units: [PUPIL] });
      pickMode.handleMouseDown({ clientX: 0, clientY: 0, button: 0 } as MouseEvent);
    },
    shiftPress: () => {
      pickMode.arm({ kind: 'learning-place', units: [PUPIL] });
      return pickMode.handleMouseDown({ clientX: 0, clientY: 0, button: 0, shiftKey: true } as MouseEvent);
    },
    armed: pickMode.isArmed,
    issued,
    schools,
  };
}

it('opens the course dialog for a school picked as the learning place', () => {
  const { press, issued, schools } = harness(SCHOOL);
  press();
  expect(schools).toEqual([[SCHOOL, PUPIL]]);
  expect(issued).toEqual([]);
});

it('still drills at a barracks picked as the learning place', () => {
  const { press, issued, schools } = harness(BARRACKS);
  press();
  expect(schools).toEqual([]);
  expect(issued).toEqual([{ kind: 'trainSoldier', entity: PUPIL, house: BARRACKS }]);
});

it('opens the course dialog for a school foundation, where the pupil waits for it to stand', () => {
  const { press, issued, schools } = harness(SCHOOL, FOUNDATIONS);
  press();
  expect(schools).toEqual([[SCHOOL, PUPIL]]);
  expect(issued).toEqual([]);
});

it('drills at a barracks foundation picked as the learning place', () => {
  const { press, issued } = harness(BARRACKS, FOUNDATIONS);
  press();
  expect(issued).toEqual([{ kind: 'trainSoldier', entity: PUPIL, house: BARRACKS }]);
});

it('a Shift press on a school opens the course dialog as a plain press does, and ends the pick', () => {
  const { shiftPress, armed, issued, schools } = harness(SCHOOL);
  expect(shiftPress()).toBe('ordered');
  expect(schools).toEqual([[SCHOOL, PUPIL]]);
  expect(issued).toEqual([]);
  expect(armed()).toBe(false);
});

it('a Shift press on a barracks queues the drill and keeps the pick armed', () => {
  const { shiftPress, armed, issued } = harness(BARRACKS);
  expect(shiftPress()).toBe('ordered');
  expect(issued).toEqual([{ kind: 'trainSoldier', entity: PUPIL, house: BARRACKS, queued: true }]);
  expect(armed()).toBe(true);
});

it('never enlists a soldier again: one who may not coin-drill gets no order, Shift or not', () => {
  const { bare, shiftPress, issued } = harness(BARRACKS, worldOf(true, JOB_SOLDIER_UNARMED));
  bare();
  shiftPress();
  expect(issued).toEqual([]);
});
