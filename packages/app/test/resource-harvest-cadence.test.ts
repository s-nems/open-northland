import { halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { HARVEST_TICKS } from '../src/content/settler-gfx/index.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { sandboxContent } from '../src/game/sandbox/content/index.js';
import { GATHERERS, GOOD_MUD, GOOD_STONE, GOOD_WOOD } from '../src/game/sandbox/ids/index.js';
import { resourceCommand } from '../src/game/sandbox/place/index.js';

/** Ticks the search gives a yield before calling the gatherer stuck. */
const MAX_TICKS = 4000;

/** A novice collector's strokes per unit: its general track's count. */
const NOVICE_STROKES =
  sandboxContent().jobExperience.find((t) => t.jobType === JOB_COLLECTOR)?.baseRepeatCounter ?? 0;

/** The tick the first unit of `good` lands and the harvest clips the collector played to get there. */
function firstYield(good: number, atomic: number): { tick: number; clips: number } {
  const terrain = grassTerrain(8, 8);
  const sim = new Simulation({
    seed: 1,
    content: sandboxContent(terrain),
    map: halfCellMapFromCells(terrain),
  });
  const resource = resourceCommand(good, 8, 8);
  if (resource === null) throw new Error(`missing gatherer for good ${good}`);
  sim.enqueueSetup(resource);
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: JOB_COLLECTOR,
    x: 8,
    y: 8,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
  });

  let clips = 0;
  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    sim.step();
    const events = sim.events.current();
    for (const event of events) {
      if (event.kind === 'atomicCompleted' && event.atomicId === atomic) clips += 1;
    }
    for (const event of events) {
      if ((event.kind === 'resourceFelled' || event.kind === 'resourceMined') && event.goodType === good) {
        return { tick, clips };
      }
    }
  }
  throw new Error(`good ${good} produced no yield within ${MAX_TICKS} ticks`);
}

describe('resource harvest cadence at 1x', () => {
  // Original behavior: every counted stroke but the last is followed by the same clip landing nothing,
  // a short rest and a fresh stance, so a unit costs twice the track's clips less one, spread over the
  // rests and the walks between them.
  it.each([
    ['wood', GOOD_WOOD],
    ['stone', GOOD_STONE],
    ['clay', GOOD_MUD],
  ] as const)(
    "a novice's first %s yield lands after the track's strokes, each with its follow-through",
    (_name, good) => {
      const atomic = GATHERERS.find((g) => g.good === good)?.atomic ?? 0;
      const clipTicks = HARVEST_TICKS[atomic] ?? 0;
      expect(NOVICE_STROKES).toBeGreaterThan(1);
      const { tick, clips } = firstYield(good, atomic);
      expect(clips).toBe(2 * NOVICE_STROKES - 1);
      expect(tick).toBeGreaterThan(clips * clipTicks); // the rests and walks between strokes take their time
    },
  );
});
