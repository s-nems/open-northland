import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Health, Palisade, Position, Projectile, SettlerProgress } from '../../src/components/index.js';
import {
  type Entity,
  positionOfNode,
  type ScriptLandscapeType,
  type SimEvent,
  Simulation,
} from '../../src/index.js';
import { attackUnit } from '../../src/systems/orders/index.js';
import { fightExperienceTypeFor } from '../../src/systems/progression/experience.js';
import { ARMOR_MATERIAL, WEAPON_MAIN_TYPE } from '../../src/systems/readviews/index.js';
import { looseProjectile } from '../../src/systems/settlers/atomics/effects/combat/hit/projectile-launch.js';
import { fighterAt } from '../conflict/melee-engagement/support.js';
import { combatContent } from '../fixtures/content/combat.js';
import { economyContent } from '../fixtures/content/economy.js';
import { TEST_MANIFEST } from '../fixtures/content/index.js';
import { societyContent } from '../fixtures/content/societies.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const VIKING = 1;
const WOODCUTTER = 1;
/** The fixture's bow-armed job. */
const HUNTER = 15;
const P0 = 0;
const P1 = 1;
/** Building-column damage that takes one valency off a wall per blow, and one too weak to take any. */
const DENTING = 150;
const GLANCING = 50;
const WALL_HIT_SOUND = 84;
const ARROW = 1;
const ARROW_SPEED = 8;
/** Landed bow hits past every aim roll, so each shot comes down where it is aimed. */
const MARKSMAN_HITS = 100;

const GATE_SPAN = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));
const CLOSED_GATE: ScriptLandscapeType = {
  typeId: 696,
  walk: GATE_SPAN,
  build: GATE_SPAN,
  groups: [],
  wall: {
    maxHitpoints: 100,
    repairPerStrike: 1,
    construction: [{ goodType: 5, amount: 1 }],
    gate: { open: false, counterpartGfxIndex: 700 },
  },
};

const GATE_AT = { hx: 12, hy: 10 };

/** The fixture content with the woodcutter's axe and the hunter's bow dealing `houseDamage` in the building
 *  column and sounding {@link WALL_HIT_SOUND} on it, the bow firing arrows. */
function contentWith(houseDamage: number): ContentSet {
  const onWalls = (w: (typeof combatContent.weapons)[number]) => ({
    ...w,
    damage: { ...w.damage, [ARMOR_MATERIAL.HOUSE]: houseDamage },
    hitSounds: { ...w.hitSounds, [ARMOR_MATERIAL.HOUSE]: WALL_HIT_SOUND },
  });
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...economyContent,
    ...combatContent,
    ...societyContent,
    weapons: combatContent.weapons.map((w) =>
      w.id === 'test_axe'
        ? onWalls(w)
        : w.id === 'test_spear'
          ? { ...onWalls(w), munitionType: ARROW, speed: ARROW_SPEED }
          : w,
    ),
  });
}

function gated(houseDamage: number): { sim: Simulation; gate: Entity } {
  const sim = new Simulation({
    seed: 1,
    content: contentWith(houseDamage),
    map: { ...grassNodeMap(24, 20), landscapes: { types: [CLOSED_GATE], placements: [] } },
  });
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: CLOSED_GATE.typeId,
    x: GATE_AT.hx,
    y: GATE_AT.hy,
    tribe: VIKING,
    owner: P1,
  });
  sim.step();
  const gate = [...sim.world.query(Palisade)][0];
  if (gate === undefined) throw new Error('expected the gate');
  return { sim, gate };
}

function striker(sim: Simulation, job: number, at: { hx: number; hy: number }): Entity {
  const e = fighterAt(sim, 0, 0, VIKING, job, { owner: P0 });
  sim.world.add(e, Position, positionOfNode(at.hx, at.hy));
  return e;
}

/** The events of the next `ticks` ticks that `pick` keeps. */
function eventsOver<T extends SimEvent>(
  sim: Simulation,
  ticks: number,
  pick: (ev: SimEvent) => ev is T,
): T[] {
  const kept: T[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    sim.step();
    kept.push(...sim.snapshot().events.filter(pick));
  }
  return kept;
}

type Struck = Extract<SimEvent, { kind: 'combatHit' | 'projectileHit' }>;
const struck = (ev: SimEvent): ev is Struck => ev.kind === 'combatHit' || ev.kind === 'projectileHit';

/** Loose one arrow of `houseDamage` at `gate` from `source`, coming down on `landing`. */
function shootAt(
  sim: Simulation,
  source: Entity,
  gate: Entity,
  landing: { hx: number; hy: number },
  houseDamage: number,
): void {
  looseProjectile(sim.world, ctxOf(sim), {
    source,
    target: gate,
    player: P0,
    weapon: {
      munitionType: ARROW,
      speed: ARROW_SPEED,
      hitSelf: false,
      area: false,
      damage: { [ARMOR_MATERIAL.HOUSE]: houseDamage },
      hitSounds: { [ARMOR_MATERIAL.HOUSE]: WALL_HIT_SOUND },
      missSounds: {},
    },
    weaponMainType: null,
    cover: null,
    aim: positionOfNode(landing.hx, landing.hy),
  });
}

describe('arrows at a wall', () => {
  it('strike it wherever they come down on its body', () => {
    const { sim, gate } = gated(DENTING);
    const archer = striker(sim, HUNTER, { hx: GATE_AT.hx + 2, hy: GATE_AT.hy - 8 });
    shootAt(sim, archer, gate, { hx: GATE_AT.hx + 2, hy: GATE_AT.hy }, DENTING);
    for (let tick = 0; tick < 60 && [...sim.world.query(Projectile)].length > 0; tick++) sim.step();
    const health = sim.world.get(gate, Health);
    expect(health.hitpoints).toBe(health.max - 1);
  });

  it("are aimed along a gate's whole body by an archer ordered at it", () => {
    const { sim, gate } = gated(DENTING);
    const archer = striker(sim, HUNTER, { hx: GATE_AT.hx, hy: GATE_AT.hy - 8 });
    const bucket = fightExperienceTypeFor(WEAPON_MAIN_TYPE.BOW);
    if (bucket === undefined) throw new Error('expected a bow fight bucket');
    sim.world.mut(archer, SettlerProgress).experience = new Map([[bucket, MARKSMAN_HITS]]);
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: archer, target: gate });

    const hits = eventsOver(sim, 400, struck);
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.every((ev) => ev.target === gate)).toBe(true);
    expect(hits.some((ev) => ev.at.hx !== GATE_AT.hx)).toBe(true);
    const health = sim.world.get(gate, Health);
    expect(health.max - health.hitpoints).toBe(hits.length);
  });
});

describe('a blow too weak to dent a wall', () => {
  it('lands no hit and leaves the wall whole, where a denting one sounds', () => {
    const firstBlow = (houseDamage: number) => {
      const { sim, gate } = gated(houseDamage);
      const soldier = striker(sim, WOODCUTTER, { hx: GATE_AT.hx, hy: GATE_AT.hy - 1 });
      attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: soldier, target: gate });
      const [blow] = eventsOver(sim, 200, struck);
      return { blow, health: sim.world.get(gate, Health) };
    };
    const glancing = firstBlow(GLANCING);
    expect(glancing.blow).toBeUndefined();
    expect(glancing.health.hitpoints).toBe(glancing.health.max);
    expect(firstBlow(DENTING).blow?.soundType).toBe(WALL_HIT_SOUND);
  });

  it('thuds like a miss from an arrow too', () => {
    const { sim, gate } = gated(GLANCING);
    const archer = striker(sim, HUNTER, { hx: GATE_AT.hx, hy: GATE_AT.hy - 8 });
    shootAt(sim, archer, gate, GATE_AT, GLANCING);
    const missed = (ev: SimEvent): ev is Extract<SimEvent, { kind: 'projectileMissed' }> =>
      ev.kind === 'projectileMissed';
    const events = eventsOver(
      sim,
      60,
      (ev): ev is Struck | Extract<SimEvent, { kind: 'projectileMissed' }> => struck(ev) || missed(ev),
    );
    expect(events.map((ev) => ev.kind)).toEqual(['projectileMissed']);
    const health = sim.world.get(gate, Health);
    expect(health.hitpoints).toBe(health.max);
  });
});
