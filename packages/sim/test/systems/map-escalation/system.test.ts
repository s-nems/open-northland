import { MapEscalation } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  mapEscalationProgress,
  markPlayerDead,
  Owner,
  Settler,
} from '../../../src/components/index.js';
import { TICKS_PER_SECOND } from '../../../src/core/loop.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../src/index.js';
import { hexDistanceBetween } from '../../../src/nav/halfcell.js';
import { removeSettlerSilently } from '../../../src/systems/lifecycle/death.js';
import {
  BOWMAN,
  distance,
  EMPTY_SEAT,
  END_AFTER_SECONDS,
  ESCALATION,
  FIRST_LAUNCH_SECONDS,
  FORTRESS,
  GUARD_BASE,
  IDLE_RAIDER,
  KEEP,
  keepWorld,
  MAP,
  ownedFighters,
  PLAYER,
  POST,
  RAIDER,
  REFILL_EVERY_SECONDS,
  runToSecond,
  SCRIPT,
  SPEARMAN,
  soldiersOf,
  TARGET,
  VIKING,
} from '../../fixtures/map-escalation/keep.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

function eventsUntil(sim: Simulation, seconds: number): string[] {
  const seen: string[] = [];
  while (sim.tick < seconds * TICKS_PER_SECOND) {
    sim.step();
    for (const ev of sim.events.current()) {
      if (ev.kind === 'mapEscalationAttackLaunched') seen.push(`launched ${ev.wave} ${ev.seats.join(',')}`);
      if (ev.kind === 'mapEscalationAttackEnded') seen.push(`ended ${ev.wave} ${ev.cause}`);
    }
  }
  return seen;
}

describe('map escalation - an attack', () => {
  it('spawns a band at the keep for each occupied seat’s raider, which marches it on the target', () => {
    const { sim, garrison } = keepWorld();
    expect(sim.mapEscalationView()).toMatchObject({
      wave: 0,
      attackRunning: false,
      nextAttackTick: FIRST_LAUNCH_SECONDS * TICKS_PER_SECOND,
    });

    expect(eventsUntil(sim, FIRST_LAUNCH_SECONDS)).toEqual([`launched 1 ${PLAYER}`]);
    const band = ownedFighters(sim, RAIDER);
    expect(band.map((e) => sim.world.get(e, Settler).jobType)).toEqual([SPEARMAN, SPEARMAN, BOWMAN]);
    for (const e of band) expect(distance(sim, e, KEEP)).toBeLessThan(6);
    // The empty seat's raider gets nobody.
    expect(ownedFighters(sim, IDLE_RAIDER)).toEqual([]);
    expect(sim.mapEscalationView()).toMatchObject({ wave: 1, attackRunning: true });

    runToSecond(sim, FIRST_LAUNCH_SECONDS + 60);
    const start = hexDistanceBetween(KEEP.x, KEEP.y, TARGET.x, TARGET.y);
    for (const e of band) expect(distance(sim, e, TARGET)).toBeLessThan(start / 2);
    // The garrison holds its post, and the spawned men are not on the fortress's list.
    for (const e of garrison) {
      expect(sim.world.get(e, Owner).player).toBe(FORTRESS);
      expect(distance(sim, e, POST)).toBeLessThanOrEqual(POST.range);
    }
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('names the attack notice on its launch, a launch’s own in place of the schedule’s', () => {
    const [first, second] = ESCALATION.attacks.launches;
    if (first === undefined || second === undefined) throw new Error('two launches');
    const { sim } = keepWorld({
      ...ESCALATION,
      attacks: {
        ...ESCALATION.attacks,
        noticeKey: 'forteca.attack',
        launches: [first, { ...second, noticeKey: 'forteca.reinforcements' }],
      },
    });
    const notices: (string | undefined)[] = [];
    while (sim.tick < (second.atSeconds + 1) * TICKS_PER_SECOND) {
      sim.step();
      for (const ev of sim.events.current())
        if (ev.kind === 'mapEscalationAttackLaunched') notices.push(ev.noticeKey);
    }
    expect(notices).toEqual(['forteca.attack', 'forteca.reinforcements']);
  });

  it('ends once its dead share reaches the configured part, the survivors fighting on, or when its time runs out', () => {
    const killed = keepWorld().sim;
    runToSecond(killed, FIRST_LAUNCH_SECONDS + 1);
    const [first, second, survivor] = ownedFighters(killed, RAIDER);
    if (first === undefined || second === undefined || survivor === undefined) throw new Error('no band');
    removeSettlerSilently(killed.world, first);
    expect(eventsUntil(killed, FIRST_LAUNCH_SECONDS + 3)).toEqual([]);
    removeSettlerSilently(killed.world, second);
    expect(eventsUntil(killed, FIRST_LAUNCH_SECONDS + 5)).toEqual(['ended 1 defeated']);
    expect(killed.mapEscalationView()?.attackRunning).toBe(false);
    expect(killed.world.isAlive(survivor)).toBe(true);

    const outlasted = keepWorld().sim;
    const events = eventsUntil(outlasted, FIRST_LAUNCH_SECONDS + END_AFTER_SECONDS + 2);
    expect(events).toEqual([`launched 1 ${PLAYER}`, 'ended 1 expired']);
    expect(outlasted.mapEscalationView()).toEqual({
      wave: 1,
      attackRunning: false,
      attackEndsByTick: null,
      nextAttackTick: 400 * TICKS_PER_SECOND,
      scheduleLive: true,
    });
  });

  it('lets a band whose seat has nothing left hold the attack no longer, its men fighting on', () => {
    const { sim } = keepWorld();
    runToSecond(sim, FIRST_LAUNCH_SECONDS + 1);
    const band = ownedFighters(sim, RAIDER);
    expect(band).toHaveLength(3);
    // The seat loses every building and person; the raider would walk its band home to the keep.
    for (const e of [...sim.world.query(Owner)])
      if (sim.world.get(e, Owner).player === PLAYER) sim.world.destroy(e);
    expect(eventsUntil(sim, FIRST_LAUNCH_SECONDS + 3)).toEqual(['ended 1 defeated']);
    for (const e of band) expect(sim.world.isAlive(e)).toBe(true);
  });

  it('keeps an attack on two seats running on the other band once one seat has nothing left', () => {
    const { sim } = keepWorld();
    // A person makes the second target seat occupied, so its raider gets a band too.
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: 0, x: 12, y: 12, tribe: VIKING, owner: EMPTY_SEAT });
    expect(eventsUntil(sim, FIRST_LAUNCH_SECONDS)).toEqual([`launched 1 ${PLAYER},${EMPTY_SEAT}`]);
    const band = ownedFighters(sim, RAIDER);
    const other = ownedFighters(sim, IDLE_RAIDER);
    expect(band).toHaveLength(3);
    expect(other).toHaveLength(3);
    for (const e of [...sim.world.query(Owner)])
      if (sim.world.get(e, Owner).player === EMPTY_SEAT) sim.world.destroy(e);
    // Half its men count lost, short of the end share: the first band holds the attack.
    expect(eventsUntil(sim, FIRST_LAUNCH_SECONDS + 3)).toEqual([]);
    expect(mapEscalationProgress(sim.world).attack?.men).toEqual(band);
    const [first] = band;
    if (first === undefined) throw new Error('no band');
    removeSettlerSilently(sim.world, first);
    expect(eventsUntil(sim, FIRST_LAUNCH_SECONDS + 5)).toEqual(['ended 1 defeated']);
    for (const e of other) expect(sim.world.isAlive(e)).toBe(true);
  });

  it('launches nothing while no finished keep stands, and reports the schedule dead', () => {
    const { sim } = keepWorld();
    expect(sim.mapEscalationView()?.scheduleLive).toBe(true);
    for (const e of [...sim.world.query(Building, Owner)]) {
      if (sim.world.get(e, Owner).player === FORTRESS) sim.world.destroy(e);
    }
    expect(eventsUntil(sim, FIRST_LAUNCH_SECONDS + 1)).toEqual([]);
    expect(ownedFighters(sim, RAIDER)).toEqual([]);
    expect(sim.mapEscalationView()).toMatchObject({ wave: 1, scheduleLive: false });
  });
});

describe('map escalation - the guard', () => {
  const guard = (sim: Simulation) => soldiersOf(sim, FORTRESS);

  it('refills toward a cap that grows with each step for each occupied seat, and no further', () => {
    const { sim } = keepWorld();
    // At the base cap nothing is added until the first step raises it by one occupied seat's share.
    runToSecond(sim, REFILL_EVERY_SECONDS * 5);
    expect(guard(sim)).toBe(GUARD_BASE);
    runToSecond(sim, 30 + REFILL_EVERY_SECONDS);
    expect(guard(sim)).toBe(GUARD_BASE + 1);
    runToSecond(sim, 90 + REFILL_EVERY_SECONDS);
    expect(guard(sim)).toBe(GUARD_BASE + 2);
  });

  it('refills nothing once the match counted the fortress seat out, its keep standing or not', () => {
    const { sim } = keepWorld(ESCALATION, undefined, { inMatch: true });
    markPlayerDead(sim.world, FORTRESS);
    // Past the first step, which raises the cap of a fortress still in the match.
    runToSecond(sim, 30 + REFILL_EVERY_SECONDS);
    expect(guard(sim)).toBe(GUARD_BASE);
  });
});

describe('map escalation - a save', () => {
  it('keeps the running attack and requires the same escalation to restore', () => {
    const { sim } = keepWorld();
    runToSecond(sim, FIRST_LAUNCH_SECONDS + 1);
    const save = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const inputs = { content: sim.content, map: grassNodeMap(MAP, MAP), mapAiScript: SCRIPT };
    const restored = restoreSimulation(save, { ...inputs, mapEscalation: MapEscalation.parse(ESCALATION) });
    expect(restored.hashState()).toBe(sim.hashState());
    expect(restored.mapEscalationView()).toEqual(sim.mapEscalationView());
    expect(() => restoreSimulation(save, inputs)).toThrow(/mapEscalationFingerprint/);
    // Past the next refill beats and end checks, the restored run stays the unrestored one.
    const AFTER_RESTORE_TICKS = 300;
    sim.run(AFTER_RESTORE_TICKS);
    restored.run(AFTER_RESTORE_TICKS);
    expect(restored.hashState()).toBe(sim.hashState());
  });
});
