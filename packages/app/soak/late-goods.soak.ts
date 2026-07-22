import { existsSync } from 'node:fs';
import { components, type Entity, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../test/content/helpers.js';
import { realMapPath, realMapWorld } from '../test/content/real-map-world.js';
import { intEnv } from './knobs.js';

const { Building, Carrying, Owner, Position, Resource, Settler, Stockpile, WorkFlag } = components;

/**
 * The late-collector-goods soak, `npm run soak:late-goods`. It runs the browser session
 * `?map=magiczny_las&ai=0,1,2,3,4,5` headless and watches the goods the build order unlocks late:
 * whether any seat's plan reaches the iron `collector` entry, hires the flag gatherer, drains the
 * iron deposits, and completes the smithy gated behind them. Gold and mushroom ride along as
 * report-only columns - no entry in the current opening plan consumes them. Real-content and local
 * only, like the sibling soaks (see vitest.config.ts). Knob: `ON_SOAK_TICKS`.
 */

const MAP_ID = 'magiczny_las';
const AI_SEATS = [0, 1, 2, 3, 4, 5];
/** The fastest seats reach the iron entry only around tick 18-20k (one construction site at a
 *  time), so the smithy needs the longer horizon. */
const DEFAULT_TICKS = 40_000;
/** Coarse enough that sampling stays a rounding error next to the tick cost. */
const SAMPLE_EVERY_TICKS = 1_000;
/** A 40k-tick run of this world has taken up to ~45 minutes on a contended machine. */
const SOAK_TIMEOUT_MS = 3 * 60 * 60_000;

/** Standing-resource columns: the three opening goods (control group) and the three late goods. */
const WATCHED_GOOD_IDS = ['mud', 'stone', 'wood', 'iron', 'gold', 'mushroom'] as const;
const SMITHY_ID_PREFIX = 'work_smithy';

describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))('late collector goods', () => {
  it('iron flows and a smithy completes', { timeout: SOAK_TIMEOUT_MS }, async () => {
    const ticks = intEnv('ON_SOAK_TICKS', DEFAULT_TICKS, 1);
    const { sim } = await realMapWorld({ mapId: MAP_ID, aiSeats: AI_SEATS, berryBushes: true });
    const goodType = new Map(sim.content.goods.map((g) => [g.id, g.typeId]));
    const goodName = new Map(sim.content.goods.map((g) => [g.typeId, g.id]));
    const buildingName = new Map(sim.content.buildings.map((b) => [b.typeId, b.id]));
    const watched = WATCHED_GOOD_IDS.map((id) => ({ id, typeId: goodType.get(id) ?? -1 }));
    const IRON = goodType.get('iron');
    if (IRON === undefined) throw new Error('content has no iron good - nothing to soak');

    const standingTotal = (typeId: number): number => {
      let total = 0;
      for (const e of sim.world.query(Resource)) {
        const r = sim.world.get(e, Resource);
        if (r.goodType === typeId && r.remaining > 0) total += r.remaining;
      }
      return total;
    };
    const isSmithy = (e: Entity): boolean =>
      (buildingName.get(sim.world.get(e, Building).buildingType) ?? '').startsWith(SMITHY_ID_PREFIX);

    // Per-seat milestones: first flagged iron collector, first smithy site, first completed smithy.
    const firstIronCollector = new Map<number, number>();
    const firstSmithySite = new Map<number, number>();
    const firstSmithyBuilt = new Map<number, number>();
    const samples: Array<{ tick: number; totals: ReadonlyMap<string, number> }> = [];

    const sample = (): void => {
      for (const e of sim.world.query(Settler, Owner, WorkFlag)) {
        if (sim.world.get(e, WorkFlag).goodType !== IRON) continue;
        const seat = sim.world.get(e, Owner).player;
        if (!firstIronCollector.has(seat)) firstIronCollector.set(seat, sim.tick);
      }
      for (const e of sim.world.query(Building, Owner)) {
        if (!isSmithy(e)) continue;
        const seat = sim.world.get(e, Owner).player;
        if (!firstSmithySite.has(seat)) firstSmithySite.set(seat, sim.tick);
        if (sim.world.get(e, Building).built >= ONE && !firstSmithyBuilt.has(seat)) {
          firstSmithyBuilt.set(seat, sim.tick);
        }
      }
      samples.push({
        tick: sim.tick,
        totals: new Map(watched.map((w) => [w.id, standingTotal(w.typeId)])),
      });
    };

    sample();
    for (let i = 0; i < ticks; i++) {
      sim.step();
      if (sim.tick % SAMPLE_EVERY_TICKS === 0) sample();
    }

    // Where the harvested iron ended up: building stores by seat, loose ground piles, carried loads.
    const ironBySeatStore = new Map<number, number>();
    let ironLoose = 0;
    let ironCarried = 0;
    for (const e of sim.world.query(Stockpile)) {
      const amount = sim.world.get(e, Stockpile).amounts.get(IRON) ?? 0;
      if (amount === 0) continue;
      if (sim.world.has(e, Building)) {
        const owner = sim.world.tryGet(e, Owner)?.player ?? -1;
        ironBySeatStore.set(owner, (ironBySeatStore.get(owner) ?? 0) + amount);
      } else if (sim.world.has(e, Position)) {
        ironLoose += amount;
      }
    }
    for (const e of sim.world.query(Settler, Carrying)) {
      const c = sim.world.get(e, Carrying);
      if (c.goodType === IRON) ironCarried += c.amount;
    }

    // Final per-seat state: collector flags, building inventory with construction sites marked.
    const seatLines: string[] = [];
    for (const seat of AI_SEATS) {
      const flags: string[] = [];
      for (const e of sim.world.query(Settler, Owner, WorkFlag)) {
        if (sim.world.get(e, Owner).player !== seat) continue;
        const flagGood = sim.world.get(e, WorkFlag).goodType;
        flags.push(flagGood === undefined ? '?' : (goodName.get(flagGood) ?? `good_${flagGood}`));
      }
      const counts = new Map<string, { done: number; site: number }>();
      for (const e of sim.world.query(Building, Owner)) {
        if (sim.world.get(e, Owner).player !== seat) continue;
        const id = buildingName.get(sim.world.get(e, Building).buildingType) ?? '?';
        const entry = counts.get(id) ?? { done: 0, site: 0 };
        if (sim.world.get(e, Building).built < ONE) entry.site++;
        else entry.done++;
        counts.set(id, entry);
      }
      const inventory = [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, c]) => `${id}${c.done > 1 ? `x${c.done}` : ''}${c.site > 0 ? `(+${c.site} site)` : ''}`)
        .join(' ');
      seatLines.push(
        `p${seat}: iron collector @${firstIronCollector.get(seat) ?? '-'} smithy site @${firstSmithySite.get(seat) ?? '-'} built @${firstSmithyBuilt.get(seat) ?? '-'} store iron=${ironBySeatStore.get(seat) ?? 0}\n    flags: [${flags.sort().join(', ')}]\n    ${inventory}`,
      );
    }
    const rows = samples.map(
      (s) =>
        `t=${String(s.tick).padStart(6)}  ${watched
          .map((w) => `${w.id}=${String(s.totals.get(w.id) ?? 0).padStart(5)}`)
          .join('  ')}`,
    );
    console.log(
      `\n=== standing resources ===\n${rows.join('\n')}\n\n=== seats at tick ${sim.tick} ===\n${seatLines.join('\n')}\n\niron loose on ground: ${ironLoose}, carried: ${ironCarried}\n`,
    );

    // The acceptance: the iron deposits drain and at least one seat finishes its smithy.
    const first = samples.at(0);
    const last = samples.at(-1);
    if (first === undefined || last === undefined) throw new Error('no samples recorded');
    expect(last.totals.get('iron'), 'iron standing total should fall').toBeLessThan(
      first.totals.get('iron') ?? 0,
    );
    expect(firstSmithyBuilt.size, 'at least one smithy should complete').toBeGreaterThan(0);
  });
});
