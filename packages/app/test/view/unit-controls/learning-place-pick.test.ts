import type { TargetMark } from '@open-northland/render';
import { type Command, fx, ONE, systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { JOB_CIVILIST, JOB_SOLDIER_UNARMED } from '../../../src/catalog/jobs.js';
import { sandboxContent } from '../../../src/game/sandbox/index.js';
import { pickHint } from '../../../src/view/unit-controls/action-hint/pick-hint.js';
import type { PlanHint } from '../../../src/view/unit-controls/action-hint/plan-hint.js';
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
const COIN = systems.drillCoinGood(content);
/** Every house shelves one drill coin, so a soldier refused at the barracks is refused for himself. */
const COINS = 1;

const house = (id: number, buildingType: number | undefined, x: number, standing: boolean): Ent => ({
  id,
  components: {
    Building: { buildingType, tribe: TRIBE, built: standing ? ONE : fx.fromInt(0) },
    Stockpile: { amounts: COIN === undefined ? [] : [[COIN, COINS]] },
    Position: { x: fx.fromInt(x), y: fx.fromInt(2) },
    Owner: { player: PLAYER },
    ...(standing ? {} : { UnderConstruction: { labor: fx.fromInt(0) } }),
  },
});

const worldOf = (standing: boolean, jobType = JOB_CIVILIST, fightPoints = 0): ReturnType<typeof snapshotOf> =>
  snapshotOf([
    {
      id: PUPIL,
      components: {
        Settler: { tribe: TRIBE, jobType },
        Owner: { player: PLAYER },
        SettlerProgress: {
          experience: [[systems.FIGHT_EXPERIENCE_TYPE.PERSONAL, systems.fightUnitsOfPoints(fightPoints)]],
        },
      },
    },
    house(SCHOOL, schoolType, 2, standing),
    house(BARRACKS, barracksType, 8, standing),
  ]);
const STANDING = worldOf(true);
const FOUNDATIONS = worldOf(false);

function harness(
  under: number,
  world = STANDING,
  units: readonly number[] = [PUPIL],
): {
  press: () => void;
  bare: () => void;
  shiftPress: () => ReturnType<ReturnType<typeof createPickModeController>['handleMouseDown']>;
  armed: () => boolean;
  lit: () => readonly TargetMark[] | null;
  hint: () => PlanHint | null;
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
      pickMode.arm({ kind: 'learning-place', units });
      expect(pickMode.highlight()?.map((item) => item.id)).toEqual([BARRACKS, SCHOOL]);
      expect(pickMode.handleMouseDown({ clientX: 0, clientY: 0, button: 0 } as MouseEvent)).toBe('ordered');
    },
    bare: () => {
      pickMode.arm({ kind: 'learning-place', units });
      pickMode.handleMouseDown({ clientX: 0, clientY: 0, button: 0 } as MouseEvent);
    },
    shiftPress: () => {
      pickMode.arm({ kind: 'learning-place', units });
      return pickMode.handleMouseDown({ clientX: 0, clientY: 0, button: 0, shiftKey: true } as MouseEvent);
    },
    armed: pickMode.isArmed,
    lit: () => {
      pickMode.arm({ kind: 'learning-place', units });
      return pickMode.highlight();
    },
    hint: () => {
      pickMode.arm({ kind: 'learning-place', units });
      return pickHint(world, pickMode.aimAt(0, 0, 'none'));
    },
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

it('coin-drills a soldier at a standing barracks with a coin, lit and named as the coin drill', () => {
  const { bare, lit, hint, issued } = harness(BARRACKS, worldOf(true, JOB_SOLDIER_UNARMED));
  expect(lit()).toContainEqual({ id: BARRACKS, tone: 'candidate' });
  expect(hint()).toMatchObject({ tone: 'action', action: 'coinDrill' });
  bare();
  expect(issued).toEqual([{ kind: 'orderCoinDrill', entity: PUPIL, house: BARRACKS }]);
});

it('names the press by the larger part of a mixed selection: the coin drill once more soldiers drill than enlist', () => {
  const [firstSoldier, secondSoldier] = [PUPIL + 1, PUPIL + 2];
  const soldierAt = (id: number): Ent => ({
    id,
    components: { Settler: { tribe: TRIBE, jobType: JOB_SOLDIER_UNARMED }, Owner: { player: PLAYER } },
  });
  const world = (coins: number) =>
    snapshotOf([
      {
        id: PUPIL,
        components: { Settler: { tribe: TRIBE, jobType: JOB_CIVILIST }, Owner: { player: PLAYER } },
      },
      soldierAt(firstSoldier),
      soldierAt(secondSoldier),
      {
        ...house(BARRACKS, barracksType, 8, true),
        components: {
          ...house(BARRACKS, barracksType, 8, true).components,
          Stockpile: { amounts: COIN === undefined ? [] : [[COIN, coins]] },
        },
      },
    ]);
  const soldiers = [firstSoldier, secondSoldier];
  const selection = [PUPIL, ...soldiers];
  // Two coins pay for both soldiers, who outnumber the one recruit; one coin ties them, and the enlistment
  // goes first on a tie, as the right-click label words it.
  expect(harness(BARRACKS, world(soldiers.length), selection).hint()).toMatchObject({ action: 'coinDrill' });
  expect(harness(BARRACKS, world(COINS), selection).hint()).toMatchObject({ action: 'train' });
});

it('refuses a barracks foundation to a soldier, in the words of training', () => {
  const { lit, hint } = harness(BARRACKS, worldOf(false, JOB_SOLDIER_UNARMED));
  expect(lit()).toContainEqual({ id: BARRACKS, tone: 'refused' });
  expect(hint()).toEqual({ tone: 'refusal', refusal: 'cannotTrainHere' });
});

it('never enlists a soldier again: one who may not coin-drill gets no order, Shift or not', () => {
  const veteran = worldOf(true, JOB_SOLDIER_UNARMED, systems.COIN_DRILL_LIMIT);
  const { bare, shiftPress, lit, issued } = harness(BARRACKS, veteran);
  expect(lit()).toContainEqual({ id: BARRACKS, tone: 'refused' });
  bare();
  shiftPress();
  expect(issued).toEqual([]);
});
