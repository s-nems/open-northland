import { type ConstructionSupply, ONE, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { FightAreas } from '../src/hud/tool-panel/messages/fight-areas.js';
import {
  createSnapshotMessageSource,
  SNAPSHOT_SWEEP_INTERVAL_TICKS,
  type SnapshotMessageSource,
} from '../src/hud/tool-panel/messages/from-snapshot.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import { NoteRetirement } from '../src/hud/tool-panel/messages/retire.js';
import {
  CONSTRUCTION_SHORTAGE_GRACE_TICKS,
  type SiteSeam,
} from '../src/hud/tool-panel/messages/site-shortages.js';
import type { MessageText } from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE, type UserMessage } from '../src/hud/tool-panel/messages/types.js';
import { WORK_STATUS_REASK_SWEEPS } from '../src/hud/tool-panel/messages/work-asks.js';

const LOCAL = 0;
const RIVAL = 1;
const BAKERY = 21;
const SITE = 10;
const BRICK = 7;
const WOOD = 5;
const SWEEPS_TO_GRACE = CONSTRUCTION_SHORTAGE_GRACE_TICKS / SNAPSHOT_SWEEP_INTERVAL_TICKS;

const shortOf = (goodType: number, held: boolean, inbound = 0): ConstructionSupply => ({
  kind: 'short',
  shortfalls: [{ goodType, required: 2, delivered: 1, inbound, held }],
});
const COVERED: ConstructionSupply = { kind: 'covered' };

const plain = (full: string): MessageText => ({ short: full, full });
const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null, female: false }),
  building: () => 'Piekarnia',
  vehicle: () => 'Wóz',
  player: () => 'Gracz',
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  text: (type, parts) => plain(`${parts.subjectName}:${type}:${parts.goodName}`),
};

interface World {
  readonly owner?: number;
  readonly finished?: boolean;
}

function world(tick: number, w: World = {}): WorldSnapshot {
  return {
    tick,
    events: [],
    entities: [
      {
        id: SITE,
        components: {
          Owner: { player: w.owner ?? LOCAL },
          Position: { x: 5 * ONE, y: 5 * ONE },
          Building: { buildingType: BAKERY, tribe: 1, built: 0, level: 0 },
          ...(w.finished === true ? {} : { UnderConstruction: { labor: 0 } }),
        },
      },
    ],
  };
}

/** A seam whose every ask lands at once with `answer`. */
function seamAnswering(answer: () => ConstructionSupply | undefined): SiteSeam {
  return { supply: (_site, asked) => ({ status: answer(), asked }) };
}

function sourceAnswering(answer: () => ConstructionSupply | undefined): SnapshotMessageSource {
  return createSnapshotMessageSource(LOCAL, undefined, seamAnswering(answer));
}

/** Sweep once per interval from sweep `from` up to and including sweep `count`; the shortage notes each
 *  sweep raised, as `[text, rewords]`. */
function sweepTo(
  source: SnapshotMessageSource,
  count: number,
  w: World = {},
  from = 0,
): [string, boolean][][] {
  const out: [string, boolean][][] = [];
  for (let i = from; i <= count; i++) {
    const raised = source.sweep(world(i * SNAPSHOT_SWEEP_INTERVAL_TICKS, w), naming);
    out.push(
      raised
        .filter((r) => r.pending.type === USER_MESSAGE_TYPE.constructionStarved)
        .map((r) => [r.compose().full, r.updatesStanding === true]),
    );
  }
  return out;
}

function shortageNote(goodType: number): UserMessage {
  return {
    id: 1,
    type: USER_MESSAGE_TYPE.constructionStarved,
    subject: { kind: 'building', entity: SITE },
    at: null,
    about: null,
    goodType,
    technologies: null,
    jobType: null,
    priority: 1,
    tick: 0,
    text: { short: 'x', full: 'x' },
  };
}

describe('building sites short of a material', () => {
  it('raises one note naming the good once nobody has held or brought it for the grace period', () => {
    const source = sourceAnswering(() => shortOf(BRICK, false));
    const sweeps = sweepTo(source, SWEEPS_TO_GRACE + 1);
    expect(sweeps.slice(0, SWEEPS_TO_GRACE).every((s) => s.length === 0)).toBe(true);
    expect(sweeps[SWEEPS_TO_GRACE]).toEqual([
      [`Piekarnia:${USER_MESSAGE_TYPE.constructionStarved}:good:${BRICK}`, true],
    ]);
  });

  it('raises nothing while a store holds the good or a load is on its way, for a covered site, or for a rival', () => {
    for (const answer of [shortOf(BRICK, true), shortOf(BRICK, false, 1), COVERED, undefined]) {
      const source = sourceAnswering(() => answer);
      expect(sweepTo(source, SWEEPS_TO_GRACE + 1).flat()).toEqual([]);
    }
    const rival = sourceAnswering(() => shortOf(BRICK, false));
    expect(sweepTo(rival, SWEEPS_TO_GRACE + 1, { owner: RIVAL }).flat()).toEqual([]);
  });

  it('starts the grace over once the good turns up before it ran out', () => {
    let held = false;
    const source = sourceAnswering(() => shortOf(BRICK, held));
    sweepTo(source, WORK_STATUS_REASK_SWEEPS - 1);
    held = true;
    sweepTo(source, WORK_STATUS_REASK_SWEEPS, {}, WORK_STATUS_REASK_SWEEPS);
    held = false;
    // The next ask, a re-ask period on, reads the shortage afresh; the grace counts from there.
    const raisedAt = 2 * WORK_STATUS_REASK_SWEEPS + SWEEPS_TO_GRACE;
    const sweeps = sweepTo(source, raisedAt, {}, WORK_STATUS_REASK_SWEEPS + 1);
    expect(sweeps.slice(0, -1).flat()).toEqual([]);
    expect(sweeps.at(-1)).toHaveLength(1);
  });

  it('keeps the note while the good trickles in, and retires it once the line is covered or the site stands', () => {
    let answer: ConstructionSupply = shortOf(BRICK, false);
    const source = sourceAnswering(() => answer);
    const retirement = new NoteRetirement(new FightAreas(), null, source.shortages);
    const note = shortageNote(BRICK);
    // A fresh source has not judged the site, and one within the grace has not either: a note restored
    // from an earlier mount stands.
    expect(retirement.isOver(note, world(0))).toBe(false);
    sweepTo(source, 1);
    expect(retirement.isOver(note, world(SNAPSHOT_SWEEP_INTERVAL_TICKS))).toBe(false);
    sweepTo(source, SWEEPS_TO_GRACE, {}, 2);
    const tick = SWEEPS_TO_GRACE * SNAPSHOT_SWEEP_INTERVAL_TICKS;
    expect(retirement.isOver(note, world(tick))).toBe(false);
    // A unit in a store, with the line still short, changes nothing.
    answer = shortOf(BRICK, true);
    sweepTo(source, SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS, {}, SWEEPS_TO_GRACE + 1);
    expect(retirement.isOver(note, world(tick))).toBe(false);
    expect(retirement.isOver(note, world(tick, { finished: true }))).toBe(true);
    answer = COVERED;
    sweepTo(
      source,
      SWEEPS_TO_GRACE + 2 * WORK_STATUS_REASK_SWEEPS,
      {},
      SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS + 1,
    );
    expect(retirement.isOver(note, world(tick))).toBe(true);
  });

  it('rewords the standing note with the next unheld good once the first line is covered', () => {
    let answer: ConstructionSupply = {
      kind: 'short',
      shortfalls: [
        { goodType: BRICK, required: 2, delivered: 1, inbound: 0, held: false },
        { goodType: WOOD, required: 1, delivered: 0, inbound: 0, held: false },
      ],
    };
    const source = sourceAnswering(() => answer);
    const retirement = new NoteRetirement(new FightAreas(), null, source.shortages);
    const first = sweepTo(source, SWEEPS_TO_GRACE).at(-1);
    expect(first?.[0]?.[0]).toContain(`good:${BRICK}`);
    answer = shortOf(WOOD, false);
    const next = sweepTo(source, SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS, {}, SWEEPS_TO_GRACE + 1).at(-1);
    expect(next).toEqual([[`Piekarnia:${USER_MESSAGE_TYPE.constructionStarved}:good:${WOOD}`, true]]);
    expect(retirement.isOver(shortageNote(BRICK), world(0))).toBe(false);
  });
});
