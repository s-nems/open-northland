import { components, FOG_MODE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { buildMapWorld, type MapWorldOptions } from '../src/entries/map/world.js';
import { AUTHORED_ENTITIES, AUTHORED_ROWS } from './support/authored-entities.js';
import { authoredMapFile } from './support/slice-maps.js';

/**
 * Which world the `?map=` entry lands on for a given decode, and the session rules it carries in.
 */

/** The entry's inputs with no URL flags set - each case supplies only what it exercises. */
const NO_SESSION_FLAGS = {
  seed: 7,
  content: {},
  aiSeats: [],
  assistantSeats: [],
  fog: null,
  progression: null,
} as const;

/** The authored join rows as a served IR document. Sound for these fixtures: the assembly reads the
 *  join lanes below plus the harvestable lanes, and this map places no objects. */
const AUTHORED_IR = AUTHORED_ROWS as ContentIr;

/** The world at the tick that applies its enqueued setup commands - the state the frame loop starts on. */
function afterSetupTick(options: MapWorldOptions): ReturnType<typeof buildMapWorld> {
  const world = buildMapWorld(options);
  world.sim.run(1);
  return world;
}

describe('buildMapWorld', () => {
  it('falls back to the demo world when no map decoded, owned by the session seat', () => {
    const { Building, Owner, Settler } = components;
    const { sim, kind } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: null,
      ir: AUTHORED_IR,
      demoOwner: 3,
    });
    expect(kind).toBe('demo');
    // The HQ/joinery/gatherer/carrier cluster, every piece tagged to the seat so it stays selectable.
    const owners = [...sim.world.query(Building), ...sim.world.query(Settler)].map(
      (e) => sim.world.tryGet(e, Owner)?.player,
    );
    expect(owners).toEqual([3, 3, 3, 3]);
  });

  it('builds a bare world for a decoded map that authors no entities', () => {
    const world = buildMapWorld({ ...NO_SESSION_FLAGS, map: authoredMapFile(), ir: AUTHORED_IR });
    expect(world.kind).toBe('bare');
    expect([...world.sim.world.query(components.Position)]).toHaveLength(0);
    expect(world.harvestablePlacements).toEqual([]);
  });

  it("places a map's authored entities once the IR resolves them", () => {
    const { Building, Settler } = components;
    const { sim, kind } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
    });
    expect(kind).toBe('authored');
    expect([...sim.world.query(Building)]).toHaveLength(2);
    expect([...sim.world.query(Settler)]).toHaveLength(1);
  });

  it('falls back to a bare world when no authored entity resolves', () => {
    const unresolvable = {
      buildings: [{ name: 'unknown house', level: 0, player: 1, hx: 2, hy: 2 }],
      humans: [],
      animals: [],
    };
    const world = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(unresolvable),
      ir: AUTHORED_IR,
    });
    expect(world.kind).toBe('bare');
    expect([...world.sim.world.query(components.Position)]).toHaveLength(0);
  });

  it('carries the session rules into the built world', () => {
    const { sim } = afterSetupTick({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
      aiSeats: [2],
      assistantSeats: [0, 2],
      fog: FOG_MODE.RECON,
      progression: false,
    });
    expect(sim.fogMode()).toBe(FOG_MODE.RECON);
    expect(sim.professionProgressionEnabled()).toBe(false);
    expect(components.isAiPlayer(sim.world, 2)).toBe(true);
    expect(components.isAiPlayer(sim.world, 1)).toBe(false);
    expect(sim.assistantGrants(0)).not.toEqual([]);
    expect(sim.assistantGrants(1)).toEqual([]);
  });

  it("leaves the world's own rules alone when no flag is set", () => {
    const { sim } = afterSetupTick({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
    });
    expect(sim.fogMode()).toBe(FOG_MODE.OFF);
    expect(sim.professionProgressionEnabled()).toBe(true);
    expect(sim.assistantGrants(0)).toEqual([]);
  });
});
