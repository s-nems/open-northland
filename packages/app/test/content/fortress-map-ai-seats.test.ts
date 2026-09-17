import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, mapLobbySlots, TerrainMapFile } from '@open-northland/data';
import { components, hexDistanceBetween, type Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorld, type MapWorldOptions } from '../../src/entries/map/world.js';
import { mapSession } from '../../src/game/session-url.js';
import { sessionWorldOptions } from '../../src/game/session-world.js';
import { mapScriptWorld } from '../../src/game/world/mission-script.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

const MAP_ID = 'specjalna_forteca';
/** The besieged fortress and its six raiding seats, all `HAI_Disable`d by the map. */
const FORTRESS = 6;
const RAIDERS = [7, 8, 9, 10, 11, 12];
const FORTRESS_SEATS = [FORTRESS, ...RAIDERS];
/** The vikings' computer allies, which the map leaves to the full strategic player. */
const ALLY_SEATS = [1, 2, 3, 4, 5];
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

async function fortressWorld(): Promise<{ sim: Simulation; script: MapScript }> {
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
    aiSeats: [...ALLY_SEATS, ...FORTRESS_SEATS],
    assistantSeats: [0],
    script: mapScriptWorld(script, ir),
    fog: null,
    progression: null,
    needs: null,
    missions: false,
    berryBushes: true,
  };
  return { sim: buildMapWorld(options).sim, script };
}

function programOf(
  sim: Simulation,
  seat: number,
): { soldiers: readonly { task: number | null; onDefault: boolean }[] } {
  const carrier = components.aiProgramEntity(sim.world, seat);
  if (carrier === null) throw new Error(`seat ${seat} runs no program`);
  return sim.world.get(carrier, components.AiProgram);
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
    const search = new URLSearchParams(`map=${MAP_ID}&player=0&ai=1,2,3`);
    const session = mapSession(search, mapLobbySlots(script));
    const { aiSeats } = sessionWorldOptions(session, script, mapScriptWorld(script, ir));
    expect(aiSeats).toEqual([...ALLY_SEATS, ...FORTRESS_SEATS]);
  });

  it('leaves the fortress without a strategic brain and its allies with one, and carries the program', async () => {
    const { sim, script } = await fortressWorld();
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
    for (const seat of FORTRESS_SEATS) {
      expect(components.isAiPlayer(sim.world, seat)).toBe(true);
      expect(components.AI_MODULE_IDS.some((id) => components.aiModuleRuns(sim.world, seat, id))).toBe(false);
    }
    for (const seat of ALLY_SEATS) {
      expect(components.AI_MODULE_IDS.every((id) => components.aiModuleRuns(sim.world, seat, id))).toBe(true);
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
    const { sim } = await fortressWorld();
    sim.run(3 * ROUND);
    const program = programOf(sim, FORTRESS);
    // Six posts of ten and five of three, filled from the men the towers did not take; the rest hold
    // the keep.
    expect(program.soldiers.filter((s) => s.task !== null)).toHaveLength(75);
    expect(program.soldiers.filter((s) => s.onDefault).length).toBeGreaterThan(0);
    const walks = sim.commands.log.filter(
      (entry) =>
        entry.origin === 'ai' && entry.player === FORTRESS && entry.command.kind === 'attackMoveUnit',
    );
    expect(walks.length).toBeGreaterThan(0);
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
});
