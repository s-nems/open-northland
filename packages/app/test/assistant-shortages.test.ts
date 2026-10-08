import type { EntitySnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_HERO_UNARMED,
  JOB_SCOUT,
  JOB_SOLDIER,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import {
  GOOD_AMULET_STRENGTH,
  GOOD_MEAD,
  GOOD_POTION_HEAL_BIG,
  GOOD_POTION_HEAL_SMALL,
  GOOD_SHOES,
  GOOD_TOOL_IRON,
} from '../src/game/sandbox/ids/economy/goods.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';
import { assistantShortagesOf, NO_SHORTAGES } from '../src/view/assistant-shortages.js';
import { snapshotOf } from './support/sandbox.js';

/** How many of a seat's men each give switch would still dress, off the per-change gear tallies: the
 *  switch's pool (every grown man, the working trades for a tool) less the holders of any of its goods,
 *  and the soldiers among them. */

const RIVAL_PLAYER = 1;
type Slot = { goodType: number; degreeOfUse: number } | null;
type Gear = { boots: Slot; tool: Slot; weapon: Slot; armor: Slot; misc: Slot[] };
const NO_GEAR: Gear = { boots: null, tool: null, weapon: null, armor: null, misc: [null, null, null, null] };
const held = (goodType: number): Slot => ({ goodType, degreeOfUse: 0 });

function man(
  id: number,
  jobType: number | null,
  gear: Partial<Gear> = {},
  components: Readonly<Record<string, unknown>> = {},
  player = HUMAN_PLAYER,
): EntitySnapshot {
  return {
    id,
    components: {
      Settler: { tribe: PRIMARY_TRIBE, jobType },
      Person: { person: true },
      Owner: { player },
      Equipment: { ...NO_GEAR, ...gear },
      ...components,
    },
  };
}

const content = createSceneSim(sandboxScene).content;

describe('assistantShortagesOf', () => {
  it('counts the grown men of the seat without the switch goods, and the soldiers among them', () => {
    const snapshot = snapshotOf([
      man(1, JOB_COLLECTOR),
      man(2, JOB_COLLECTOR, { boots: held(GOOD_SHOES) }),
      man(3, JOB_SOLDIER),
      man(4, JOB_SOLDIER, { misc: [held(GOOD_AMULET_STRENGTH), null, null, null] }),
      man(5, JOB_COLLECTOR, {}, {}, RIVAL_PLAYER), // another seat's man
      man(6, JOB_WOMAN, {}, { Female: { female: true } }), // wears nothing
      man(7, JOB_COLLECTOR, {}, { Age: { ticks: 0, asOf: null } }), // a child
      man(8, JOB_HERO_UNARMED), // keeps the arms its job carries
      man(9, null), // jobless: the ladder never plans him
    ]);
    const shortages = assistantShortagesOf(snapshot, content, HUMAN_PLAYER);
    expect(shortages.giveBoots).toEqual({ lacking: 3, soldiersLacking: 2 });
    expect(shortages.giveStrengthAmulet).toEqual({ lacking: 3, soldiersLacking: 1 });
    expect(shortages.giveMead).toEqual({ lacking: 4, soldiersLacking: 2 });
  });

  it('pools a tool switch over the working trades alone, with no soldier figure', () => {
    const snapshot = snapshotOf([
      man(1, JOB_COLLECTOR),
      man(2, JOB_COLLECTOR, { tool: held(GOOD_TOOL_IRON) }),
      man(3, JOB_SOLDIER),
      man(4, JOB_SCOUT),
      man(5, JOB_CIVILIST),
    ]);
    const shortages = assistantShortagesOf(snapshot, content, HUMAN_PLAYER);
    // The iron-tooled collector's slot is taken, so he lacks the wooden tool no more than the iron one.
    expect(shortages.giveIronTools).toEqual({ lacking: 1, soldiersLacking: 0 });
    expect(shortages.giveWoodenTools).toEqual({ lacking: 1, soldiersLacking: 0 });
    expect(shortages.giveBoots.lacking).toBe(5);
  });

  it('counts nobody whose slot is taken: full misc rows, boots of another kind', () => {
    const FUR_BOOTS = GOOD_SHOES + 1; // any other boots good: the slot is taken whatever it holds
    const snapshot = snapshotOf([
      man(1, JOB_COLLECTOR, { boots: held(FUR_BOOTS) }),
      man(2, JOB_COLLECTOR, {
        misc: [held(GOOD_MEAD), held(GOOD_AMULET_STRENGTH), held(GOOD_MEAD), held(GOOD_MEAD)],
      }),
      man(3, JOB_COLLECTOR, { misc: [held(GOOD_MEAD), null, null, null] }),
    ]);
    const shortages = assistantShortagesOf(snapshot, content, HUMAN_PLAYER);
    expect(shortages.giveBoots.lacking).toBe(2);
    expect(shortages.giveHealingPotions.lacking).toBe(2); // the full row needs nothing more
    expect(shortages.giveMead.lacking).toBe(1);
    expect(shortages.giveStrengthAmulet.lacking).toBe(2);
  });

  it('treats either bottle size as having the potion', () => {
    const snapshot = snapshotOf([
      man(1, JOB_COLLECTOR, { misc: [held(GOOD_POTION_HEAL_SMALL), null, null, null] }),
      man(2, JOB_COLLECTOR, { misc: [held(GOOD_MEAD), held(GOOD_POTION_HEAL_BIG), null, null] }),
      man(3, JOB_COLLECTOR),
    ]);
    const shortages = assistantShortagesOf(snapshot, content, HUMAN_PLAYER);
    expect(shortages.giveHealingPotions.lacking).toBe(1);
    expect(shortages.giveMead.lacking).toBe(2);
  });

  it('reads nothing for no seat or a seat with no men', () => {
    const snapshot = snapshotOf([man(1, JOB_COLLECTOR)]);
    expect(assistantShortagesOf(snapshot, content, null)).toBe(NO_SHORTAGES);
    expect(assistantShortagesOf(snapshot, content, RIVAL_PLAYER)).toBe(NO_SHORTAGES);
  });
});
