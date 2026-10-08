import { type ConstructionSupply, ONE, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { SnapshotEntity } from '../src/game/snapshot.js';
import { createMessageFeed, takeRaised } from '../src/hud/tool-panel/messages/feed.js';
import { FightAreas } from '../src/hud/tool-panel/messages/fight-areas.js';
import {
  createSnapshotMessageSource,
  SNAPSHOT_SWEEP_INTERVAL_TICKS,
  type SnapshotMessageSource,
} from '../src/hud/tool-panel/messages/from-snapshot.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import { MessageRaiser } from '../src/hud/tool-panel/messages/raise.js';
import { NoteRetirement } from '../src/hud/tool-panel/messages/retire.js';
import {
  CONSTRUCTION_SHORTAGE_GRACE_TICKS,
  raiseShortage,
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
  building: (e) => (e.components.Palisade === undefined ? 'Piekarnia' : 'Palisada'),
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
  /** Wall segment ids beside the building site, all going up. */
  readonly wall?: readonly number[];
}

function siteEntity(id: number, w: World): SnapshotEntity {
  return {
    id,
    components: {
      Owner: { player: w.owner ?? LOCAL },
      Position: { x: 5 * ONE, y: 5 * ONE },
      Building: { buildingType: BAKERY, tribe: 1, built: 0, level: 0 },
      ...(w.finished === true ? {} : { UnderConstruction: { labor: 0 } }),
    },
  };
}

function wallSegment(id: number): SnapshotEntity {
  return {
    id,
    components: {
      Owner: { player: LOCAL },
      Position: { x: id * ONE, y: 5 * ONE },
      Palisade: {},
      UnderConstruction: { labor: 0 },
    },
  };
}

function world(tick: number, w: World = {}): WorldSnapshot {
  return {
    tick,
    events: [],
    entities: [siteEntity(SITE, w), ...(w.wall ?? []).map(wallSegment)],
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

  it('retires the note once the good is held or on its way, and once the site stands', () => {
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
    expect(retirement.isOver(note, world(tick, { finished: true }))).toBe(true);
    // A unit in a store ends the note at the next ask, with the line still short.
    answer = shortOf(BRICK, true);
    sweepTo(source, SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS, {}, SWEEPS_TO_GRACE + 1);
    expect(retirement.isOver(note, world(tick))).toBe(true);
  });

  it('retires the note once a load is on its way and raises it again only after another grace', () => {
    let answer: ConstructionSupply = shortOf(BRICK, false);
    const source = sourceAnswering(() => answer);
    const retirement = new NoteRetirement(new FightAreas(), null, source.shortages);
    const note = shortageNote(BRICK);
    sweepTo(source, SWEEPS_TO_GRACE + 1);
    expect(retirement.isOver(note, world(0))).toBe(false);
    answer = shortOf(BRICK, false, 1);
    const inboundRead = SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS;
    sweepTo(source, inboundRead, {}, SWEEPS_TO_GRACE + 2);
    expect(retirement.isOver(note, world(0))).toBe(true);
    // The load landed, the store is bare again: a new note comes a grace after the next ask reads that.
    answer = shortOf(BRICK, false);
    const dryRead = inboundRead + WORK_STATUS_REASK_SWEEPS;
    const sweeps = sweepTo(source, dryRead + SWEEPS_TO_GRACE, {}, inboundRead + 1);
    expect(sweeps.slice(0, -1).flat()).toEqual([]);
    expect(sweeps.at(-1)).toHaveLength(1);
  });

  it('rewords the standing note with the next unheld good once the first is held', () => {
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
    answer = {
      kind: 'short',
      shortfalls: [
        { goodType: BRICK, required: 2, delivered: 1, inbound: 0, held: true },
        { goodType: WOOD, required: 1, delivered: 0, inbound: 0, held: false },
      ],
    };
    const next = sweepTo(source, SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS, {}, SWEEPS_TO_GRACE + 1).at(-1);
    expect(next).toEqual([[`Piekarnia:${USER_MESSAGE_TYPE.constructionStarved}:good:${WOOD}`, true]]);
    expect(retirement.isOver(shortageNote(BRICK), world(0))).toBe(false);
  });

  it('rewords the standing card in the feed once the good changes', () => {
    const feed = createMessageFeed();
    const site = siteEntity(SITE, {});
    const raised = SNAPSHOT_SWEEP_INTERVAL_TICKS;
    const reworded = 2 * SNAPSHOT_SWEEP_INTERVAL_TICKS;
    const first = new MessageRaiser(world(raised), naming);
    raiseShortage(first, naming, site, BRICK);
    const [brick] = first.out;
    if (brick === undefined) throw new Error('no note raised');
    expect(takeRaised(feed, brick, raised)).toBe('accepted');
    const next = new MessageRaiser(world(reworded), naming);
    raiseShortage(next, naming, site, WOOD);
    const [wood] = next.out;
    if (wood === undefined) throw new Error('no note raised');
    expect(takeRaised(feed, wood, reworded)).toBe('duplicate');
    const [card] = feed.live();
    expect(card?.text.full).toBe(`Piekarnia:${USER_MESSAGE_TYPE.constructionStarved}:good:${WOOD}`);
    expect(card?.goodType).toBe(WOOD);
  });

  it('raises one note for the wall segments short of a good, voiced by one segment while it stands', () => {
    const wall = [31, 32, 33];
    const short = new Set(wall);
    const source = createSnapshotMessageSource(LOCAL, undefined, {
      supply: (site, asked) => ({ status: short.has(site) ? shortOf(WOOD, false) : COVERED, asked }),
    });
    const retirement = new NoteRetirement(new FightAreas(), null, source.shortages);
    const sweeps = sweepTo(source, SWEEPS_TO_GRACE, { wall });
    expect(sweeps.at(-1)).toEqual([[`Palisada:${USER_MESSAGE_TYPE.constructionStarved}:good:${WOOD}`, true]]);
    const voiceOf = (id: number) => ({
      ...shortageNote(WOOD),
      subject: { kind: 'building' as const, entity: id },
    });
    expect(retirement.isOver(voiceOf(31), world(0, { wall }))).toBe(false);
    expect(retirement.isOver(voiceOf(32), world(0, { wall }))).toBe(true);
    // The first segment gets its wood: the note moves to the next one, the standing voice retires.
    short.delete(31);
    const moved = SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS;
    sweepTo(source, moved, { wall }, SWEEPS_TO_GRACE + 1);
    expect(retirement.isOver(voiceOf(31), world(0, { wall }))).toBe(true);
    expect(retirement.isOver(voiceOf(32), world(0, { wall }))).toBe(false);
    // The run keeps its voice when a segment ahead of it in the index turns short again.
    short.add(31);
    const back = moved + SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS;
    const later = sweepTo(source, back, { wall }, moved + 1);
    expect(later.at(-1)).toHaveLength(1);
    expect(retirement.isOver(voiceOf(32), world(0, { wall }))).toBe(false);
    expect(retirement.isOver(voiceOf(31), world(0, { wall }))).toBe(true);
  });
});
