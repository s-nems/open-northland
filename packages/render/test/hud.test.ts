import { fx, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { IDLE_JOB } from '../src/data/hud/model.js';
import { buildHud, type HudModel, layoutHud, placeHud } from '../src/index.js';
import { snapshotOf } from './support/fixtures.js';

const VIKING = 0;
const SARACEN = 1;

/** A snapshot person entity owned by `player`; a null `jobType` is an idle adult. */
function settler(
  id: number,
  player: number,
  jobType: number | null,
  tribe = VIKING,
  female = false,
): WorldSnapshot['entities'][number] {
  return {
    id,
    components: {
      Settler: { tribe, jobType },
      Person: { person: true },
      Owner: { player },
      ...(female ? { Female: {} } : {}),
    },
  };
}

/** A snapshot creature: the same `Settler` model with no `Person` marker, as the sim clones wildlife.
 *  Owned, because a claimed animal must stay out of the count on the marker alone. */
function creature(id: number, player: number): WorldSnapshot['entities'][number] {
  return { id, components: { Settler: { tribe: VIKING, jobType: null }, Owner: { player } } };
}

function store(
  id: number,
  player: number,
  amounts: readonly [number, number][],
  tribe = VIKING,
): WorldSnapshot['entities'][number] {
  return {
    id,
    components: {
      Building: { tribe, buildingType: 0, built: 1 },
      Stockpile: { amounts },
      Owner: { player },
    },
  };
}

/** A standing signpost of `player` at visual tile `(x, y)`. */
function signpost(id: number, player: number, x: number, y: number): WorldSnapshot['entities'][number] {
  return {
    id,
    components: {
      Signpost: { links: [] },
      Position: { x: fx.fromInt(x), y: fx.fromInt(y) },
      Owner: { player },
    },
  };
}

/** A haulable ground pile at visual tile `(x, y)`: the sim's `GroundDrop` shape, which no seat owns. */
function groundPile(
  id: number,
  x: number,
  y: number,
  goodType: number,
  amount: number,
): WorldSnapshot['entities'][number] {
  return {
    id,
    components: {
      GroundDrop: { goodType },
      Stockpile: { amounts: [[goodType, amount]] },
      Position: { x: fx.fromInt(x), y: fx.fromInt(y) },
    },
  };
}

/** An unowned fixture: neutral scenery or wildlife, which belongs to no seat. */
function neutralStore(id: number, amounts: readonly [number, number][]): WorldSnapshot['entities'][number] {
  return {
    id,
    components: { Building: { tribe: VIKING, buildingType: 0, built: 1 }, Stockpile: { amounts } },
  };
}

describe('buildHud', () => {
  it('counts every settler of the player as population, regardless of job', () => {
    const hud = buildHud(
      snapshotOf([
        settler(1, 0, 5),
        settler(2, 0, null),
        settler(3, 0, 1), // a baby, whose job id is an age class
        settler(4, 1, 5), // other player
      ]),
      0,
    );
    expect(hud.population).toBe(3);
    expect(hud.player).toBe(0);
  });

  it('counts a multi-tribe seat whole, and never another seat sharing its tribe', () => {
    const hud = buildHud(
      snapshotOf([
        settler(1, 0, 5, SARACEN),
        settler(2, 0, 5, VIKING),
        settler(3, 1, 5, VIKING), // another seat, same tribe
        store(4, 0, [[2, 10]], SARACEN),
        store(5, 1, [[2, 99]], VIKING),
      ]),
      0,
    );
    expect(hud.population).toBe(2);
    expect(hud.stocks).toEqual([{ goodType: 2, amount: 10 }]);
  });

  it('counts people only, keyed on the marker rather than on ownership', () => {
    // A claimed animal is owned like a settler, so what keeps it out of the count is the `Person`
    // marker, as it is in the sim.
    const hud = buildHud(snapshotOf([settler(1, 0, 5), creature(2, 0), creature(3, 0)]), 0);
    expect(hud.population).toBe(1);
    expect(hud.jobs).toEqual([{ jobType: 5, count: 1, female: 0 }]);
  });

  it('leaves a neutral entity out: an unowned store belongs to no seat', () => {
    const hud = buildHud(snapshotOf([store(1, 0, [[2, 4]]), neutralStore(2, [[2, 99]])]), 0);
    expect(hud.stocks).toEqual([{ goodType: 2, amount: 4 }]);
  });

  it('breaks settlers down by jobType, idle adults under the IDLE_JOB sentinel, ascending', () => {
    const hud = buildHud(
      snapshotOf([settler(1, 0, 5), settler(2, 0, 5), settler(3, 0, null), settler(4, 0, 1)]),
      0,
    );
    expect(hud.jobs).toEqual([
      { jobType: IDLE_JOB, count: 1, female: 0 }, // -1 sorts first
      { jobType: 1, count: 1, female: 0 },
      { jobType: 5, count: 2, female: 0 },
    ]);
  });

  it('keys job 0 (the valid `none` id) on its own bucket, never folded into idle', () => {
    // The fold must be nullish (`??`), not `||`: a jobType of 0 is a real id.
    const hud = buildHud(snapshotOf([settler(1, 0, 0), settler(2, 0, null)]), 0);
    expect(hud.jobs).toEqual([
      { jobType: IDLE_JOB, count: 1, female: 0 },
      { jobType: 0, count: 1, female: 0 },
    ]);
  });

  it('tallies the Female marker inside each job bucket, for the player only', () => {
    const hud = buildHud(
      snapshotOf([
        settler(1, 0, 5, VIKING, true),
        settler(2, 0, 7, VIKING, true), // a woman in a trade
        settler(3, 0, 7),
        settler(4, 0, 1, VIKING, true), // a baby girl
        settler(5, 1, 5, VIKING, true), // another seat
      ]),
      0,
    );
    expect(hud.jobs).toEqual([
      { jobType: 1, count: 1, female: 1 },
      { jobType: 5, count: 1, female: 1 },
      { jobType: 7, count: 2, female: 1 },
    ]);
  });

  it('sums each good across the player stores, ascending by goodType, omitting zero totals', () => {
    const hud = buildHud(
      snapshotOf([
        store(1, 0, [
          [2, 10],
          [5, 3],
        ]),
        store(2, 0, [
          [2, 4],
          [9, 0], // a real but empty slot
        ]),
        store(3, 1, [[2, 99]]), // other player
      ]),
      0,
    );
    expect(hud.stocks).toEqual([
      { goodType: 2, amount: 14 }, // 10 + 4
      { goodType: 5, amount: 3 },
      // goodType 9 sums to 0
    ]);
  });

  it('adds a ground pile strictly inside the walk range of one of the player signposts', () => {
    const hud = buildHud(
      snapshotOf([
        store(1, 0, [[2, 10]]),
        signpost(2, 0, 10, 10),
        groundPile(3, 12, 11, 2, 4), // two tiles from the post
        groundPile(4, 12, 12, 7, 1),
        groundPile(5, 70, 70, 2, 99), // far beyond fifty nodes of any post
      ]),
      0,
    );
    expect(hud.stocks).toEqual([
      { goodType: 2, amount: 14 },
      { goodType: 7, amount: 1 },
    ]);
  });

  it('leaves ground piles out without a post of the player in reach, whoever else stands one there', () => {
    const entities = [store(1, 0, [[2, 10]]), groundPile(3, 12, 11, 2, 4)];
    expect(buildHud(snapshotOf(entities), 0).stocks).toEqual([{ goodType: 2, amount: 10 }]);
    expect(buildHud(snapshotOf([...entities, signpost(2, 1, 10, 10)]), 0).stocks).toEqual([
      { goodType: 2, amount: 10 },
    ]);
    // A loose pile (no GroundDrop marker) is not haulable and rests outside every count.
    const loose = {
      id: 6,
      components: { Stockpile: { amounts: [[2, 5]] }, Position: { x: fx.fromInt(11), y: fx.fromInt(11) } },
    };
    expect(buildHud(snapshotOf([...entities, signpost(2, 0, 10, 10), loose]), 0).stocks).toEqual([
      { goodType: 2, amount: 14 },
    ]);
  });

  it('carries the snapshot tick and is byte-identical for the same snapshot', () => {
    const snap = snapshotOf([settler(1, 0, 5), store(2, 0, [[2, 7]])], 42);
    const a = buildHud(snap, 0);
    const b = buildHud(snap, 0);
    expect(a.tick).toBe(42);
    expect(a).toEqual(b);
  });

  it('returns an empty-but-shaped model for a player with nothing', () => {
    const hud = buildHud(snapshotOf([settler(1, 1, 5)]), 0);
    expect(hud).toEqual({ tick: 1, player: 0, population: 0, jobs: [], stocks: [] });
  });
});

const HUD_PAD = 8; // mirrors the layout constants in hud.ts, kept local so a drift is caught
const HUD_LINE_H = 16;
const HUD_INDENT = 12;

function model(over: Partial<HudModel> = {}): HudModel {
  return { tick: 0, player: 0, population: 0, jobs: [], stocks: [], ...over };
}

const LABELS = {
  playerTick: (player: number, tick: number) => `Player ${player} · tick ${tick}`,
  population: (population: number) => `Population: ${population}`,
  jobs: 'Jobs',
  stocks: 'Stocks',
  idle: 'idle',
  job: (jobType: number) => `job ${jobType}`,
  good: (goodType: number) => `good ${goodType}`,
};

describe('layoutHud', () => {
  it('emits the header + section headings for an empty model, stacked by line height', () => {
    const layout = layoutHud(model({ tick: 7, player: 2, population: 0 }), LABELS);
    expect(layout.rows).toEqual([
      { x: HUD_PAD, y: HUD_PAD, text: 'Player 2 · tick 7' },
      { x: HUD_PAD, y: HUD_PAD + HUD_LINE_H, text: 'Population: 0' },
      { x: HUD_PAD, y: HUD_PAD + 2 * HUD_LINE_H, text: 'Jobs' },
      { x: HUD_PAD, y: HUD_PAD + 3 * HUD_LINE_H, text: 'Stocks' },
    ]);
  });

  it('indents each job/stock tally under its heading and labels the idle sentinel "idle"', () => {
    const layout = layoutHud(
      model({
        population: 3,
        jobs: [
          { jobType: IDLE_JOB, count: 1 },
          { jobType: 5, count: 2 },
        ],
        stocks: [{ goodType: 2, amount: 14 }],
      }),
      LABELS,
    );
    // The tally rows carry the indent; headings stay at the left margin.
    const tallyRows = layout.rows.filter((r) => r.x === HUD_PAD + HUD_INDENT);
    expect(tallyRows.map((r) => r.text)).toEqual(['idle: 1', 'job 5: 2', 'good 2: 14']);
    layout.rows.forEach((r, i) => {
      expect(r.y).toBe(HUD_PAD + i * HUD_LINE_H);
    });
  });

  it('sizes the panel height to the row count (padding + lines + bottom padding)', () => {
    const empty = layoutHud(model(), LABELS); // 4 rows: header, population, Jobs, Stocks
    expect(empty.height).toBe(HUD_PAD + 4 * HUD_LINE_H + HUD_PAD);
    const busy = layoutHud(model({ jobs: [{ jobType: 1, count: 1 }] }), LABELS); // +1 row
    expect(busy.height).toBe(empty.height + HUD_LINE_H);
    expect(busy.width).toBe(empty.width); // width is a fixed column, height grows with content
  });

  it('is byte-identical for the same model (deterministic - never reshuffles between equal frames)', () => {
    const m = model({ tick: 3, jobs: [{ jobType: 1, count: 2 }], stocks: [{ goodType: 9, amount: 5 }] });
    expect(layoutHud(m, LABELS)).toEqual(layoutHud(m, LABELS));
  });
});

const HUD_MARGIN = 8; // mirrors the placement margin in hud.ts, kept local so a drift is caught

describe('placeHud', () => {
  const layout = layoutHud(model({ tick: 1, player: 1, population: 2 }), LABELS);

  it('top-left: anchors the panel at the margin and offsets every row by the panel origin', () => {
    const placed = placeHud(layout, 'top-left', { width: 960, height: 540 });
    expect(placed.panelX).toBe(HUD_MARGIN);
    expect(placed.panelY).toBe(HUD_MARGIN);
    expect(placed.width).toBe(layout.width);
    expect(placed.height).toBe(layout.height);
    expect(placed.rows).toEqual(
      layout.rows.map((r) => ({ x: HUD_MARGIN + r.x, y: HUD_MARGIN + r.y, text: r.text })),
    );
  });

  it('top-right / bottom corners anchor the panel against the matching screen edge', () => {
    const screen = { width: 960, height: 540 };
    const tr = placeHud(layout, 'top-right', screen);
    expect(tr.panelX).toBe(960 - layout.width - HUD_MARGIN);
    expect(tr.panelY).toBe(HUD_MARGIN);
    const bl = placeHud(layout, 'bottom-left', screen);
    expect(bl.panelX).toBe(HUD_MARGIN);
    expect(bl.panelY).toBe(540 - layout.height - HUD_MARGIN);
    const br = placeHud(layout, 'bottom-right', screen);
    expect(br.panelX).toBe(960 - layout.width - HUD_MARGIN);
    expect(br.panelY).toBe(540 - layout.height - HUD_MARGIN);
  });

  it('clamps the panel on-screen when the canvas is smaller than the panel (keeps top-left visible)', () => {
    const placed = placeHud(layout, 'bottom-right', { width: 10, height: 10 });
    expect(placed.panelX).toBe(0);
    expect(placed.panelY).toBe(0);
  });

  it('is byte-identical for the same inputs (deterministic placement)', () => {
    const screen = { width: 800, height: 600 };
    expect(placeHud(layout, 'top-right', screen)).toEqual(placeHud(layout, 'top-right', screen));
  });
});
