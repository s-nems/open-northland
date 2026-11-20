import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, mapLobbySlots, TerrainMapFile } from '@open-northland/data';
import { NO_RULE_OVERRIDES, type PeaceMinutes } from '@open-northland/lockstep';
import {
  components,
  type Entity,
  hexDistanceBetween,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { buildMapWorld, type MapWorldOptions } from '../../../src/entries/map/world.js';
import { mapSession } from '../../../src/game/match/session-url.js';
import { sessionWorldOptions } from '../../../src/game/match/session-world.js';
import { mapScriptWorld } from '../../../src/game/world/mission-script.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from '../helpers.js';

const MAP_ID = 'specjalna_forteca';
/** The besieged fortress and its six raiding seats, all `HAI_Disable`d by the map. */
const FORTRESS = 6;
const RAIDERS = [7, 8, 9, 10, 11, 12];
const FORTRESS_SEATS = [FORTRESS, ...RAIDERS];
/** The vikings' computer allies, which the map leaves to the full strategic player. */
const ALLY_SEATS = [1, 2, 3, 4, 5];
/** The allies the lobby offers a person, set to computer by the search below; the rest are the map's own. */
const LOBBY_SEATS = [1, 2, 3];
/** The lobby peace the program test opens. */
const PEACE_MINUTES = 60;
/** Ticks covering every seat's first strategic decision. */
const FIRST_DECISIONS_TICKS = 48;
/** Rounds of the scripted handlers: one turn per seat per round, the assignment on even turns. */
const ROUND = systems.AI_HANDLER_ROUND_TICKS;
/** The fortress keep, where the map's default position and its Defend posts cluster. */
const KEEP = { x: 245, y: 247 };
/** The slot the mission script pulses on a raider seat to raise a wave, and the seat it pulses first. */
const RAISE_WAVE_SLOT = 5;
const FIRST_RAIDER = 7;
/** The first raider's authored objective: the vikings' headquarters east of the fortress. */
const OBJECTIVE = { x: 407, y: 263 };
/** The men the first wave brings: the seat's three CreateCreatures lines on the flag. */
const FIRST_WAVE = 5;
/** The person's seat, at war with the fortress, and the tribe of its men. */
const PERSON = 0;
const VIKING = 1;
/** The catapults the map stands in the keep, each with a man of the garrison beside it. */
const KEEP_CATAPULTS = 11;
/** Rounds enough for the keep's handler to crew its catapults and the men to step aboard. */
const CREW_ROUNDS = 3;
/** Where a lone viking stands from the first catapult: inside its firing band (map points). */
const RAIDER_DISTANCE = 16;
/** Ticks for the catapult to find the raider and loose its first stone at him. */
const SHOT_TICKS = 120;

async function fortressWorld(
  peace: PeaceMinutes | null = null,
): Promise<{ sim: Simulation; script: MapScript }> {
  const ir = rawIrUnderTest() as ContentIr;
  const { merge } = await loadContentUnderTest();
  const root = resolve(contentDir(), 'maps');
  const map = TerrainMapFile.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.json`), 'utf8')));
  const script = MapScript.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.script.json`), 'utf8')));
  const options: MapWorldOptions = {
    seed: 7,
    map,
    ir,
    content: { content: merge.content },
    machineSeats: [...ALLY_SEATS, ...FORTRESS_SEATS],
    peaceSeats: [PERSON, ...LOBBY_SEATS],
    assistantSeats: [0],
    script: mapScriptWorld(script, ir),
    ...NO_RULE_OVERRIDES,
    peace,
    missions: false,
    berryBushes: true,
  };
  return { sim: buildMapWorld(options).sim, script };
}

function programOf(sim: Simulation, seat: number) {
  const carrier = components.mapAiEntity(sim.world, seat);
  if (carrier === null) throw new Error(`seat ${seat} runs no program`);
  return sim.world.get(carrier, components.MapAiState);
}

function keepCatapults(sim: Simulation): Entity[] {
  return [...sim.world.query(components.Vehicle, components.Owner)].filter(
    (e) => sim.world.get(e, components.Owner).player === FORTRESS,
  );
}

/** The first walkable node `distance` map points from `from` on its continent, scanning row by row. */
function nodeAtDistance(sim: Simulation, from: { hx: number; hy: number }, distance: number) {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('the map world has no terrain');
  const continent = terrain.componentOf(terrain.nodeAt(from.hx, from.hy));
  for (let hy = from.hy - distance; hy <= from.hy + distance; hy++) {
    for (let hx = from.hx - 2 * distance; hx <= from.hx + 2 * distance; hx++) {
      if (!terrain.inBounds(hx, hy) || hexDistanceBetween(from.hx, from.hy, hx, hy) !== distance) continue;
      const node = terrain.nodeAt(hx, hy);
      if (terrain.isWalkable(node) && terrain.componentOf(node) === continent) return { hx, hy };
    }
  }
  throw new Error('no walkable node at that distance');
}

function ownedSoldiers(sim: Simulation, seat: number): number {
  let count = 0;
  for (const e of sim.world.query(components.Person, components.Owner, components.Settler)) {
    if (sim.world.get(e, components.Owner).player !== seat) continue;
    const jobType = sim.world.get(e, components.Settler).jobType;
    if (jobType !== null && systems.isFighterJob(sim.content, jobType)) count++;
  }
  return count;
}

describe.runIf(hasRealIr())('the fortress map’s authored AI seats', () => {
  it('seats every computer player from the search the lobby writes, which names the offered seats only', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const root = resolve(contentDir(), 'maps');
    const script = MapScript.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.script.json`), 'utf8')));
    const search = new URLSearchParams(`map=${MAP_ID}&player=0&computer=${LOBBY_SEATS.join(',')}`);
    const session = mapSession(search, mapLobbySlots(script));
    const { machineSeats, peaceSeats } = sessionWorldOptions(session, script, mapScriptWorld(script, ir));
    expect(machineSeats).toEqual([...ALLY_SEATS, ...FORTRESS_SEATS]);
    // The person and the seats it set to computer keep the match's peace; the map's own run their scripts.
    expect(peaceSeats).toEqual([PERSON, ...LOBBY_SEATS]);
  });

  it('leaves the fortress without a strategic brain and its allies with one, and carries the program', async () => {
    const { sim, script } = await fortressWorld(PEACE_MINUTES);
    expect(script.ai.map((row) => row.player)).toEqual(FORTRESS_SEATS);
    const fortress = script.ai.find((row) => row.player === FORTRESS);
    expect(fortress?.defaultPosition).toEqual({ ...KEEP, range: 70 });
    expect(fortress?.tasks.map((t) => t.kind)).toEqual([
      ...Array(11).fill('defend'),
      ...Array(3).fill('createCreatures'),
    ]);
    for (const seat of RAIDERS) {
      const row = script.ai.find((r) => r.player === seat);
      expect(row?.tasks.filter((t) => t.kind === 'attack')).toHaveLength(1);
      expect(row?.tasks.filter((t) => t.kind === 'createCreatures')).toHaveLength(12);
    }
    sim.step();
    for (const seat of [...ALLY_SEATS, ...FORTRESS_SEATS]) {
      expect(sim.atPeace(PERSON, seat), `seat ${seat}`).toBe(LOBBY_SEATS.includes(seat));
    }
    for (const seat of FORTRESS_SEATS) {
      expect(components.isMachinePlayer(sim.world, seat)).toBe(true);
      expect(
        components.COMPUTER_MODULE_IDS.some((id) => components.computerModuleRuns(sim.world, seat, id)),
      ).toBe(false);
    }
    for (const seat of ALLY_SEATS) {
      expect(
        components.COMPUTER_MODULE_IDS.every((id) => components.computerModuleRuns(sim.world, seat, id)),
      ).toBe(true);
    }
    // The fortress mans its towers but raises no campaign: the raid on the besiegers is the strategic
    // module the map switched off.
    sim.run(FIRST_DECISIONS_TICKS);
    const fortressOrders = sim.commands.log.filter(
      (entry) => entry.origin === 'ai' && FORTRESS_SEATS.includes(entry.player),
    );
    expect(fortressOrders.some((entry) => entry.command.kind === 'assignWorker')).toBe(true);
    expect(fortressOrders.some((entry) => entry.command.kind === 'placeBuilding')).toBe(false);
  }, 60_000);

  it('posts the garrison on its Defend lines and keeps every walk inside the fortress', async () => {
    const { sim, script } = await fortressWorld();
    sim.run(3 * ROUND);
    const program = programOf(sim, FORTRESS);
    // Six posts of ten and five of three claim their nearest men before towers and fallback guards.
    expect(program.soldiers.filter((s) => s.task !== null)).toHaveLength(75);
    expect(program.soldiers.filter((s) => s.onDefault).length).toBeGreaterThan(0);
    const walks = sim.commands.log.filter(
      (entry) =>
        entry.origin === 'ai' && entry.player === FORTRESS && entry.command.kind === 'attackMoveUnit',
    );
    const posts = script.ai.find((row) => row.player === FORTRESS)?.tasks;
    if (posts === undefined) throw new Error('missing fortress posts');
    // The nearest men already stand within their posts: holding a line needs no new march.
    for (const record of program.soldiers) {
      if (record.task === null) continue;
      const post = posts[record.task];
      if (post?.kind !== 'defend') throw new Error('unexpected fortress soldier task');
      const at = sim.world.get(record.entity, components.Position);
      const node = nodeOfPosition(at.x, at.y);
      expect(hexDistanceBetween(node.hx, node.hy, post.x, post.y)).toBeLessThan(post.range / 2);
      expect(sim.world.get(record.entity, components.Stance).mode).toBe(systems.MILITARY_MODE.DEFEND);
    }
    for (const entry of walks) {
      const { command } = entry;
      if (command.kind !== 'attackMoveUnit') continue;
      expect(hexDistanceBetween(command.x, command.y, KEEP.x, KEEP.y)).toBeLessThan(70);
    }
    // No raider has a man yet: their waves come with the mission script's flag.
    for (const seat of RAIDERS) expect(ownedSoldiers(sim, seat)).toBe(0);
  }, 120_000);

  it('raises a raider’s wave at the keep on the script’s flag and marches it on the vikings’ base', async () => {
    const { sim } = await fortressWorld();
    sim.run(ROUND);
    components.setAiExternalFlag(sim.world, FIRST_RAIDER, RAISE_WAVE_SLOT, true);
    sim.run(ROUND);
    expect(ownedSoldiers(sim, FIRST_RAIDER)).toBe(FIRST_WAVE);
    components.setAiExternalFlag(sim.world, FIRST_RAIDER, RAISE_WAVE_SLOT, false);
    sim.run(3 * ROUND);
    expect(ownedSoldiers(sim, FIRST_RAIDER)).toBe(FIRST_WAVE);
    // No viking soldier stands near the keep and the vikings' headquarters stands near the objective,
    // so the Attack line holds and the whole wave takes it.
    const program = programOf(sim, FIRST_RAIDER);
    expect(program.soldiers.map((s) => s.task)).toEqual(Array(FIRST_WAVE).fill(0));
    const marches = sim.commands.log.filter(
      (entry) =>
        entry.origin === 'ai' &&
        entry.player === FIRST_RAIDER &&
        entry.command.kind === 'attackMoveUnit' &&
        hexDistanceBetween(entry.command.x, entry.command.y, OBJECTIVE.x, OBJECTIVE.y) < 5,
    );
    expect(marches.length).toBeGreaterThanOrEqual(FIRST_WAVE);
  }, 120_000);

  it('crews the keep’s catapults with the men beside them, and they shell a raider in reach', async () => {
    const { sim } = await fortressWorld();
    const catapults = keepCatapults(sim);
    expect(catapults).toHaveLength(KEEP_CATAPULTS);
    sim.run(CREW_ROUNDS * ROUND);
    for (const e of catapults) {
      const state = sim.world.get(e, components.Vehicle);
      expect(components.vehicleCommander(state), `catapult ${e}`).not.toBeNull();
      expect(components.vehiclePassengers(state).every((seat) => seat.inside)).toBe(true);
      expect(state.stance).toBe('hold');
    }
    const first = catapults[0];
    if (first === undefined) throw new Error('no catapult');
    const at = sim.world.get(first, components.Position);
    const spot = nodeAtDistance(sim, nodeOfPosition(at.x, at.y), RAIDER_DISTANCE);
    const swordsman = sim.content.jobs.find((job) => job.id === 'soldier_sword_short')?.typeId;
    if (swordsman === undefined) throw new Error('no swordsman job');
    const before = new Set(sim.world.query(components.Settler));
    // Invulnerable, the raider outlives the garrison's first blows; passive, he stays where he stands.
    const { INVULNERABLE, PASSIVE } = components.MISSION_BEHAVIOUR;
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: swordsman,
      x: spot.hx,
      y: spot.hy,
      tribe: VIKING,
      owner: PERSON,
      behaviourFlags: INVULNERABLE | PASSIVE,
    });
    sim.step();
    if ([...sim.world.query(components.Settler)].every((e) => before.has(e))) {
      throw new Error('the raider did not spawn');
    }
    // A catapult's stone is loosed by its commander.
    const commanders = catapults.map((e) =>
      components.vehicleCommander(sim.world.get(e, components.Vehicle)),
    );
    let shot = false;
    for (let t = 0; t < SHOT_TICKS && !shot; t++) {
      sim.step();
      for (const e of sim.world.query(components.Projectile)) {
        if (commanders.includes(sim.world.get(e, components.Projectile).source)) shot = true;
      }
    }
    expect(shot).toBe(true);
  }, 120_000);
});
