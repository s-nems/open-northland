import { lastByTypeId } from '@open-northland/data';
import { type Command, fx, ONE, systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { JOB_CIVILIST } from '../src/catalog/jobs.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import type { UnitOrderController } from '../src/view/unit-controls/orders.js';
import { createPickModeController } from '../src/view/unit-controls/pick-mode.js';
import { NO_TARGETS } from './support/pick-mode.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/** The action ring's "assign learning place" reaches both learning houses: a barracks drills at once, a
 *  school opens its course dialog, since the course is the player's choice. */

const PLAYER = 0;
const TRIBE = 1;
const PUPIL = 1;
const SCHOOL = 10;
const BARRACKS = 11;

const content = sandboxContent();
const schoolType = content.buildings.find((row) => systems.isSchoolType(row))?.typeId;
const barracksType = content.buildings.find((row) => systems.isBarracksType(row))?.typeId;

const house = (id: number, buildingType: number | undefined, x: number): Ent => ({
  id,
  components: {
    Building: { buildingType, tribe: TRIBE, built: ONE },
    Position: { x: fx.fromInt(x), y: fx.fromInt(2) },
    Owner: { player: PLAYER },
  },
});

const WORLD = snapshotOf([
  { id: PUPIL, components: { Settler: { tribe: TRIBE, jobType: JOB_CIVILIST }, Owner: { player: PLAYER } } },
  house(SCHOOL, schoolType, 2),
  house(BARRACKS, barracksType, 8),
]);

function harness(under: number): { press: () => void; issued: Command[]; schools: number[][] } {
  const issued: Command[] = [];
  const schools: number[][] = [];
  const orders = {
    openSchool: (houseId: number, units: readonly number[]) => {
      schools.push([houseId, ...units]);
      return true;
    },
  } as Partial<UnitOrderController> as UnitOrderController;
  const pickMode = createPickModeController({
    snapshot: () => WORLD,
    targets: { ...NO_TARGETS, owned: () => [{ ref: under, x: 0, y: 0 }] },
    content,
    mapSize: { width: 16, height: 16 },
    toWorld: () => ({ x: 0, y: 0 }),
    nodeAt: () => ({ col: 0, row: 0 }),
    enqueue: (command) => issued.push(command),
    orders: () => orders,
    setArmedCursor: () => undefined,
  });
  return {
    press: () => {
      pickMode.arm({ kind: 'learning-place', units: [PUPIL] });
      expect(pickMode.highlight()?.map((item) => item.id)).toEqual([BARRACKS, SCHOOL]);
      expect(pickMode.handleMouseDown({ clientX: 0, clientY: 0, button: 0 } as MouseEvent)).toBe('ordered');
    },
    issued,
    schools,
  };
}

it('the sandbox content carries both learning houses', () => {
  expect(schoolType).toBeDefined();
  expect(barracksType).toBeDefined();
  expect(lastByTypeId(content.buildings).get(schoolType ?? -1)?.schoolSize).toBeGreaterThan(0);
});

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
