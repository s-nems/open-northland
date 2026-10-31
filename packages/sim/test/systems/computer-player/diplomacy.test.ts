import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerStrategy,
  type DiplomacyState,
  diplomacyStance,
  type EconomicArchetype,
  setDiplomacyLock,
} from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { AI_HANDLER_ROUND_TICKS } from '../../../src/systems/ai-shared/cadence.js';
import { testContent } from '../../fixtures/content.js';
import { grassMap } from '../conflict/engagement/support.js';

/**
 * A computer seat's answer to another player's stance toward it, one slot per handler turn: the seat on
 * slot 1 looks at slot 0 on round 0, at slot 2 on round 2, and at itself on no round.
 */

const HUMAN = 0;
const COMPUTER = 1;
const THIRD = 2;
/** A slot outside every match below. */
const OUTSIDE = 3;
/** The rounds in which the computer's cursor has reached the third slot. */
const ROUNDS_TO_THIRD = 3;
/** The slots the cursor walks before it looks at the same player again. */
const PLAYER_SLOTS = 20;

function stances(
  rows: readonly { from: number; to: number; state: DiplomacyState }[],
  ai: { mapAiEnabled?: boolean; computerEnabled?: boolean } = {},
): Simulation {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
  sim.enqueueSetup({ kind: 'setAiControl', player: COMPUTER, enabled: true, ...ai });
  for (const row of rows) sim.enqueueSetup({ kind: 'setDiplomacy', ...row });
  return sim;
}

describe('the computer seat answering a stance', () => {
  it('turns a neutral seat enemy toward a player that declared it an enemy', () => {
    const sim = stances([
      { from: COMPUTER, to: HUMAN, state: 'neutral' },
      { from: HUMAN, to: COMPUTER, state: 'enemy' },
    ]);
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('enemy');
  });

  it("lowers a friendly seat to the other's stance, and keeps a friendship both sides hold", () => {
    const lowered = stances([
      { from: COMPUTER, to: HUMAN, state: 'friend' },
      { from: HUMAN, to: COMPUTER, state: 'neutral' },
    ]);
    const kept = stances([
      { from: COMPUTER, to: HUMAN, state: 'friend' },
      { from: HUMAN, to: COMPUTER, state: 'friend' },
    ]);
    lowered.run(AI_HANDLER_ROUND_TICKS);
    kept.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(lowered.world, COMPUTER, HUMAN)).toBe('neutral');
    expect(diplomacyStance(kept.world, COMPUTER, HUMAN)).toBe('friend');
  });

  it('never makes peace from an enemy stance, and leaves a neutral seat neutral toward a neutral player', () => {
    const sim = stances([
      { from: COMPUTER, to: HUMAN, state: 'enemy' },
      { from: HUMAN, to: COMPUTER, state: 'friend' },
      { from: COMPUTER, to: THIRD, state: 'neutral' },
      { from: THIRD, to: COMPUTER, state: 'neutral' },
    ]);
    sim.run(ROUNDS_TO_THIRD * AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('enemy');
    expect(diplomacyStance(sim.world, COMPUTER, THIRD)).toBe('neutral');
  });

  it('looks at one slot per turn and answers past a lock', () => {
    const sim = stances([
      { from: COMPUTER, to: THIRD, state: 'neutral' },
      { from: THIRD, to: COMPUTER, state: 'enemy' },
    ]);
    setDiplomacyLock(sim.world, COMPUTER, THIRD, true);
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, THIRD)).toBe('neutral'); // round 0 looked at slot 0
    sim.run((ROUNDS_TO_THIRD - 1) * AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, THIRD)).toBe('enemy');
  });

  it('keeps a neutral member neutral toward a partner while the peace holds, and answers once it ends', () => {
    const sim = stances([
      { from: COMPUTER, to: HUMAN, state: 'neutral' },
      { from: HUMAN, to: COMPUTER, state: 'enemy' },
    ]);
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: AI_HANDLER_ROUND_TICKS, players: [HUMAN, COMPUTER] });
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('neutral');
    sim.run(PLAYER_SLOTS * AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('enemy');
  });

  it('keeps autonomous diplomacy when only map AI is disabled', () => {
    const sim = stances(
      [
        { from: COMPUTER, to: HUMAN, state: 'neutral' },
        { from: HUMAN, to: COMPUTER, state: 'enemy' },
      ],
      { mapAiEnabled: false },
    );
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('enemy');
  });

  it.each([
    ['its whole AI (`AI_Disable`)', { mapAiEnabled: false, computerEnabled: false }],
    ['its strategic handler (`HAI_Disable`)', { computerEnabled: false }],
  ])('stays silent on a seat whose map disabled %s', (_, ai) => {
    const sim = stances(
      [
        { from: COMPUTER, to: HUMAN, state: 'neutral' },
        { from: HUMAN, to: COMPUTER, state: 'enemy' },
      ],
      ai,
    );
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('neutral');
  });
});

describe('an islands seat declaring war', () => {
  /** A match of the human, the computer and the third seat beside a slot outside it, every stance neutral
   *  both ways, the computer playing `archetype`, under a lobby peace that ends after the first round. */
  function islandMatch(
    archetype: EconomicArchetype,
    extra: { from: number; to: number; state: DiplomacyState }[] = [],
    { scriptedThird = false } = {},
  ) {
    const players = [HUMAN, COMPUTER, THIRD];
    const seats = [...players, OUTSIDE];
    const rows = seats.flatMap((from) =>
      seats.filter((to) => to !== from).map((to) => ({ from, to, state: 'neutral' as const })),
    );
    const sim = stances([...rows, ...extra]);
    if (scriptedThird)
      sim.enqueueSetup({ kind: 'setAiControl', player: THIRD, enabled: true, computerEnabled: false });
    sim.enqueueSetup({ kind: 'setMatchParticipants', players });
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: AI_HANDLER_ROUND_TICKS, players });
    sim.run(1);
    const carrier = aiControlEntity(sim.world, COMPUTER);
    if (carrier === null) throw new Error('the computer seat has no AI carrier');
    sim.world.add(carrier, ComputerStrategy, {
      economy: { archetype, sides: [], evidence: [], decidedAt: 0, challenger: null },
      military: {
        plan: 'balanced',
        posture: 'prepare',
        evidence: [],
        ownPoints: 0,
        targetOwner: null,
        targetPoints: null,
        strongestPoints: null,
        threatInTicks: null,
        decidedAt: 0,
        challenger: null,
      },
    });
    return sim;
  }

  it('turns every neutral player enemy once the peace ends, and not before', () => {
    const sim = islandMatch('islands');
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('neutral');
    sim.run(PLAYER_SLOTS * AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('enemy');
    expect(diplomacyStance(sim.world, COMPUTER, THIRD)).toBe('enemy');
  });

  it('keeps a friend set by the map a friend', () => {
    const sim = islandMatch('islands', [
      { from: COMPUTER, to: THIRD, state: 'friend' },
      { from: THIRD, to: COMPUTER, state: 'friend' },
    ]);
    sim.run((PLAYER_SLOTS + 1) * AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, THIRD)).toBe('friend');
  });

  it('leaves a seat of another archetype neutral', () => {
    const sim = islandMatch('standard');
    sim.run((PLAYER_SLOTS + 1) * AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('neutral');
  });

  it('never declares on a map-scripted seat or a slot outside the match', () => {
    const sim = islandMatch('islands', [], { scriptedThird: true });
    sim.run((PLAYER_SLOTS + 1) * AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, THIRD)).toBe('neutral');
    expect(diplomacyStance(sim.world, COMPUTER, OUTSIDE)).toBe('neutral');
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('enemy');
  });
});
