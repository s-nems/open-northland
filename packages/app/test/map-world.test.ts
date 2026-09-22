import { components, FOG_MODE, FOG_STATE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { buildMapWorld } from '../src/entries/map/world.js';
import { AUTHORED_ENTITIES, AUTHORED_ROWS } from './support/authored-entities.js';
import { authoredMapFile } from './support/world-maps.js';

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
  needs: null,
  missions: null,
} as const;

/** The authored join rows as a served IR document. Sound for these fixtures: the assembly reads the
 *  join lanes below plus the harvestable lanes, and this map places no objects. */
const AUTHORED_IR = AUTHORED_ROWS as ContentIr;

describe('buildMapWorld', () => {
  it.each([null, FOG_MODE.OFF, FOG_MODE.RECON_FOG_OF_WAR])(
    'starts enabled scripts under classic fog unless overridden (%s)',
    (fog) => {
      const { sim } = buildMapWorld({
        ...NO_SESSION_FLAGS,
        map: authoredMapFile(AUTHORED_ENTITIES),
        ir: AUTHORED_IR,
        script: { missions: { missions: [] }, participants: [0, 2] },
        missions: null,
        fog,
      });
      expect(sim.fogMode()).toBe(fog ?? FOG_MODE.CLASSIC);
      expect(sim.matchRules()).toEqual({ participants: [0, 2], victory: 'script' });
    },
  );

  it('keeps disabled scripts from changing fog and the elimination match defaults', () => {
    const { sim } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
      script: { missions: { missions: [] }, participants: [0, 2] },
      missions: false,
      matchParticipants: [1, 3],
    });
    expect(sim.fogMode()).toBe(FOG_MODE.OFF);
    expect(sim.matchRules()).toEqual({ participants: [1, 3], victory: 'elimination' });
  });

  it('lets an explicit empty participant fixture override the scripted roster', () => {
    const { sim } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
      script: { missions: { missions: [] }, participants: [0, 2] },
      missions: true,
      matchParticipants: [],
    });
    expect(sim.matchRules()).toEqual({ participants: [], victory: 'script' });
  });

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

  it.each(['authored', 'bare'] as const)(
    'initializes fog before the %s map can pause for briefing',
    (kind) => {
      const map = authoredMapFile(kind === 'authored' ? AUTHORED_ENTITIES : undefined);
      const { sim } = buildMapWorld({
        ...NO_SESSION_FLAGS,
        map: { ...map, width: 32, height: 32, typeIds: new Array(32 * 32).fill(map.typeIds[0]) },
        ir: AUTHORED_IR,
        fog: FOG_MODE.CLASSIC,
      });
      const fog = sim.fogView(0);
      expect(fog?.mode).toBe(FOG_MODE.CLASSIC);
      expect(fog?.stateAt(31, 31)).toBe(FOG_STATE.UNEXPLORED);
      if (kind === 'authored') expect(fog?.stateAt(4, 2)).toBe(FOG_STATE.VISIBLE);
    },
  );

  it('carries the session rules into the built world', () => {
    const { sim } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
      aiSeats: [2],
      assistantSeats: [0, 2],
      fog: FOG_MODE.RECON_FOG_OF_WAR,
      progression: false,
    });
    expect(sim.fogMode()).toBe(FOG_MODE.RECON_FOG_OF_WAR);
    expect(sim.professionProgressionEnabled()).toBe(false);
    expect(components.isAiPlayer(sim.world, 2)).toBe(true);
    expect(components.isAiPlayer(sim.world, 1)).toBe(false);
    expect(sim.assistantGrants(0)).not.toEqual([]);
    expect(sim.assistantGrants(1)).toEqual([]);
  });

  it("leaves the world's own rules alone when no flag is set", () => {
    const { sim } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
    });
    expect(sim.fogMode()).toBe(FOG_MODE.OFF);
    expect(sim.professionProgressionEnabled()).toBe(true);
    expect(sim.assistantGrants(0)).toEqual([]);
  });

  it("seeds the sim's diplomacy table from the script rows before the placement tick", () => {
    const { sim } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
      script: {
        diplomacy: [
          { from: 0, to: 1, state: 'friend' },
          { from: 1, to: 0, state: 'neutral' },
        ],
      },
    });
    expect(sim.diplomacyStance(0, 1)).toBe('friend');
    expect(sim.diplomacyStance(1, 0)).toBe('neutral');
    expect(sim.diplomacyStance(0, 2)).toBe('enemy'); // no roster: an unauthored pair keeps the hostile default
  });

  it('starts a roster pair the rows leave unset neutral, as the original loader does', () => {
    const seat = (player: number) => ({ player, type: 'ai' as const, tribeId: 1, colorId: player });
    const { sim } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
      playerRoster: [seat(0), seat(1), seat(2)],
      // The session's table: an authored row, then a lobby row.
      diplomacy: [
        { from: 0, to: 1, state: 'enemy' },
        { from: 2, to: 0, state: 'friend' },
      ],
    });
    expect(sim.diplomacyStance(0, 1)).toBe('enemy');
    expect(sim.diplomacyStance(2, 0)).toBe('friend');
    expect(sim.diplomacyStance(1, 0)).toBe('neutral');
    expect(sim.diplomacyStance(1, 2)).toBe('neutral');
    expect(sim.diplomacyStance(0, 2)).toBe('neutral');
    // A seat the roster never declares is not filled.
    expect(sim.diplomacyStance(0, 3)).toBe('enemy');
  });

  it("locks the pairs a map's relation rows make unchangeable or hide, before the first tick", () => {
    const { sim } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
      script: {
        relationFlags: [
          { kind: 'notChangeable', a: 0, b: 1 },
          { kind: 'hide', a: 2, b: 0 },
          { kind: 'hideDetails', a: 0, b: 3 },
        ],
      },
    });
    expect(sim.diplomacyLocked(1, 0)).toBe(true);
    expect(sim.diplomacyLocked(0, 2)).toBe(true);
    expect(sim.diplomacyLocked(0, 3)).toBe(false); // a closed page is the window's rule, not a lock
  });

  it('keeps every pair hostile when the map ships neither a roster nor diplomacy rows', () => {
    const { sim } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
    });
    expect(sim.diplomacyStance(0, 1)).toBe('enemy');
  });

  it("hands each player the script's starting papers, in authored order, before the placement tick", () => {
    const { sim } = buildMapWorld({
      ...NO_SESSION_FLAGS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
      specialItems: [
        { player: 0, kind: 2, param: 0 },
        { player: 1, kind: 3, param: 41 },
        { player: 0, kind: 3, param: 1 },
      ],
    });
    expect(sim.papers(0)).toEqual([
      { kind: 'placeAny', param: 0 },
      { kind: 'placeHouse', param: 1 },
    ]);
    expect(sim.papers(1)).toEqual([{ kind: 'placeHouse', param: 41 }]);
    expect(sim.papers(2)).toEqual([]);
  });
});
