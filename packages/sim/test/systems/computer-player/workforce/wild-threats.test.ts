import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Engagement, FOG_MODE, Owner, Settler, StayPoint } from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { Simulation } from '../../../../src/index.js';
import {
  HUNTERS_PREY_MAX_HITPOINTS,
  WILD_DEFENCE_CALL_NODES,
  WILD_DEFENCE_HIRES_MAX,
  WILD_THREAT_REACH_NODES,
} from '../../../../src/systems/computer-player/workforce/wild-threats.js';
import type { SystemContext } from '../../../../src/systems/index.js';
import { WEAPON_MAIN_TYPE } from '../../../../src/systems/readviews/index.js';
import { cellOfNode } from '../../../../src/systems/vision/gates.js';
import type { FogState } from '../../../../src/systems/vision/state.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import {
  collectModule,
  ctxOf,
  HQ_X,
  HQ_Y,
  HUNTER,
  huntingContent,
  placeHq,
  SEAT,
  spawnMen,
  VIKING,
} from '../support.js';

/** A free fixture tribe for an `aggressive` animal, and a weapon id the fixture leaves free. */
const WOLF = 20;
const HUNTER_BOW = 90;
const WOLF_HITPOINTS = 100;
/** Node offset of the wolf from the headquarters: well inside the settlement. */
const WOLF_DX = 8;
/** Sight stamped around the wolf by hand, in cells. */
const SIGHT_RADIUS = 2;
/** The map player a wolf pack is handed to, as mroczny_las gives its packs to the forest's people. */
const PACK_KEEPER = 3;
/** A map wide enough to hold a wolf past the settlement's reach with a hunter in call of it. */
const WIDE_MAP_NODES = 128;
/** More spare men than the hire cap, and more wolves than one hunter per wolf could answer. */
const SPARE_MEN = 6;
const WOLVES = 3;

/** {@link huntingContent} plus an aggressive wolf and a bow for the viking hunter. */
function wolfContent(hitpoints = WOLF_HITPOINTS): ContentSet {
  const base = huntingContent();
  return parseContentSet({
    ...base,
    tribes: [...base.tribes, { typeId: WOLF, id: 'wolves' }],
    animals: [
      ...base.animals,
      { id: 'wolves', tribeType: WOLF, aggressive: true, hitpointsAdult: hitpoints },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: HUNTER_BOW,
        id: 'viking_bow_hunter',
        tribeType: VIKING,
        jobType: HUNTER,
        mainType: WEAPON_MAIN_TYPE.BOW,
        munitionType: 1,
        speed: 8,
        minRange: 3,
        maxRange: 17,
      },
    ],
  });
}

/** A seat with a headquarters, `hunters` unposted hunters, `spare` civilians and `wolves` wolves beside
 *  the headquarters, after one step. */
function wolfSim(
  hunters: number,
  spare: number,
  wolves = 1,
  hitpoints = WOLF_HITPOINTS,
  keeper?: { player: number; stance: 'enemy' | 'friend' },
): { sim: Simulation; wolves: Entity[] } {
  const sim = new Simulation({ seed: 1, content: wolfContent(hitpoints), map: grassNodeMap(64, 32) });
  placeHq(sim);
  spawnMen(sim, hunters, HUNTER);
  for (let i = 0; i < spare; i++) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: 6,
      x: HQ_X - 4,
      y: 4 + 2 * i,
      tribe: VIKING,
      owner: SEAT,
    });
  }
  if (keeper !== undefined) {
    sim.enqueueSetup({ kind: 'setDiplomacy', from: SEAT, to: keeper.player, state: keeper.stance });
  }
  sim.enqueueSetup({
    kind: 'spawnAnimalHerd',
    tribe: WOLF,
    x: HQ_X + WOLF_DX,
    y: HQ_Y,
    count: wolves,
    ...(keeper !== undefined ? { owner: keeper.player } : {}),
  });
  sim.step();
  const spawned = [...sim.world.query(StayPoint, Settler)].filter(
    (e) => sim.world.get(e, Settler).tribe === WOLF,
  );
  return { sim, wolves: spawned };
}

function decide(sim: Simulation, fog?: FogState): readonly PlayerCommand[] {
  const ctx: SystemContext = { ...ctxOf(sim, sim.tick), content: sim.content, ...(fog ? { fog } : {}) };
  return collectModule.run(sim.world, ctx, SEAT);
}

const attacks = (commands: readonly PlayerCommand[]) => commands.filter((c) => c.kind === 'attackUnit');

describe('workforce module - hunters against wild animals', () => {
  it('sends its hunter at a wolf inside the settlement', () => {
    const { sim, wolves } = wolfSim(1, 0);
    const hunter = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === HUNTER);
    expect(attacks(decide(sim))).toEqual([
      { kind: 'attackUnit', entity: hunter, target: wolves[0], assault: true },
    ]);
  });

  it("answers a pack a map hands to an enemy player, and spares a friend's", () => {
    const enemy = wolfSim(1, 0, 1, WOLF_HITPOINTS, { player: PACK_KEEPER, stance: 'enemy' });
    expect(attacks(decide(enemy.sim))).toEqual([expect.objectContaining({ target: enemy.wolves[0] })]);
    const friend = wolfSim(1, 0, 1, WOLF_HITPOINTS, { player: PACK_KEEPER, stance: 'friend' });
    expect(attacks(decide(friend.sim))).toEqual([]);
  });

  it('leaves a beast stronger than its hunters to the towers', () => {
    const { sim } = wolfSim(1, 0, 1, HUNTERS_PREY_MAX_HITPOINTS + 1);
    expect(attacks(decide(sim))).toEqual([]);
  });

  it('ignores a wolf outside its own sight, and answers it once the seat sees it', () => {
    const { sim } = wolfSim(1, 0);
    const fog = sim.fog;
    if (fog === undefined) throw new Error('setup: a mapped sim has fog');
    fog.activeMode = FOG_MODE.CLASSIC_FOG_OF_WAR;
    expect(attacks(decide(sim, fog))).toEqual([]);
    const { cx, cy } = cellOfNode(HQ_X + WOLF_DX, HQ_Y);
    fog.stampSight(SEAT, cx, cy, SIGHT_RADIUS);
    expect(attacks(decide(sim, fog))).toHaveLength(1);
  });

  it('hires hunters out of its spare men while it has too few, up to the cap', () => {
    const { sim } = wolfSim(0, SPARE_MEN, WOLVES);
    const commands = decide(sim);
    const hires = commands.flatMap((c) => (c.kind === 'setJob' && c.jobType === HUNTER ? [c] : []));
    expect(hires).toHaveLength(WILD_DEFENCE_HIRES_MAX);
    const sent = attacks(commands).map((c) => c.entity);
    for (const hire of hires) expect(sent).toContain(hire.entity);
  });

  it('answers a wolf biting one of its people out past the settlement', () => {
    const sim = new Simulation({ seed: 1, content: wolfContent(), map: grassNodeMap(WIDE_MAP_NODES, 32) });
    placeHq(sim);
    const wolfX = HQ_X + 2 * WILD_THREAT_REACH_NODES;
    const near = wolfX - WILD_DEFENCE_CALL_NODES / 2;
    for (const jobType of [HUNTER, 6]) {
      sim.enqueueSetup({ kind: 'spawnSettler', jobType, x: near, y: HQ_Y, tribe: VIKING, owner: SEAT });
    }
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: WOLF, x: wolfX, y: HQ_Y, count: 1 });
    sim.step();
    const [wolf] = [...sim.world.query(StayPoint, Settler)].filter(
      (e) => sim.world.get(e, Settler).tribe === WOLF,
    );
    const victim = [...sim.world.query(Settler, Owner)].find((e) => sim.world.get(e, Settler).jobType === 6);
    if (wolf === undefined || victim === undefined) throw new Error('setup: a wolf and its victim');
    expect(attacks(decide(sim))).toEqual([]);
    sim.world.add(wolf, Engagement, { repathAt: 0, target: victim });
    const sent = attacks(decide(sim));
    expect(sent.length).toBeGreaterThan(0);
    for (const order of sent) expect(order).toMatchObject({ target: wolf });
  });
});
