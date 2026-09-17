import { MAP_AI_CONDITION_SLOTS } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AiExternalFlags,
  aiExternalFlagRaised,
  diplomacyLocked,
  diplomacyStance,
  FOG_MODE,
  isPlayerDead,
  missionRecords,
  PlayerAttacks,
  ScriptVerdicts,
  wasAttackedBy,
} from '../../src/components/index.js';
import { playerCommand, type Simulation } from '../../src/index.js';
import { isAuthorized } from '../../src/systems/command/authority.js';
import { MATCH_DEATH_CHECK_INTERVAL_TICKS, MATCH_DEATH_GRACE_TICKS } from '../../src/systems/match/index.js';
import { type MissionGoalOp, type MissionResultOp, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { resolveCombatHit } from '../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import { ctxOf } from '../fixtures/context.js';
import {
  eventsUntil,
  FIRST_PASS,
  failedResultsUntil,
  firingSim,
  goalSim,
  holds,
  missionSim,
  POINT,
  roundTrip,
  SOLDIER,
  spawn,
  stamped,
  WILD,
  WOLF,
} from './support.js';

/**
 * The results and goals about a player's standing: its stance toward another player and the lock on
 * it, the verdict a script hands down, who has struck whom, and the AI condition flags. Everything a
 * script writes here is a table beside the world, so the tests read the tables and the events.
 */

const OWNER = 0;
const RIVAL = 1;
const STRIKER = 2;
const ATTACKER_ID = 1;
const VICTIM_ID = 2;
const HERD_ID = 3;
const SLOT = 5;
const OTHER_SLOT = 2;
/** Strikes the attacked flag whatever the target's armour; the tests never care about the pool. */
const A_BLOW = 1;
const NO_BLOW = 0;
const NEXT_TO_POINT = { hx: POINT.hx + 1, hy: POINT.hy };
/** Beyond a civilian's eye, so two units there never meet. */
const FAR_EAST = { hx: POINT.hx + 24, hy: POINT.hy };
/** The first tick the skirmish death check can fire on. */
/** The fixture's woodcutter id doubles as the original's baby stage, which the death check skips, so
 *  the man who keeps a seat alive is a soldier. */
const FIRST_DEATH_CHECK =
  Math.ceil(MATCH_DEATH_GRACE_TICKS / MATCH_DEATH_CHECK_INTERVAL_TICKS) * MATCH_DEATH_CHECK_INTERVAL_TICKS;
/** The pass after the first: a mission that re-activates itself fires again here. */
const SECOND_PASS = 2 * FIRST_PASS;
const VERDICT_EVENTS = ['playerWon', 'playerDefeated'] as const;

function stance(player: number, otherPlayer: number, state: 'friend' | 'neutral' | 'enemy'): MissionResultOp {
  return { opcode: 'SetDiplomacy', player, otherPlayer, state };
}

function lock(player: number, otherPlayer: number, flag: boolean): MissionResultOp {
  return { opcode: 'SetDiplomacyNotChangeableFlag', player, otherPlayer, flag };
}

describe('SetDiplomacy', () => {
  it('sets the one direction the line names', () => {
    const sim = firingSim([stance(OWNER, RIVAL, 'friend')]);
    sim.run(FIRST_PASS);
    expect(diplomacyStance(sim.world, OWNER, RIVAL)).toBe('friend');
    expect(diplomacyStance(sim.world, RIVAL, OWNER)).toBe('enemy');
  });

  it('writes through a lock on the pair', () => {
    const sim = firingSim([lock(OWNER, RIVAL, true), stance(OWNER, RIVAL, 'neutral')]);
    sim.run(FIRST_PASS);
    expect(diplomacyStance(sim.world, OWNER, RIVAL)).toBe('neutral');
  });

  it('reports a line whose state token resolved to nothing', () => {
    const sim = firingSim([{ opcode: 'SetDiplomacy', player: OWNER, otherPlayer: RIVAL, state: undefined }]);
    expect(failedResultsUntil(sim, FIRST_PASS)).toEqual(['SetDiplomacy']);
    expect(diplomacyStance(sim.world, OWNER, RIVAL)).toBe('enemy');
  });
});

describe('SetDiplomacyNotChangeableFlag', () => {
  it('locks both directions and unlocks them again', () => {
    const sim = firingSim([lock(OWNER, RIVAL, true)]);
    sim.run(FIRST_PASS);
    expect(diplomacyLocked(sim.world, OWNER, RIVAL)).toBe(true);
    expect(diplomacyLocked(sim.world, RIVAL, OWNER)).toBe(true);
    expect(diplomacyLocked(sim.world, OWNER, STRIKER)).toBe(false);
    const cleared = firingSim([lock(OWNER, RIVAL, true), lock(RIVAL, OWNER, false)]);
    cleared.run(FIRST_PASS);
    expect(diplomacyLocked(cleared.world, OWNER, RIVAL)).toBe(false);
  });

  it('carries the lock through the save round trip', () => {
    const sim = firingSim([lock(OWNER, RIVAL, true)]);
    sim.run(FIRST_PASS);
    expect(diplomacyLocked(roundTrip(sim).world, RIVAL, OWNER)).toBe(true);
  });
});

describe('DiplomacyState', () => {
  const goal = (player: number, otherPlayer: number): MissionGoalOp => ({
    opcode: 'DiplomacyState',
    player,
    otherPlayer,
    state: 'friend',
  });

  it('holds for the direction that carries the stance and not for the reverse', () => {
    const forward = goalSim(goal(OWNER, RIVAL));
    forward.enqueueSetup({ kind: 'setDiplomacy', from: OWNER, to: RIVAL, state: 'friend' });
    forward.run(FIRST_PASS);
    expect(holds(forward)).toBe(true);

    const reverse = goalSim(goal(RIVAL, OWNER));
    reverse.enqueueSetup({ kind: 'setDiplomacy', from: OWNER, to: RIVAL, state: 'friend' });
    reverse.run(FIRST_PASS);
    expect(holds(reverse)).toBe(false);
  });

  it('holds nowhere for a state token that resolved to nothing', () => {
    const sim = goalSim({ opcode: 'DiplomacyState', player: OWNER, otherPlayer: RIVAL, state: undefined });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
  });
});

describe('MissionWon and MissionFailed', () => {
  it('records the verdict for the named player and announces it the tick it fires', () => {
    const sim = firingSim([{ opcode: 'MissionWon', player: OWNER }]);
    expect(eventsUntil(sim, FIRST_PASS, VERDICT_EVENTS)).toEqual([
      { tick: FIRST_PASS, event: { kind: 'playerWon', player: OWNER } },
    ]);
    expect(sim.matchOutcome(OWNER)).toBe('victory');
    expect(sim.matchOutcome(RIVAL)).toBe('undecided');
  });

  it('announces a repeat fire again but records the verdict once', () => {
    const sim = firingSim([
      { opcode: 'MissionWon', player: OWNER },
      { opcode: 'ActivateMission', missionIndex: 0 },
    ]);
    sim.run(FIRST_PASS);
    const recorded = sim.world.componentValueGeneration(ScriptVerdicts);
    expect(eventsUntil(sim, SECOND_PASS, VERDICT_EVENTS)).toEqual([
      { tick: SECOND_PASS, event: { kind: 'playerWon', player: OWNER } },
    ]);
    expect(sim.world.componentValueGeneration(ScriptVerdicts)).toBe(recorded);
  });

  it('a failed player is beaten but keeps commanding, and has not died', () => {
    const sim = firingSim([{ opcode: 'MissionFailed', player: OWNER }]);
    spawn(sim, { player: OWNER, missionId: ATTACKER_ID });
    expect(eventsUntil(sim, FIRST_PASS, VERDICT_EVENTS)).toEqual([
      { tick: FIRST_PASS, event: { kind: 'playerDefeated', player: OWNER } },
    ]);
    expect(sim.matchOutcome(OWNER)).toBe('defeat');
    expect(isPlayerDead(sim.world, OWNER)).toBe(false);
    const order = playerCommand(OWNER, {
      kind: 'setStance',
      entity: stamped(sim, ATTACKER_ID),
      mode: MILITARY_MODE.NONE,
    });
    expect(isAuthorized(sim.world, order)).toBe(true);
  });

  it('leaves the skirmish rule running, so a seat still dies after a scripted win', () => {
    const sim = firingSim([{ opcode: 'MissionWon', player: OWNER }]);
    sim.enqueueSetup({ kind: 'setMatchParticipants', players: [OWNER, RIVAL] });
    spawn(sim, { player: OWNER, job: SOLDIER });
    const events = eventsUntil(sim, FIRST_DEATH_CHECK, VERDICT_EVENTS);
    expect(events).toEqual([
      { tick: FIRST_PASS, event: { kind: 'playerWon', player: OWNER } },
      { tick: FIRST_DEATH_CHECK, event: { kind: 'playerDefeated', player: RIVAL } },
      { tick: FIRST_DEATH_CHECK, event: { kind: 'playerWon', player: OWNER } },
    ]);
    expect(sim.matchOutcome(RIVAL)).toBe('defeat');
  });

  it('carries the verdict through the save round trip', () => {
    const sim = firingSim([{ opcode: 'MissionFailed', player: RIVAL }]);
    sim.run(FIRST_PASS);
    expect(roundTrip(sim).matchOutcome(RIVAL)).toBe('defeat');
  });

  it('reports a verdict for a slot the sim has no seat for', () => {
    const sim = firingSim([{ opcode: 'MissionWon', player: WILD }]);
    expect(failedResultsUntil(sim, FIRST_PASS)).toEqual(['MissionWon']);
  });
});

describe('PlayerDied', () => {
  it('holds once the match rule marks the player dead, and not before', () => {
    const sim = goalSim({ opcode: 'PlayerDied', player: RIVAL });
    sim.enqueueSetup({ kind: 'setMatchParticipants', players: [OWNER, RIVAL] });
    spawn(sim, { player: OWNER, job: SOLDIER });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    sim.run(FIRST_DEATH_CHECK + FIRST_PASS - sim.tick);
    expect(isPlayerDead(sim.world, RIVAL)).toBe(true);
    expect(holds(sim)).toBe(true);
  });
});

describe('PlayerSeen', () => {
  const seen: MissionGoalOp = { opcode: 'PlayerSeen', player: OWNER, otherPlayer: RIVAL };

  it('holds in plain sight with fog off', () => {
    const sim = goalSim(seen);
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('under fog holds only once the viewer has met the other', () => {
    const met = goalSim(seen);
    met.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.REVEAL });
    spawn(met, { player: OWNER });
    spawn(met, { player: RIVAL, at: NEXT_TO_POINT });
    met.run(FIRST_PASS);
    expect(holds(met)).toBe(true);

    const apart = goalSim(seen);
    apart.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.REVEAL });
    spawn(apart, { player: OWNER });
    spawn(apart, { player: RIVAL, at: FAR_EAST });
    apart.run(FIRST_PASS);
    expect(holds(apart)).toBe(false);
  });

  it('under fog holds once the other stands on ground the viewer explored, in sight or not', () => {
    const sim = missionSim([
      {
        successfullIf: SUCCESSFUL_IF.all,
        active: true,
        visible: false,
        goals: [],
        results: [{ opcode: 'ExploreArea', player: OWNER, point: FAR_EAST, range: 2 }],
      },
      { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [seen], results: [] },
    ]);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.REVEAL });
    spawn(sim, { player: OWNER });
    spawn(sim, { player: RIVAL, at: FAR_EAST });
    sim.run(FIRST_PASS);
    expect(missionRecords(sim.world)[1]?.evaluated).toBe(false);
    sim.run(FIRST_PASS);
    expect(missionRecords(sim.world)[1]?.evaluated).toBe(true);
  });
});

describe('PlayerAttackedByPlayer', () => {
  /** The line's first token is the victim, its second the striker. */
  const attacked = (victim: number, striker: number): MissionGoalOp => ({
    opcode: 'PlayerAttackedByPlayer',
    otherPlayer: victim,
    player: striker,
  });

  /** Land one blow of the striker's unit on the rival's; the units stand side by side. */
  function strike(sim: Simulation, damage: number, strikerOwner = STRIKER): void {
    spawn(sim, { player: strikerOwner, missionId: ATTACKER_ID });
    spawn(sim, { player: RIVAL, missionId: VICTIM_ID, at: NEXT_TO_POINT });
    sim.run(2);
    resolveCombatHit(
      sim.world,
      ctxOf(sim),
      stamped(sim, ATTACKER_ID),
      stamped(sim, VICTIM_ID),
      { damage },
      [],
      'melee',
    );
  }

  it('marks the victim as struck by the attacker, one direction only, and the goal reads it', () => {
    const sim = goalSim(attacked(RIVAL, STRIKER));
    strike(sim, A_BLOW);
    expect(wasAttackedBy(sim.world, RIVAL, STRIKER)).toBe(true);
    expect(wasAttackedBy(sim.world, STRIKER, RIVAL)).toBe(false);
    sim.run(FIRST_PASS - sim.tick);
    expect(holds(sim)).toBe(true);

    const reverse = goalSim(attacked(STRIKER, RIVAL));
    strike(reverse, A_BLOW);
    reverse.run(FIRST_PASS - reverse.tick);
    expect(holds(reverse)).toBe(false);
  });

  it('a blow that deals nothing marks nobody', () => {
    const sim = goalSim(attacked(RIVAL, STRIKER));
    strike(sim, NO_BLOW);
    expect(sim.world.lowestEntityWith(PlayerAttacks)).toBeNull();
  });

  it("a blow between one owner's own units marks nobody", () => {
    const sim = goalSim(attacked(RIVAL, RIVAL));
    strike(sim, A_BLOW, RIVAL);
    expect(sim.world.lowestEntityWith(PlayerAttacks)).toBeNull();
  });

  it("a wild animal's bite marks nobody", () => {
    const sim = goalSim(attacked(RIVAL, STRIKER));
    spawn(sim, { player: RIVAL, missionId: VICTIM_ID });
    sim.enqueueSetup({
      kind: 'spawnAnimalHerd',
      tribe: WOLF,
      x: NEXT_TO_POINT.hx,
      y: NEXT_TO_POINT.hy,
      count: 1,
      missionId: HERD_ID,
    });
    sim.run(2);
    resolveCombatHit(
      sim.world,
      ctxOf(sim),
      stamped(sim, HERD_ID),
      stamped(sim, VICTIM_ID),
      { damage: A_BLOW },
      [],
      'melee',
    );
    expect(sim.world.lowestEntityWith(PlayerAttacks)).toBeNull();
  });

  it('carries the mark through the save round trip', () => {
    const sim = goalSim(attacked(RIVAL, STRIKER));
    strike(sim, A_BLOW);
    sim.step();
    expect(wasAttackedBy(roundTrip(sim).world, RIVAL, STRIKER)).toBe(true);
  });
});

describe('SetExternalFlag', () => {
  const flag = (slot: number, raised: boolean): MissionResultOp => ({
    opcode: 'SetExternalFlag',
    player: OWNER,
    flagId: slot,
    flag: raised,
  });

  it("raises and clears the player's condition slots and carries them through a save", () => {
    const sim = firingSim([flag(SLOT, true), flag(OTHER_SLOT, true), flag(SLOT, false)]);
    sim.run(FIRST_PASS);
    expect(aiExternalFlagRaised(sim.world, OWNER, OTHER_SLOT)).toBe(true);
    expect(aiExternalFlagRaised(sim.world, OWNER, SLOT)).toBe(false);
    expect(aiExternalFlagRaised(sim.world, RIVAL, OTHER_SLOT)).toBe(false);
    expect(aiExternalFlagRaised(roundTrip(sim).world, OWNER, OTHER_SLOT)).toBe(true);
  });

  it('drops a slot past the ai.inc limit', () => {
    const sim = firingSim([flag(MAP_AI_CONDITION_SLOTS, true)]);
    sim.run(FIRST_PASS);
    expect(sim.world.lowestEntityWith(AiExternalFlags)).toBeNull();
  });
});
