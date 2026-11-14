import { lastByTypeId } from '@open-northland/data';
import { components, ONE, systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { JOB_SOLDIER_UNARMED } from '../../../../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../../../src/game/rules.js';
import { BUILDING_BARRACKS, sandboxContent } from '../../../../src/game/sandbox/index.js';
import { coinDrillersAt } from '../../../../src/view/unit-controls/orders/coin-drill.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

/** Who a press on a barracks sends to coin-drill, as far as the snapshot shows it. */

const CONTENT = sandboxContent();
const BY_TYPE = lastByTypeId(CONTENT.buildings);
const BARRACKS = 100;
const OTHER_BARRACKS = 101;
const [NEAR, FAR, BARRED, DRILLING] = [1, 2, 3, 4];
const COIN = systems.drillCoinGood(CONTENT);

const soldier = (id: number, x: number, extra: Ent['components'] = {}): Ent => ({
  id,
  components: {
    Settler: { tribe: PRIMARY_TRIBE, jobType: JOB_SOLDIER_UNARMED },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: x * ONE, y: 4 * ONE },
    ...extra,
  },
});

const barracks = (id: number, coins: number, standing = true): Ent => ({
  id,
  components: {
    Stockpile: { amounts: COIN === undefined ? [] : [[COIN, coins]] },
    Building: { buildingType: BUILDING_BARRACKS, tribe: PRIMARY_TRIBE, built: standing ? ONE : 0, level: 0 },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: 4 * ONE, y: 4 * ONE },
    ...(standing ? {} : { UnderConstruction: { labor: 0 } }),
  },
});

const selection = [FAR, NEAR, BARRED, DRILLING];
const world = (coins: number, standing = true) =>
  snapshotOf([
    soldier(NEAR, 5),
    soldier(FAR, 12),
    soldier(BARRED, 4, {
      MissionBehaviour: { flags: components.MISSION_BEHAVIOUR.NO_JOB_EXPERIENCE },
    }),
    soldier(DRILLING, 4, { CoinDrillOrder: { house: BARRACKS, stage: 'drill', termTicksLeft: 0 } }),
    barracks(BARRACKS, coins, standing),
    barracks(OTHER_BARRACKS, coins),
  ]);

it('sends the nearest soldiers first while its coins last, never one barred from experience or drilling there', () => {
  expect(coinDrillersAt(CONTENT, world(selection.length), BARRACKS, selection, BY_TYPE)).toEqual([NEAR, FAR]);
  expect(coinDrillersAt(CONTENT, world(1), BARRACKS, selection, BY_TYPE)).toEqual([NEAR]);
});

it('may send a soldier drilling at one barracks to another', () => {
  expect(coinDrillersAt(CONTENT, world(selection.length), OTHER_BARRACKS, [DRILLING], BY_TYPE)).toEqual([
    DRILLING,
  ]);
});

it('sends nobody to a barracks foundation or one with no coin', () => {
  expect(coinDrillersAt(CONTENT, world(selection.length, false), BARRACKS, selection, BY_TYPE)).toEqual([]);
  expect(coinDrillersAt(CONTENT, world(0), BARRACKS, selection, BY_TYPE)).toEqual([]);
});
