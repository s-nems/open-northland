import type { EntitySnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  JOB_BUILDER,
  JOB_CHILD_FEMALE,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_HERO_UNARMED,
  JOB_SCOUT,
  JOB_SOLDIER,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { BUILDING_JOINERY, GOOD_MEAD, GOOD_SHOES, GOOD_TOOL_WOODEN } from '../src/game/sandbox/ids/index.js';
import { type ResidentsProjectionContext, residentRows } from '../src/hud/tool-panel/residents/projection.js';
import type { ResidentRow } from '../src/hud/tool-panel/residents/rows.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';
import { buildingEntity, snapshotOf } from './support/sandbox.js';

const RIVAL_PLAYER = 1;
const NO_GEAR = { boots: null, tool: null, weapon: null, armor: null, misc: [null, null, null, null] };
const held = (goodType: number): { goodType: number; degreeOfUse: number } => ({ goodType, degreeOfUse: 0 });

function person(
  id: number,
  jobType: number | null,
  components: Readonly<Record<string, unknown>> = {},
  player = HUMAN_PLAYER,
): EntitySnapshot {
  return {
    id,
    components: {
      Settler: { tribe: PRIMARY_TRIBE, jobType },
      Person: { person: true },
      Owner: { player },
      Equipment: NO_GEAR,
      ...components,
    },
  };
}

/** The sandbox content, whose joinery employs the collector, plus the hero row its job table lacks. */
function context(): ResidentsProjectionContext {
  const content = createSceneSim(sandboxScene).content;
  return {
    localPlayer: HUMAN_PLAYER,
    content: {
      ...content,
      jobs: [
        ...content.jobs,
        { typeId: JOB_HERO_UNARMED, id: 'hero_unarmed', allowedAtomics: [], forbiddenAtomics: [] },
      ],
    },
    meadGood: GOOD_MEAD,
  };
}

function rowsById(entities: readonly EntitySnapshot[]): Map<number, ResidentRow> {
  return new Map(residentRows(snapshotOf(entities), context()).map((row) => [row.id, row]));
}

describe('residents projection', () => {
  it('lists the seat own people only: no building, creature or rival settler', () => {
    const rows = rowsById([
      buildingEntity(1, BUILDING_JOINERY),
      person(2, JOB_COLLECTOR),
      person(3, JOB_COLLECTOR, {}, RIVAL_PLAYER),
      { id: 4, components: { Settler: { tribe: 9, jobType: null }, Owner: { player: HUMAN_PLAYER } } },
    ]);
    expect([...rows.keys()]).toEqual([2]);
  });

  it('marks the unposted tradesman and leaves the posted, the jobless and the open-air trades alone', () => {
    const rows = rowsById([
      buildingEntity(1, BUILDING_JOINERY),
      person(2, JOB_COLLECTOR, { JobAssignment: { workplace: 1 } }),
      person(3, JOB_COLLECTOR),
      person(4, JOB_CIVILIST),
      person(5, null),
      person(6, JOB_BUILDER),
      person(7, JOB_SCOUT),
      person(8, JOB_COLLECTOR, { WorkFlag: { flag: 40 } }),
    ]);
    expect(rows.get(2)?.lacks).not.toContain('post');
    expect(rows.get(2)?.workplace).not.toBe('');
    expect(rows.get(3)?.lacks).toContain('post');
    expect(rows.get(3)?.workplace).toBe('');
    for (const id of [4, 5, 6, 7, 8]) expect(rows.get(id)?.lacks).not.toContain('post');
    expect(rows.get(4)?.kind).toBe('civilian');
    expect(rows.get(5)?.kind).toBe('civilian');
  });

  it('sorts people into the original groups', () => {
    const rows = rowsById([
      person(1, JOB_COLLECTOR),
      person(2, JOB_WOMAN, { Female: { female: true } }),
      person(3, JOB_CHILD_FEMALE, { Female: { female: true }, Age: { ticks: 0 } }),
      person(4, JOB_SOLDIER),
      person(5, JOB_HERO_UNARMED),
    ]);
    expect([1, 2, 3, 4, 5].map((id) => rows.get(id)?.kind)).toEqual([
      'worker',
      'woman',
      'child',
      'soldier',
      'hero',
    ]);
    expect(rows.get(3)?.ageYears).toBe(0);
    expect(rows.get(1)?.ageYears).toBeNull();
  });

  it('reads the lacks off the worn gear, the home and the family', () => {
    const geared = { ...NO_GEAR, boots: held(GOOD_SHOES), tool: held(GOOD_TOOL_WOODEN) };
    const rows = rowsById([
      buildingEntity(1, BUILDING_JOINERY),
      person(2, JOB_COLLECTOR, {
        Equipment: { ...geared, misc: [held(GOOD_MEAD), null, null, null] },
        Residence: { home: 1 },
        Marriage: { spouse: 3, child: null },
        JobAssignment: { workplace: 1 },
      }),
      person(3, JOB_WOMAN, { Female: { female: true }, Marriage: { spouse: 2, child: 4 } }),
      person(4, JOB_CHILD_FEMALE, { Female: { female: true }, Age: { ticks: 0 } }),
      person(5, JOB_WOMAN, { Female: { female: true } }),
      person(6, JOB_SOLDIER),
      person(7, JOB_HERO_UNARMED),
      person(8, JOB_SCOUT),
      person(9, null),
      person(10, JOB_COLLECTOR),
      person(11, JOB_WOMAN, { Female: { female: true }, Marriage: { spouse: 12, child: 12 } }),
      person(12, JOB_COLLECTOR, { Marriage: { spouse: 11, child: null } }),
      person(13, JOB_COLLECTOR, { Wedding: { partner: 5, kissing: false } }),
      person(14, JOB_COLLECTOR, { Marriage: { spouse: 99, child: null } }),
    ]);
    expect(rows.get(2)?.lacks).toEqual([]);
    expect(rows.get(3)?.lacks).toEqual(['home', 'shoes', 'mead']);
    expect(rows.get(4)?.lacks).toEqual([]); // a child is housed and dressed through its parents
    expect(rows.get(5)?.lacks).toEqual(['home', 'shoes', 'partner', 'children', 'mead']);
    expect(rows.get(6)?.lacks).toEqual(['shoes', 'weapon', 'mead']);
    expect(rows.get(7)?.lacks).toEqual(['mead']);
    expect(rows.get(8)?.lacks).not.toContain('tool');
    expect(rows.get(10)?.lacks).toContain('tool');
    expect(rows.get(11)?.lacks).toContain('children'); // her child grew up: the id lingers, the lack returns
    expect(rows.get(11)?.lacks).not.toContain('partner');
    expect(rows.get(13)?.lacks).not.toContain('partner'); // on the way to the wedding
    expect(rows.get(14)?.lacks).toContain('partner'); // widowed, no growing child
    expect(rows.get(9)?.lacks).not.toContain('mead'); // the assistant plans no jobless settler
  });

  it('asks nobody for mead in a content without it', () => {
    const rows = residentRows(snapshotOf([person(1, JOB_COLLECTOR)]), { ...context(), meadGood: undefined });
    expect(rows[0]?.lacks).not.toContain('mead');
  });
});
