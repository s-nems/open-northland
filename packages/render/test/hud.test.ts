import type { WorldSnapshot } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { type HudModel, IDLE_JOB, buildHud, layoutHud } from '../src/index.js';

/**
 * Unit tests for the pure HUD-model layer — the part of the HUD an agent can self-verify (the pixels
 * are deferred to a human). They pin the aggregation a human eyeball would otherwise have to total by
 * hand: population, the per-job head-count breakdown (incl. the idle sentinel), and per-good stock sums.
 *
 * A `WorldSnapshot` is plain data (no class instances; a `Stockpile` Map is already a sorted [k,v]
 * array), so we hand-build one here rather than spinning up a Simulation — this stays a render-package
 * unit, mirroring scene.test.ts.
 */

function snapshotOf(entities: WorldSnapshot['entities'], tick = 1): WorldSnapshot {
  return { tick, entities, events: [] };
}

/** A snapshot settler entity: tribe + jobType (null = idle adult). */
function settler(id: number, tribe: number, jobType: number | null): WorldSnapshot['entities'][number] {
  return { id, components: { Settler: { tribe, jobType } } };
}

/** A snapshot store entity: a Building (tribe) bearing a Stockpile (amounts as the cloned sorted array). */
function store(
  id: number,
  tribe: number,
  amounts: readonly [number, number][],
): WorldSnapshot['entities'][number] {
  return { id, components: { Building: { tribe, buildingType: 0, built: 1 }, Stockpile: { amounts } } };
}

describe('buildHud', () => {
  it('counts every settler of the tribe as population, regardless of job', () => {
    const hud = buildHud(
      snapshotOf([
        settler(1, 0, 5),
        settler(2, 0, null),
        settler(3, 0, 1), // a baby (age-class id)
        settler(4, 1, 5), // other tribe — excluded
      ]),
      0,
    );
    expect(hud.population).toBe(3);
    expect(hud.tribe).toBe(0);
  });

  it('breaks settlers down by jobType, idle adults under the IDLE_JOB sentinel, ascending', () => {
    const hud = buildHud(
      snapshotOf([
        settler(1, 0, 5),
        settler(2, 0, 5),
        settler(3, 0, null), // idle adult -> IDLE_JOB
        settler(4, 0, 1), // baby age class
      ]),
      0,
    );
    expect(hud.jobs).toEqual([
      { jobType: IDLE_JOB, count: 1 }, // -1 sorts first
      { jobType: 1, count: 1 },
      { jobType: 5, count: 2 },
    ]);
  });

  it('keys job 0 (the valid `none` id) on its own bucket, never folded into idle', () => {
    // The nullish (`??`) fold, not `||`: a jobType of 0 is a real id and must NOT bucket as idle.
    const hud = buildHud(snapshotOf([settler(1, 0, 0), settler(2, 0, null)]), 0);
    expect(hud.jobs).toEqual([
      { jobType: IDLE_JOB, count: 1 },
      { jobType: 0, count: 1 },
    ]);
  });

  it('sums each good across the tribe stores, ascending by goodType, omitting zero totals', () => {
    const hud = buildHud(
      snapshotOf([
        store(1, 0, [
          [2, 10],
          [5, 3],
        ]),
        store(2, 0, [
          [2, 4],
          [9, 0], // a real-but-empty slot — nets to zero, omitted
        ]),
        store(3, 1, [[2, 99]]), // other tribe — excluded
      ]),
      0,
    );
    expect(hud.stocks).toEqual([
      { goodType: 2, amount: 14 }, // 10 + 4
      { goodType: 5, amount: 3 },
      // goodType 9 omitted (sums to 0)
    ]);
  });

  it('carries the snapshot tick and is byte-identical for the same snapshot', () => {
    const snap = snapshotOf([settler(1, 0, 5), store(2, 0, [[2, 7]])], 42);
    const a = buildHud(snap, 0);
    const b = buildHud(snap, 0);
    expect(a.tick).toBe(42);
    expect(a).toEqual(b); // deterministic: same snapshot -> identical model
  });

  it('returns an empty-but-shaped model for a tribe with nothing', () => {
    const hud = buildHud(snapshotOf([settler(1, 1, 5)]), 0);
    expect(hud).toEqual({ tick: 1, tribe: 0, population: 0, jobs: [], stocks: [] });
  });
});

/**
 * Unit tests for the pure HUD *layout* layer — the bridge from the HUD data ({@link buildHud}) to its
 * pixels, exactly as {@link buildScene}'s positioned draw list is for the world scene. They pin the
 * load-bearing layout a human would otherwise eyeball: which line is emitted, in what order, and at
 * what panel-relative `(x, y)`. The typography (font/colour) is the human-judged half and not tested.
 */
const HUD_PAD = 8; // mirrors the layout constants in hud.ts (kept local so a drift is caught)
const HUD_LINE_H = 16;
const HUD_INDENT = 12;

/** A minimal HudModel for layout tests (the data half is covered by the buildHud suite above). */
function model(over: Partial<HudModel> = {}): HudModel {
  return { tick: 0, tribe: 0, population: 0, jobs: [], stocks: [], ...over };
}

describe('layoutHud', () => {
  it('emits the header + section headings for an empty model, stacked by line height', () => {
    const layout = layoutHud(model({ tick: 7, tribe: 2, population: 0 }));
    expect(layout.rows).toEqual([
      { x: HUD_PAD, y: HUD_PAD, text: 'Tribe 2 · tick 7' },
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
    );
    // The tally rows carry the indent; headings stay at the left margin.
    const tallyRows = layout.rows.filter((r) => r.x === HUD_PAD + HUD_INDENT);
    expect(tallyRows.map((r) => r.text)).toEqual(['idle: 1', 'job 5: 2', 'good 2: 14']);
    // Every row advances by exactly one line height, top to bottom, no gaps.
    layout.rows.forEach((r, i) => expect(r.y).toBe(HUD_PAD + i * HUD_LINE_H));
  });

  it('sizes the panel height to the row count (padding + lines + bottom padding)', () => {
    const empty = layoutHud(model()); // 4 rows: header, population, Jobs, Stocks
    expect(empty.height).toBe(HUD_PAD + 4 * HUD_LINE_H + HUD_PAD);
    const busy = layoutHud(model({ jobs: [{ jobType: 1, count: 1 }] })); // +1 row
    expect(busy.height).toBe(empty.height + HUD_LINE_H);
    expect(busy.width).toBe(empty.width); // width is a fixed column, height grows with content
  });

  it('is byte-identical for the same model (deterministic — never reshuffles between equal frames)', () => {
    const m = model({ tick: 3, jobs: [{ jobType: 1, count: 2 }], stocks: [{ goodType: 9, amount: 5 }] });
    expect(layoutHud(m)).toEqual(layoutHud(m));
  });
});
