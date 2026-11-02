import { WERESNAKE_TRIBE, WEREWOLF_TRIBE } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AiControl,
  AiOrder,
  aiControlEntity,
  MusterPlan,
  Owner,
  PlayerOrder,
  PlayerPlacementRules,
  WaveMarch,
} from '../../../src/components/index.js';
import { aiCommand } from '../../../src/core/commands/index.js';
import { parseCommandEnvelope } from '../../../src/core/commands/parse.js';
import { Simulation } from '../../../src/index.js';
import { authorizedCommand } from '../../../src/systems/command/authority.js';
import { setAiControl } from '../../../src/systems/orders/ai.js';
import { recordAiOrder } from '../../../src/systems/orders/ai-lifecycle.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';

const PLAYER = 1;
function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent() });
  const unit = sim.world.create();
  sim.world.add(unit, Owner, { player: PLAYER });
  const ctx = ctxOf(sim);
  setAiControl(sim.world, ctx, { kind: 'setAiControl', player: PLAYER, enabled: true });
  return { sim, unit, ctx };
}

describe('AI control transitions', () => {
  it('rejects queued computer decisions after blanket disable, while map tasks remain authorized', () => {
    const { sim, unit, ctx } = fixture();
    const move = { kind: 'moveUnit' as const, entity: unit, x: 10, y: 10 };
    const computer = aiCommand(PLAYER, move, 'military');
    const authored = aiCommand(PLAYER, move, 'map-ai');
    expect(authorizedCommand(sim.world, computer)).toEqual(move);
    setAiControl(sim.world, ctx, {
      kind: 'setAiControl',
      player: PLAYER,
      enabled: true,
      computerEnabled: false,
    });
    expect(authorizedCommand(sim.world, computer)).toBeUndefined();
    expect(authorizedCommand(sim.world, authored)).toEqual(move);
    const carrier = aiControlEntity(sim.world, PLAYER);
    if (carrier === null) throw new Error('machine identity disappeared');
    expect(Object.values(sim.world.get(carrier, AiControl).modules).every(Boolean)).toBe(true);
  });

  it('rejects a delayed recruitment publication after military is disabled but permits civilian growth', () => {
    const { sim, ctx } = fixture();
    const training = aiCommand(
      PLAYER,
      { kind: 'setAssistantCounter', player: PLAYER, counter: 'trainSoldiers', value: 3, infinite: false },
      'collectResources',
    );
    const families = aiCommand(
      PLAYER,
      { kind: 'setAssistantCounter', player: PLAYER, counter: 'extraWomen', value: 3, infinite: false },
      'homeExpansion',
    );
    expect(authorizedCommand(sim.world, training)).toEqual(training.command);
    setAiControl(sim.world, ctx, {
      kind: 'setAiControl',
      player: PLAYER,
      enabled: true,
      modules: { military: false },
    });
    expect(authorizedCommand(sim.world, training)).toBeUndefined();
    expect(authorizedCommand(sim.world, families)).toEqual(families.command);
  });

  it('withdraws only movement still owned by the disabled military controller', () => {
    const { sim, unit, ctx } = fixture();
    const mapUnit = sim.world.create();
    const humanUnit = sim.world.create();
    for (const entity of [unit, mapUnit, humanUnit]) {
      sim.world.add(entity, Owner, { player: PLAYER });
      sim.world.add(entity, PlayerOrder, {});
      recordAiOrder(sim.world, entity, { player: PLAYER, source: 'military' });
      if (entity === mapUnit) recordAiOrder(sim.world, entity, { player: PLAYER, source: 'map-ai' });
      if (entity === humanUnit) recordAiOrder(sim.world, entity);
    }
    sim.world.add(unit, MusterPlan, { waveSize: 10, drawnAt: 0, cappedAt: null });
    sim.world.add(unit, WaveMarch, {
      target: mapUnit,
      gatherAt: null,
      since: 0,
      firstArrival: null,
      men: [unit],
      catapults: [],
    });
    setAiControl(sim.world, ctx, {
      kind: 'setAiControl',
      player: PLAYER,
      enabled: true,
      modules: { military: false },
    });
    expect(sim.world.has(unit, PlayerOrder)).toBe(false);
    expect(sim.world.has(unit, AiOrder)).toBe(false);
    expect(sim.world.has(mapUnit, PlayerOrder)).toBe(true);
    expect(sim.world.has(humanUnit, PlayerOrder)).toBe(true);
    expect(sim.world.has(unit, MusterPlan)).toBe(false);
    expect(sim.world.has(unit, WaveMarch)).toBe(false);
    setAiControl(sim.world, ctx, { kind: 'setAiControl', player: PLAYER, enabled: true });
    expect(sim.world.has(unit, WaveMarch)).toBe(false);
  });

  it('distinguishes stopped machine controllers from handing a seat back to human rules', () => {
    const { sim, ctx, unit } = fixture();
    setAiControl(sim.world, ctx, {
      kind: 'setAiControl',
      player: PLAYER,
      enabled: true,
      computerEnabled: false,
      mapAiEnabled: false,
    });
    expect(aiControlEntity(sim.world, PLAYER)).not.toBeNull();
    expect(
      authorizedCommand(
        sim.world,
        aiCommand(PLAYER, { kind: 'moveUnit', entity: unit, x: 10, y: 10 }, 'map-ai'),
      ),
    ).toBeUndefined();
    setAiControl(sim.world, ctx, { kind: 'setAiControl', player: PLAYER, enabled: false });
    expect(aiControlEntity(sim.world, PLAYER)).toBeNull();
  });

  it.each([WERESNAKE_TRIBE, WEREWOLF_TRIBE])(
    'keeps monster tribe %i under map control on takeover',
    (tribe) => {
      const { sim, ctx } = fixture();
      sim.world.add(sim.world.create(), PlayerPlacementRules, { tribes: new Map([[PLAYER, [tribe]]]) });
      setAiControl(sim.world, ctx, {
        kind: 'setAiControl',
        player: PLAYER,
        enabled: true,
        computerEnabled: true,
      });
      const carrier = aiControlEntity(sim.world, PLAYER);
      if (carrier === null) throw new Error('missing machine identity');
      expect(sim.world.get(carrier, AiControl)).toMatchObject({ computerEnabled: false, mapAiEnabled: true });
    },
  );

  it('stops colony decisions when any toggle the colony needs turns off', () => {
    const { sim, unit, ctx } = fixture();
    const move = aiCommand(PLAYER, { kind: 'moveUnit', entity: unit, x: 10, y: 10 }, 'colony');
    sim.world.add(unit, PlayerOrder, {});
    recordAiOrder(sim.world, unit, { player: PLAYER, source: 'colony' });
    expect(
      authorizedCommand(sim.world, parseCommandEnvelope(JSON.parse(JSON.stringify(move)))),
    ).toBeDefined();
    setAiControl(sim.world, ctx, {
      kind: 'setAiControl',
      player: PLAYER,
      enabled: true,
      modules: { guideBuild: false },
    });
    expect(authorizedCommand(sim.world, move)).toBeUndefined();
    expect(sim.world.has(unit, PlayerOrder)).toBe(false);
  });

  it('preserves decision provenance in the queue and imported diagnostic log', () => {
    const { sim, unit } = fixture();
    const command = aiCommand(PLAYER, { kind: 'moveUnit', entity: unit, x: 10, y: 10 }, 'map-ai');
    sim.commands.enqueue(parseCommandEnvelope(JSON.parse(JSON.stringify(command))));
    expect(sim.commands.pendingSnapshot()).toEqual([command]);
    expect(() => parseCommandEnvelope({ ...command, decisionSource: 'unknown' })).toThrow(/decision source/);
    expect(() => parseCommandEnvelope({ ...command, origin: 'player' })).toThrow(/decision source/);
  });
});
