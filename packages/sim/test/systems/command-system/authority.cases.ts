import { describe, expect, it } from 'vitest';
import {
  Building,
  JobAssignment,
  MISSION_BEHAVIOUR,
  Owner,
  Palisade,
  Position,
  Stockpile,
  setPlayerPlacementTribes,
  stampMissionBehaviour,
  UnderConstruction,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  adminCommand,
  aiCommand,
  type Command,
  type CommandEnvelope,
  type PlayerCommand,
  parseCommandEnvelope,
  playerCommand,
  type ScriptLandscapeType,
  Simulation,
  setupCommand,
} from '../../../src/index.js';
import { authorizedCommand } from '../../../src/systems/command/authority.js';
import { testContent } from '../../fixtures/content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { fresh, HEADQUARTERS, nthEntity, SAWMILL, VIKING, WOODCUTTER } from './support.js';

/** The fixture HQ declares three woodcutter slots, so a spawned woodcutter qualifies for one. */
const HQ_JOBS = [WOODCUTTER];

const MINE = 0;
const THEIRS = 1;

/** A settler owned by `player`, standing at a free node. */
function settlerFor(sim: Simulation, player: number, x: number): Entity {
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x, y: 0, tribe: VIKING, owner: player });
  sim.step();
  return nthEntity(sim, [...sim.world.query(Position)].length - 1);
}

/** A bare entity carrying only an `Owner`, for gate checks that never reach a handler. */
function ownedEntity(sim: Simulation, player: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Owner, { player });
  return e;
}

function buildingFor(sim: Simulation, player: number | undefined, x: number): Entity {
  const own = player === undefined ? {} : { owner: player };
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x, y: 4, tribe: VIKING, ...own });
  sim.step();
  return nthEntity(sim, [...sim.world.query(Position)].length - 1);
}

describe('CommandSystem - command authority', () => {
  it('refuses a seat order aimed at another player`s unit', () => {
    const sim = fresh();
    const theirUnit = settlerFor(sim, THEIRS, 2);
    const before = sim.world.get(theirUnit, Position);

    sim.enqueue(playerCommand(MINE, { kind: 'moveUnit', entity: theirUnit, x: 20, y: 20 }));
    sim.step();

    expect(sim.world.get(theirUnit, Position)).toEqual(before);
    expect(sim.commands.log).toHaveLength(2); // spawn + the refused order, both logged for replay
  });

  it('refuses a seat order aimed at a neutral unit', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 2, y: 0, tribe: VIKING });
    sim.step();
    const wild = nthEntity(sim, 0);
    const before = sim.world.get(wild, Position);

    sim.enqueue(playerCommand(MINE, { kind: 'moveUnit', entity: wild, x: 20, y: 20 }));
    sim.step();

    expect(sim.world.get(wild, Position)).toEqual(before);
  });

  it('refuses employing another player`s settler and posting to another player`s workplace', () => {
    const sim = fresh();
    const mine = settlerFor(sim, MINE, 2);
    const theirs = settlerFor(sim, THEIRS, 3);
    const myShop = buildingFor(sim, MINE, 8);
    const theirShop = buildingFor(sim, THEIRS, 16);

    sim.enqueue(
      playerCommand(MINE, { kind: 'assignWorker', entity: theirs, building: myShop, jobPriority: HQ_JOBS }),
    );
    sim.enqueue(
      playerCommand(MINE, { kind: 'assignWorker', entity: mine, building: theirShop, jobPriority: HQ_JOBS }),
    );
    sim.step();

    expect(sim.world.has(theirs, JobAssignment)).toBe(false);
    expect(sim.world.has(mine, JobAssignment)).toBe(false);

    // The same order on the seat's own pair binds, so the two refusals above are the authority gate
    // and not a staffing rule refusing the assignment for its own reasons.
    sim.enqueue(
      playerCommand(MINE, { kind: 'assignWorker', entity: mine, building: myShop, jobPriority: HQ_JOBS }),
    );
    sim.step();
    expect(sim.world.get(mine, JobAssignment).workplace).toBe(myShop);
  });

  it('applies a group order to the members the seat commands and skips the rest', () => {
    const sim = fresh();
    const mine = settlerFor(sim, MINE, 2);
    const theirs = settlerFor(sim, THEIRS, 3);
    const locked = settlerFor(sim, MINE, 4);
    const fallen = settlerFor(sim, MINE, 5);
    stampMissionBehaviour(sim.world, locked, MISSION_BEHAVIOUR.NOT_CONTROLLABLE);
    const myShop = buildingFor(sim, MINE, 8);
    sim.enqueue(adminCommand({ kind: 'debugKill', target: fallen }));
    sim.step();
    const order: PlayerCommand = {
      kind: 'assignWorkerGroup',
      building: myShop,
      members: [mine, theirs, locked, fallen].map((entity) => ({ entity, jobPriority: HQ_JOBS })),
    };

    expect(authorizedCommand(sim.world, playerCommand(MINE, order))).toMatchObject({
      members: [{ entity: mine }],
    });
    // The seat's AI still commands a unit a script put beyond the player's reach.
    expect(authorizedCommand(sim.world, aiCommand(MINE, order))).toMatchObject({
      members: [{ entity: mine }, { entity: locked }],
    });

    sim.enqueue(playerCommand(MINE, order));
    sim.step();
    expect(sim.world.get(mine, JobAssignment).workplace).toBe(myShop);
    expect(sim.world.has(theirs, JobAssignment)).toBe(false);
    expect(sim.world.has(locked, JobAssignment)).toBe(false);
  });

  it('lets a seat post its own unit to a neutral workplace', () => {
    const sim = fresh();
    const mine = settlerFor(sim, MINE, 2);
    const neutralShop = buildingFor(sim, undefined, 8);

    sim.enqueue(
      playerCommand(MINE, {
        kind: 'assignWorker',
        entity: mine,
        building: neutralShop,
        jobPriority: HQ_JOBS,
      }),
    );
    sim.step();

    expect(sim.world.get(mine, JobAssignment).workplace).toBe(neutralShop);
  });

  it('refuses a seat placement owned by another player and defaults an omitted owner to the seat', () => {
    const sim = fresh();
    setPlayerPlacementTribes(sim.world, sim.content, MINE, [VIKING]);
    sim.enqueue(
      playerCommand(MINE, {
        kind: 'placeBuilding',
        buildingType: HEADQUARTERS,
        x: 2,
        y: 2,
        tribe: VIKING,
        owner: THEIRS,
      }),
    );
    sim.step();
    expect([...sim.world.query(Building)]).toEqual([]);

    sim.enqueue(
      playerCommand(MINE, { kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 2, y: 2, tribe: VIKING }),
    );
    sim.step();
    const placed = [...sim.world.query(Building)][0];
    if (placed === undefined) throw new Error('missing placed building');
    expect(sim.world.get(placed, Owner)).toEqual({ player: MINE });
    // The log carries the resolved owner, so a replay of it places the same building.
    expect(sim.commands.log[1]).toMatchObject({ origin: 'player', command: { owner: MINE } });
  });

  it('refuses a rules change, a world edit, and a forced placement from a seat', () => {
    const sim = fresh();
    // Each is unrepresentable in a typed seat envelope; an imported or untyped payload still reaches
    // the gate, so the runtime rule is what an imported log is held to.
    const cheats: readonly Command[] = [
      { kind: 'setNeedsEnabled', enabled: false },
      { kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING, owner: MINE },
      {
        kind: 'placeBuilding',
        buildingType: HEADQUARTERS,
        x: 4,
        y: 4,
        tribe: VIKING,
        owner: MINE,
        force: true,
      },
    ];
    for (const command of cheats) {
      sim.enqueue({ v: 1, origin: 'player', player: MINE, command } as unknown as CommandEnvelope);
    }
    sim.step();

    expect(sim.world.canonicalEntities()).toEqual([]);
    expect(sim.commands.log).toHaveLength(cheats.length);
  });

  it('places seat buildings as construction sites and rejects instant completion', () => {
    const content = testContent();
    const sim = new Simulation({
      seed: 1,
      content: {
        ...content,
        buildings: content.buildings.map((building) =>
          building.typeId === SAWMILL
            ? { ...building, construction: [{ goodType: 1, amount: 5 }] }
            : building,
        ),
      },
    });
    setPlayerPlacementTribes(sim.world, sim.content, MINE, [VIKING]);
    const placement = { kind: 'placeBuilding' as const, buildingType: SAWMILL, x: 4, y: 4, tribe: VIKING };
    sim.enqueue(playerCommand(MINE, { ...placement, underConstruction: false }));
    sim.step();
    expect([...sim.world.query(Building)]).toEqual([]);

    sim.enqueue(playerCommand(MINE, placement));
    sim.step();
    const building = [...sim.world.query(Building)][0];
    if (building === undefined) throw new Error('missing construction site');
    expect(sim.world.has(building, UnderConstruction)).toBe(true);
    expect(sim.world.get(building, Stockpile).amounts.size).toBe(0);
    expect(sim.commands.log[1]?.command).toMatchObject({ underConstruction: true, owner: MINE });
  });

  it.each(['player', 'ai'])('refuses mission object ids in an imported %s placement', (origin) => {
    const sim = fresh();
    const command = {
      kind: 'placeBuilding',
      buildingType: HEADQUARTERS,
      x: 2,
      y: 2,
      tribe: VIKING,
      owner: MINE,
      missionId: 42,
    };
    sim.enqueue(parseCommandEnvelope({ v: 1, origin, player: MINE, command }));
    sim.step();
    expect([...sim.world.query(Building)]).toEqual([]);
    expect(sim.commands.log).toHaveLength(1);
  });

  it('holds an AI seat to the same rule as a human seat', () => {
    const sim = fresh();
    const theirUnit = settlerFor(sim, THEIRS, 2);
    const before = sim.world.get(theirUnit, Position);

    sim.enqueue(aiCommand(MINE, { kind: 'moveUnit', entity: theirUnit, x: 20, y: 20 }));
    sim.step();

    expect(sim.world.get(theirUnit, Position)).toEqual(before);
  });

  it('lets the admin channel command any seat`s unit', () => {
    const sim = fresh();
    const theirUnit = settlerFor(sim, THEIRS, 2);

    sim.enqueue(adminCommand({ kind: 'setJob', entity: theirUnit, jobType: WOODCUTTER }));
    sim.step();

    expect(sim.commands.log[1]).toMatchObject({ origin: 'admin' });
  });

  it('holds every asset key to the seat and leaves an attack target free', () => {
    // One case per key `assetTargetOf` reads, checked on the gate directly: a workplace, a build site,
    // a home or garrison, and a signpost owned by another player are all out of reach, while the unit
    // an attack names is deliberately not an asset.
    const sim = fresh();
    const mine = ownedEntity(sim, MINE);
    const theirs = ownedEntity(sim, THEIRS);
    const refused: readonly PlayerCommand[] = [
      { kind: 'assignWorker', entity: mine, building: theirs, jobPriority: HQ_JOBS },
      { kind: 'assignBuilder', entity: mine, site: theirs },
      { kind: 'assignHouse', entity: mine, house: theirs },
      { kind: 'trainSoldier', entity: mine, house: theirs },
      { kind: 'setDefenceMode', building: theirs, enabled: true },
      { kind: 'demolish', building: theirs },
      { kind: 'upgradeBuilding', building: theirs },
      { kind: 'cancelUpgrade', building: theirs },
      { kind: 'demolishSignpost', signpost: theirs },
    ];
    for (const command of refused) {
      expect(authorizedCommand(sim.world, playerCommand(MINE, command)), command.kind).toBeUndefined();
      expect(authorizedCommand(sim.world, adminCommand(command)), command.kind).toBeDefined();
    }

    const attack: PlayerCommand = { kind: 'attackUnit', entity: mine, target: theirs };
    expect(authorizedCommand(sim.world, playerCommand(MINE, attack))).toBe(attack);
  });

  it('keeps the queued and logged envelope owned, not aliased to the caller`s object', () => {
    const sim = fresh();
    const source = { kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 2, y: 2, tribe: VIKING } as const;
    const mutable: { kind: 'placeBuilding'; buildingType: number; x: number; y: number; tribe: number } = {
      ...source,
    };
    sim.enqueue(setupCommand(mutable));
    mutable.buildingType = SAWMILL;
    mutable.x = 40;
    sim.step();

    expect(sim.commands.log[0]?.command).toMatchObject({ buildingType: HEADQUARTERS, x: 2 });
    expect(sim.world.get(nthEntity(sim, 0), Building).buildingType).toBe(HEADQUARTERS);
  });

  it('numbers the log strictly ascending in (applyTick, sequence) across origins', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING, owner: MINE });
    sim.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: false }));
    sim.step();
    sim.enqueue(playerCommand(MINE, { kind: 'moveUnit', entity: nthEntity(sim, 0), x: 3, y: 0 }));
    sim.step();

    expect(sim.commands.log.map((e) => [e.applyTick, e.sequence, e.origin])).toEqual([
      [1, 0, 'setup'],
      [1, 1, 'admin'],
      [2, 2, 'player'],
    ]);
  });

  describe('walls', () => {
    const WALL_ROW = 691;
    const GATE_ROW = 696;
    const OPEN_GATE_ROW = 700;
    const WOOD_GOOD = 5;
    const post = { dx: 0, dy: 0 };
    const span = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));
    const wallRow = (
      typeId: number,
      walk: { dx: number; dy: number }[],
      gate?: { open: boolean; counterpartGfxIndex: number },
    ): ScriptLandscapeType => ({
      typeId,
      walk,
      build: walk,
      groups: [],
      wall: {
        maxHitpoints: 100,
        repairPerStrike: 1,
        construction: [{ goodType: WOOD_GOOD, amount: 1 }],
        ...(gate === undefined ? {} : { gate }),
      },
    });
    const ROWS = [
      wallRow(WALL_ROW, [post]),
      wallRow(GATE_ROW, span, { open: false, counterpartGfxIndex: OPEN_GATE_ROW }),
      wallRow(OPEN_GATE_ROW, [span[0] ?? post, span[4] ?? post], {
        open: true,
        counterpartGfxIndex: GATE_ROW,
      }),
    ];

    function walled(): Simulation {
      const base = grassNodeMap(24, 24);
      const sim = new Simulation({
        seed: 1,
        content: testContent(),
        map: { ...base, landscapes: { types: ROWS, placements: [] } },
      });
      setPlayerPlacementTribes(sim.world, sim.content, MINE, [VIKING]);
      return sim;
    }

    function standingWall(
      sim: Simulation,
      owner: number | undefined,
      x: number,
      gfxIndex = WALL_ROW,
    ): Entity {
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex,
        x,
        y: 12,
        tribe: VIKING,
        ...(owner === undefined ? {} : { owner }),
      });
      sim.step();
      const wall = [...sim.world.query(Palisade)].sort((a, b) => b - a)[0];
      if (wall === undefined) throw new Error('expected a wall');
      return wall;
    }

    it('keeps a seat off a foreign or neutral wall and gate, and on its own', () => {
      const sim = walled();
      for (const owner of [THEIRS, undefined]) {
        const wall = standingWall(sim, owner, owner === undefined ? 4 : 10);
        const gate = standingWall(sim, owner, owner === undefined ? 16 : 20, GATE_ROW);
        const refused: readonly PlayerCommand[] = [
          { kind: 'demolishPalisade', palisade: wall },
          { kind: 'convertPalisadeGate', palisade: wall, gfxIndex: GATE_ROW },
          { kind: 'setPalisadeGate', palisade: gate, open: true },
        ];
        for (const command of refused) {
          expect(authorizedCommand(sim.world, playerCommand(MINE, command)), command.kind).toBeUndefined();
          expect(authorizedCommand(sim.world, adminCommand(command)), command.kind).toBeDefined();
        }
      }
      const mine = standingWall(sim, MINE, 7);
      const demolish: PlayerCommand = { kind: 'demolishPalisade', palisade: mine };
      expect(authorizedCommand(sim.world, playerCommand(MINE, demolish))).toBe(demolish);
    });

    it('refuses a seat the authored wall options', () => {
      const sim = walled();
      const place = { kind: 'placePalisade', gfxIndex: WALL_ROW, x: 6, y: 6, tribe: VIKING } as const;
      const cheats = [
        { ...place, force: true },
        { ...place, valency: 40 },
        { ...place, underConstruction: false },
      ];
      for (const command of cheats) {
        sim.enqueue(parseCommandEnvelope({ v: 1, origin: 'player', player: MINE, command }));
      }
      sim.step();
      expect([...sim.world.query(Palisade)]).toEqual([]);

      sim.enqueue(playerCommand(MINE, place));
      sim.step();
      const [site] = [...sim.world.query(Palisade)];
      if (site === undefined) throw new Error('expected a wall site');
      expect(sim.world.has(site, UnderConstruction)).toBe(true);
      expect(sim.world.get(site, Owner)).toEqual({ player: MINE });
    });

    it('refuses a seat a gate row on open ground, which a map may still stand', () => {
      const sim = walled();
      const gate = { kind: 'placePalisade', gfxIndex: GATE_ROW, x: 12, y: 6, tribe: VIKING } as const;
      sim.enqueue(playerCommand(MINE, gate));
      sim.step();
      expect([...sim.world.query(Palisade)]).toEqual([]);

      sim.enqueueSetup({ ...gate, owner: MINE });
      sim.step();
      expect([...sim.world.query(Palisade)]).toHaveLength(1);
    });
  });
});
