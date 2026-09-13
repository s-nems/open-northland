import { describe, expect, it } from 'vitest';
import {
  Building,
  JobAssignment,
  Owner,
  Position,
  Stockpile,
  setPlayerPlacementTribes,
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
  Simulation,
  setupCommand,
} from '../../../src/index.js';
import { isAuthorized } from '../../../src/systems/command/authority.js';
import { testContent } from '../../fixtures/content.js';
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
      expect(isAuthorized(sim.world, playerCommand(MINE, command)), command.kind).toBe(false);
      expect(isAuthorized(sim.world, adminCommand(command)), command.kind).toBe(true);
    }

    const attack: PlayerCommand = { kind: 'attackUnit', entity: mine, target: theirs };
    expect(isAuthorized(sim.world, playerCommand(MINE, attack))).toBe(true);
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
});
