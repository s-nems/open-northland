import { adminCommand, components, type Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapScript, realMapSessionWorld } from './real-map-world.js';

/** Every corpus map that ships `[misc_multiplayer_goals]`, plain or packed, with the rows it authors. */
const CORPUS_TABLES: Readonly<Record<string, readonly string[]>> = {
  battle_for_the_four_hills_multiplayer: ['wonByMission'],
  ciezka_wspolpraca: ['wonByMission'],
  flagomania_1_0_01: [],
  krol_przeleczy: [],
  multiplayer_201_special_coop: ['wonByMission'],
  oczy_weza: ['wonByMission'],
  specjalna_forteca: ['wonByMission'],
  specjalna_mosty_na_rzece: ['wonByMission'],
  ucieczka_z_gazy: ['wonByMission'],
  w_oku_niepewnosci: [],
  wody_nilu: [],
  wyspa_lupiezcow: [],
  zgielk2: ['wonByMission'],
};

const RED = 1;
const BLUE = 0;

function killSeat(sim: Simulation, player: number): void {
  for (const entity of sim.world.query(components.Person, components.Owner)) {
    if (sim.world.get(entity, components.Owner).player === player) {
      sim.enqueue(adminCommand({ kind: 'debugKill', target: entity }));
    }
  }
}

/** Step until `player` has a verdict, returning the tick it landed on; throws past `limit`. */
function verdictTick(sim: Simulation, player: number, limit: number): number {
  while (sim.tick < limit) {
    sim.step();
    if (sim.matchOutcome(player) !== 'undecided') return sim.tick;
  }
  throw new Error(`no verdict for seat ${player} by tick ${limit}`);
}

describe.runIf(hasRealIr())('multiplayer goal tables', () => {
  it('decodes each corpus table', () => {
    for (const [mapId, kinds] of Object.entries(CORPUS_TABLES)) {
      expect(
        realMapScript(mapId)?.multiplayerGoals?.map((goal) => goal.kind),
        mapId,
      ).toEqual(kinds);
    }
  });

  it("wins Oczy Weza through its script's verdict, read at the next goal check", async () => {
    const sim = await realMapSessionWorld(`map=oczy_weza&ai=${RED}`);
    sim.step();
    expect(sim.matchRules()).toMatchObject({ victory: 'goals', lastStanding: false });
    expect(sim.matchRules().participants).toEqual(expect.arrayContaining([BLUE, RED]));
    killSeat(sim, RED);
    const limit = 4 * systems.MATCH_GOAL_CHECK_TICKS + systems.MATCH_DEATH_GRACE_TICKS;
    const won = verdictTick(sim, BLUE, limit);
    expect(sim.matchOutcome(BLUE)).toBe('victory');
    expect(sim.matchOutcome(RED)).toBe('defeat');
    expect(won % systems.MATCH_GOAL_CHECK_TICKS).toBe(0);
  }, 60_000);
});
