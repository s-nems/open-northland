import { describe, expect, it } from 'vitest';
import { Owner, Settler } from '../../../src/components/index.js';
import { fx, Simulation } from '../../../src/index.js';
import {
  AI_HANDLER_ROUND_TICKS,
  AI_NEED_REFILL_TURNS,
  NEED_CRITICAL_THRESHOLD,
  NEED_RESERVE_UNITS,
  needBar,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { settlerWithHunger } from './support.js';

const COMPUTER_SEAT = 2;
const HUMAN_SEAT = 0;
const IDLE_SEAT = 4;
/** A soldier job id (jobtypes.ini soldiers 31..41): the men the handler's refill reaches. */
const SOLDIER_JOB = 31;
const REFILL_TICKS = AI_NEED_REFILL_TURNS * AI_HANDLER_ROUND_TICKS;
/** The deficit of a bar one reserve unit past the critical mark, the level the original's refill answers. */
const PAST_CRITICAL = needBar(NEED_RESERVE_UNITS - 999);
/** The deficit of a bar that stays short of the critical mark through a minute of draining. */
const SHY_OF_CRITICAL = needBar(NEED_RESERVE_UNITS - 2000);

describe('needsSystem - the computer seat refill', () => {
  it('writes a full bar over a computer soldier’s critical hunger and fatigue on the seat’s minute turn', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0), { jobType: SOLDIER_JOB });
    sim.world.add(e, Owner, { player: COMPUTER_SEAT });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: COMPUTER_SEAT, enabled: true });
    sim.step();
    const s = sim.world.mut(e, Settler);
    s.hunger = PAST_CRITICAL;
    s.fatigue = PAST_CRITICAL;
    s.piety = PAST_CRITICAL;
    s.enjoyment = PAST_CRITICAL;
    // Seat 2's turn is tick 6 of the minute: nothing moves before it, and the refill lands on it.
    while (sim.tick + 1 !== 3 * COMPUTER_SEAT) {
      sim.step();
      expect(sim.world.get(e, Settler).hunger).toBeGreaterThan(NEED_CRITICAL_THRESHOLD);
    }
    sim.step();
    const after = sim.world.get(e, Settler);
    expect(after.hunger).toBeLessThan(needBar(10));
    expect(after.fatigue).toBeLessThan(needBar(10));
    expect(after.piety).toBeGreaterThan(NEED_CRITICAL_THRESHOLD);
    expect(after.enjoyment).toBeGreaterThan(NEED_CRITICAL_THRESHOLD);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('leaves a bar above the critical mark alone, and never touches a human seat’s soldier', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const computer = settlerWithHunger(sim, fx.fromInt(0), { jobType: SOLDIER_JOB });
    sim.world.add(computer, Owner, { player: COMPUTER_SEAT });
    const human = settlerWithHunger(sim, fx.fromInt(0), { jobType: SOLDIER_JOB });
    sim.world.add(human, Owner, { player: HUMAN_SEAT });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: COMPUTER_SEAT, enabled: true });
    sim.step();
    sim.world.mut(computer, Settler).hunger = SHY_OF_CRITICAL;
    sim.world.mut(human, Settler).hunger = PAST_CRITICAL;
    for (let i = 0; i <= REFILL_TICKS; i++) sim.step();
    expect(sim.world.get(computer, Settler).hunger).toBeGreaterThan(SHY_OF_CRITICAL);
    expect(sim.world.get(human, Settler).hunger).toBeGreaterThan(PAST_CRITICAL);
  });

  it('leaves a computer seat’s civilian to its own seeking', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const civilian = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.add(civilian, Owner, { player: COMPUTER_SEAT });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: COMPUTER_SEAT, enabled: true });
    sim.step();
    sim.world.mut(civilian, Settler).hunger = PAST_CRITICAL;
    for (let i = 0; i <= REFILL_TICKS; i++) sim.step();
    expect(sim.world.get(civilian, Settler).hunger).toBeGreaterThan(PAST_CRITICAL);
  });

  it('skips a computer seat whose scripted handler the map switched off', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0), { jobType: SOLDIER_JOB });
    sim.world.add(e, Owner, { player: IDLE_SEAT });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: IDLE_SEAT, enabled: true, scripted: false });
    sim.step();
    sim.world.mut(e, Settler).hunger = PAST_CRITICAL;
    for (let i = 0; i <= REFILL_TICKS; i++) sim.step();
    expect(sim.world.get(e, Settler).hunger).toBeGreaterThan(PAST_CRITICAL);
  });
});
