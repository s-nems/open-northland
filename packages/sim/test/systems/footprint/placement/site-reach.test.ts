import { describe, expect, it } from 'vitest';
import {
  Building,
  Owner,
  Position,
  Settler,
  Signpost,
  UnderConstruction,
  Upgrading,
} from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import { fx } from '../../../../src/core/fixed.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  adminCommand,
  aiCommand,
  hexDistanceBetween,
  playerCommand,
  positionOfNode,
  Simulation,
} from '../../../../src/index.js';
import { SITE_REACH_RADIUS_NODES, siteReachFor } from '../../../../src/systems/footprint/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

/** Site reach: a seat lays a building only near its own people, standing buildings and signposts. A
 *  project rule, so nothing here claims fidelity. */

const VIKING = 1;
const SEAT = 2;
const RIVAL = 3;
const CIVILIST = 6;
const HQ_TYPE = 1;
const RADIUS = SITE_REACH_RADIUS_NODES;
const MAP = { width: 160, height: 120 };

/** Where the anchor stands in every case; an even row, so `hx` steps are plain hex steps. */
const HOME = { x: 20, y: 20 };
/** Straight along the row, so the hex distance is the `hx` difference. */
const EDGE = { x: HOME.x + RADIUS, y: HOME.y };
const PAST = { x: HOME.x + RADIUS + 1, y: HOME.y };

function fresh(): Simulation {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(MAP.width, MAP.height) });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  return sim;
}

function spawn(sim: Simulation, owner: number, at = HOME): Entity {
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: CIVILIST, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
  const spawned = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (spawned === undefined) throw new Error('setup: nothing spawned');
  return spawned;
}

/** A bare entity of the seat's at {@link HOME}, given its kind by `add`. */
function anchor(sim: Simulation, add: (e: Entity) => void): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(HOME.x, HOME.y));
  sim.world.add(e, Owner, { player: SEAT });
  add(e);
  return e;
}

function reaches(sim: Simulation, at: { x: number; y: number }): boolean {
  return siteReachFor(sim.world, SEAT).reaches(at.x, at.y);
}

describe('site reach', () => {
  it("reaches the radius around the seat's own settler and no node past it", () => {
    const sim = fresh();
    expect(reaches(sim, HOME)).toBe(false);
    spawn(sim, RIVAL);
    expect(reaches(sim, HOME)).toBe(false);

    spawn(sim, SEAT);
    expect(reaches(sim, EDGE)).toBe(true);
    expect(reaches(sim, PAST)).toBe(false);
  });

  it('covers exactly the nodes within the hex distance of a source, node by node and over an area', () => {
    const sim = fresh();
    // Odd and even rows, and two sources one row shares, whose spans merge.
    const sources = [HOME, { x: HOME.x + 7, y: HOME.y }, { x: 90, y: 61 }];
    for (const at of sources) spawn(sim, SEAT, at);
    const reach = siteReachFor(sim.world, SEAT);
    const whole = { minHx: 0, maxHx: MAP.width - 1, minHy: 0, maxHy: MAP.height - 1 };
    const part = { minHx: 30, maxHx: 110, minHy: 5, maxHy: 90 };
    const wholeMask = reach.over(whole);
    const partMask = reach.over(part);
    for (let hy = 0; hy < MAP.height; hy++) {
      for (let hx = 0; hx < MAP.width; hx++) {
        const within = sources.some((s) => hexDistanceBetween(s.x, s.y, hx, hy) <= RADIUS);
        const inPart = hx >= part.minHx && hx <= part.maxHx && hy >= part.minHy && hy <= part.maxHy;
        const partSays = inPart
          ? partMask[(hy - part.minHy) * (part.maxHx - part.minHx + 1) + hx - part.minHx] === 1
          : within;
        const said = [reach.reaches(hx, hy), wholeMask[hy * MAP.width + hx] === 1, partSays];
        if (said.some((verdict) => verdict !== within))
          throw new Error(`node (${hx}, ${hy}): expected ${within}`);
      }
    }
  });

  it('a standing building and a signpost carry reach, a foundation does not, an upgrade site still does', () => {
    const sim = fresh();
    const house = anchor(sim, (e) =>
      sim.world.add(e, Building, { buildingType: HQ_TYPE, tribe: VIKING, built: fx.fromInt(0), level: 0 }),
    );
    sim.world.add(house, UnderConstruction, { labor: fx.fromInt(0) });
    expect(reaches(sim, HOME)).toBe(false);

    sim.world.add(house, Upgrading, { target: 1, savedStock: new Map(), seeded: new Map() });
    expect(reaches(sim, EDGE)).toBe(true);

    sim.world.destroy(house);
    expect(reaches(sim, HOME)).toBe(false);
    anchor(sim, (e) => sim.world.add(e, Signpost, { links: [] }));
    expect(reaches(sim, EDGE)).toBe(true);
  });

  it("refuses a person's and a computer player's site out of reach, while setup and the admin tools place anywhere", () => {
    const sim = fresh();
    spawn(sim, SEAT);
    const site = (x: number): Extract<PlayerCommand, { kind: 'placeBuilding' }> => ({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x,
      y: HOME.y,
      tribe: VIKING,
      owner: SEAT,
    });
    const buildings = (): number => [...sim.world.query(Building)].length;
    // Each case lays its own site, a few cells apart, so no site stands on another's ground.
    const far = (lane: number): number => PAST.x + 10 * (lane + 1);

    sim.enqueue(playerCommand(SEAT, site(far(0))));
    sim.enqueue(aiCommand(SEAT, site(far(1))));
    sim.step();
    expect(buildings()).toBe(0);

    sim.enqueue(playerCommand(SEAT, site(HOME.x + 10)));
    sim.step();
    expect(buildings()).toBe(1);

    sim.enqueueSetup(site(far(2)));
    sim.enqueue(adminCommand(site(far(3))));
    sim.step();
    expect(buildings()).toBe(3);
  });

  it("keeps the ghost's key while a settler walks about inside the reach", () => {
    const sim = fresh();
    const man = spawn(sim, SEAT);
    const area = { minHx: HOME.x - 4, maxHx: HOME.x + 4, minHy: HOME.y - 4, maxHy: HOME.y + 4 };
    const keyOf = (): string | undefined => sim.placementAnswer(HQ_TYPE, area, SEAT, VIKING, false)?.key;
    const before = keyOf();

    Object.assign(sim.world.mut(man, Position), positionOfNode(HOME.x + 2, HOME.y));
    expect(keyOf()).toBe(before);

    Object.assign(sim.world.mut(man, Position), positionOfNode(HOME.x + RADIUS + 2, HOME.y));
    expect(keyOf()).not.toBe(before);
  });
});
