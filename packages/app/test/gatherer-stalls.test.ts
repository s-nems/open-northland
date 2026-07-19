import { describe, expect, it } from 'vitest';
import { formatStallReport, type GathererSample, StallTracker } from '../soak/gatherer-stalls.js';

/** The soak's pure half (`soak/gatherer-stalls.ts`) — the fold from per-sample observations to
 *  stalls, unit-tested without running a world. The soak itself is local-only (`npm run
 *  soak:gatherers`); this keeps its detector honest under plain `npm test`. */

const STALL_TICKS = 100;

function sample(overrides: Partial<GathererSample> = {}): GathererSample {
  return {
    entity: 1,
    player: 2,
    jobType: 7,
    goodType: 3,
    flagged: true,
    productive: false,
    stranded: false,
    ...overrides,
  };
}

/** Feed one gatherer the given per-sample productivity, 25 ticks apart. */
function run(states: readonly Partial<GathererSample>[], stallTicks = STALL_TICKS): StallTracker {
  const tracker = new StallTracker(stallTicks);
  for (const [i, state] of states.entries()) tracker.observe((i + 1) * 25, [sample(state)]);
  return tracker;
}

describe('StallTracker', () => {
  it('ignores an unproductive gap shorter than the stall window', () => {
    const tracker = run([{}, {}, { productive: true }]);
    expect(tracker.finish()).toEqual([]);
  });

  it('reports a long unproductive run with its onset tick', () => {
    // Productive, then unproductive from tick 50 through 250 (200 ticks > the 100-tick window).
    const tracker = run([{ productive: true }, {}, {}, {}, {}, {}, {}, {}, {}, {}]);
    const [stall] = tracker.finish();
    expect(stall).toMatchObject({
      entity: 1,
      player: 2,
      goodType: 3,
      fromTick: 50,
      toTick: 250,
      shape: 'parkedAtFlag',
      openAtEnd: true,
    });
  });

  it('closes a stall when the gatherer starts collecting again', () => {
    const idle = Array.from({ length: 9 }, () => ({}));
    const tracker = run([...idle, { productive: true }, { productive: true }]);
    const [stall] = tracker.finish();
    expect(stall).toMatchObject({ fromTick: 25, toTick: 225, openAtEnd: false });
  });

  it('classes a mostly-stranded run as a route stall, not a parked one', () => {
    const tracker = run([{}, { stranded: true }, { stranded: true }, { stranded: true }, { stranded: true }]);
    expect(tracker.finish()[0]?.shape).toBe('stranded');
  });

  it('classes an unflagged roamer that never finds work as noTarget', () => {
    const tracker = run(Array.from({ length: 6 }, () => ({ flagged: false })));
    expect(tracker.finish()[0]?.shape).toBe('noTarget');
  });

  it('never stitches a stall across a settler that stopped being a gatherer', () => {
    const tracker = new StallTracker(STALL_TICKS);
    tracker.observe(25, [sample()]);
    tracker.observe(50, []); // dropped the trade (or died) — the run closes below the window
    tracker.observe(75, [sample()]);
    tracker.observe(300, [sample()]);
    const stalls = tracker.finish();
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatchObject({ fromTick: 75, toTick: 300 });
  });

  it('counts every settler it ever saw hold a gatherer trade', () => {
    const tracker = new StallTracker(STALL_TICKS);
    tracker.observe(25, [sample({ entity: 1 }), sample({ entity: 2, productive: true })]);
    tracker.observe(50, [sample({ entity: 3 })]);
    expect(tracker.gatherersSeen).toBe(3);
  });

  it('reports the longest stall first', () => {
    const tracker = new StallTracker(STALL_TICKS);
    for (let tick = 25; tick <= 500; tick += 25) {
      const long = sample({ entity: 1 });
      // Entity 2 only goes idle halfway through, so its run is the shorter one.
      const short = sample({ entity: 2, productive: tick <= 250 });
      tracker.observe(tick, [long, short]);
    }
    expect(tracker.finish().map((s) => s.entity)).toEqual([1, 2]);
  });
});

describe('formatStallReport', () => {
  const names = (id: number): string => `id_${id}`;

  it('renders a stall row with its good, trade and span', () => {
    const stalls = run([{}, {}, {}, {}, {}]).finish();
    const text = formatStallReport(
      { ticks: 500, sampleEveryTicks: 25, stallTicks: STALL_TICKS, gatherersSeen: 1, stalls },
      names,
      names,
    );
    expect(text).toContain('id_3'); // the good
    expect(text).toContain('id_7'); // the trade
    expect(text).toContain('never recovered');
  });

  it('says so plainly when nothing stalled', () => {
    const text = formatStallReport(
      { ticks: 500, sampleEveryTicks: 25, stallTicks: STALL_TICKS, gatherersSeen: 4, stalls: [] },
      names,
      names,
    );
    expect(text).toContain('(none)');
  });
});
