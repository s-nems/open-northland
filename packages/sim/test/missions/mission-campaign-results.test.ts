import { describe, expect, it } from 'vitest';
import { HouseLandscapeOverlays, MissionCampaign, missionRecords } from '../../src/components/index.js';
import type { Simulation } from '../../src/index.js';
import type { MissionResultOp } from '../../src/systems/missions/index.js';
import {
  firingMission,
  firingSim,
  HUT,
  houseContent,
  LOAD_PASS,
  missionSim,
  PASS_TICKS,
  POINT,
  roundTrip,
  stamped,
  VIKING,
} from './support.js';

const UNLOCK: MissionResultOp = { opcode: 'AllowMap', campaignId: 4, mapId: 20 };
const VIDEO: MissionResultOp = { opcode: 'Mission quit and play video', amount: 2 };
const HOUSE_ID = 17;
const SET_HOUSE: MissionResultOp = {
  opcode: 'SetHouse',
  player: 0,
  houseName: { typeId: HUT, tribe: VIKING },
  level: 0,
  built: true,
  point: POINT,
  objectId: HOUSE_ID,
};

function campaignState(sim: Simulation) {
  const entity = sim.world.lowestEntityWith(MissionCampaign);
  if (entity === null) throw new Error('Expected campaign output');
  return sim.world.get(entity, MissionCampaign);
}

describe('campaign result output', () => {
  it('grants each campaign/map pair once and retains grants through save/load', () => {
    const sim = firingSim([UNLOCK, UNLOCK, { ...UNLOCK, campaignId: 5 }]);
    sim.run(LOAD_PASS);
    expect(campaignState(sim).unlockedMaps).toEqual([
      { campaignId: 4, mapId: 20 },
      { campaignId: 5, mapId: 20 },
    ]);
    expect(sim.events.current().filter((event) => event.kind === 'missionCampaignUnlock')).toHaveLength(2);
    const restored = roundTrip(sim);
    expect(campaignState(restored)).toEqual(campaignState(sim));
    expect(restored.events.current().filter((event) => event.kind === 'missionCampaignUnlock')).toEqual([]);
  });

  it('does not resend an unlock after a looping trigger is restored', () => {
    const sim = firingSim([UNLOCK, { opcode: 'ActivateMission', missionIndex: 0 }]);
    sim.run(LOAD_PASS);
    const restored = roundTrip(sim);
    sim.run(PASS_TICKS);
    restored.run(PASS_TICKS);
    expect(restored.hashState()).toBe(sim.hashState());
    expect(campaignState(restored).unlockedMaps).toHaveLength(1);
    expect(restored.events.current().filter((event) => event.kind === 'missionCampaignUnlock')).toEqual([]);
  });

  it('keeps an unlock when the same mission immediately leaves for a submap', () => {
    const sim = firingSim([UNLOCK, { opcode: 'StartSubMission', campaignId: 4, mapId: 21 }]);
    sim.run(LOAD_PASS);
    expect(campaignState(sim).unlockedMaps).toHaveLength(1);
    expect(
      sim.events
        .current()
        .filter((event) => event.kind === 'missionCampaignUnlock' || event.kind === 'missionSubMission')
        .map((event) => event.kind),
    ).toEqual(['missionCampaignUnlock', 'missionSubMission']);
    expect(campaignState(roundTrip(sim))).toEqual(campaignState(sim));
  });

  it('requests the movie without dropping later results or triggers in the pass', () => {
    const sim = missionSim([
      firingMission([UNLOCK, VIDEO, { opcode: 'AllowMap', campaignId: 4, mapId: 30 }]),
      firingMission([{ opcode: 'AllowMap', campaignId: 4, mapId: 40 }]),
    ]);
    sim.run(LOAD_PASS);
    expect(campaignState(sim)).toEqual({
      unlockedMaps: [
        { campaignId: 4, mapId: 20 },
        { campaignId: 4, mapId: 30 },
        { campaignId: 4, mapId: 40 },
      ],
      video: 2,
    });
    expect(missionRecords(sim.world)[1]?.fireCount).toBe(1);
    expect(sim.events.current().filter((event) => event.kind === 'missionVideo')).toEqual([
      { kind: 'missionVideo', sequence: 2 },
    ]);
    expect(campaignState(roundTrip(sim))).toEqual(campaignState(sim));
  });

  it('reports invalid identifiers without creating campaign state', () => {
    const sim = firingSim([
      { ...UNLOCK, mapId: -1 },
      { ...VIDEO, amount: -1 },
    ]);
    sim.run(LOAD_PASS);
    expect(sim.world.lowestEntityWith(MissionCampaign)).toBeNull();
    expect(
      sim.events
        .current()
        .filter((event) => event.kind === 'missionResultFailed')
        .map((event) => event.opcode),
    ).toEqual(['AllowMap', 'Mission quit and play video']);
  });
});

describe('SetHouseOverlayState', () => {
  const overlay = (extra: number, flag: boolean, objectId = HOUSE_ID): MissionResultOp => ({
    opcode: 'SetHouseOverlayState',
    objectId,
    extra,
    flag,
  });

  it('preserves independent slots and explicit off overrides across save/load', () => {
    const sim = firingSim(
      [SET_HOUSE, overlay(0, true), overlay(6, true), overlay(0, false), overlay(9, false)],
      houseContent(),
    );
    sim.run(LOAD_PASS);
    const state = sim.world.get(stamped(sim, HOUSE_ID), HouseLandscapeOverlays);
    expect([...state.slots]).toEqual([
      [0, false],
      [6, true],
      [9, false],
    ]);
    const restored = roundTrip(sim);
    expect(restored.world.get(stamped(restored, HOUSE_ID), HouseLandscapeOverlays)).toEqual(state);
  });

  it('updates all houses with the object id without sharing mutable slot maps', () => {
    const sim = firingSim(
      [SET_HOUSE, { ...SET_HOUSE, point: { hx: 34, hy: 34 } }, overlay(3, true)],
      houseContent(),
    );
    sim.run(LOAD_PASS);
    expect([...sim.world.query(HouseLandscapeOverlays)]).toHaveLength(2);
    roundTrip(sim); // Save export also rejects aliased component payloads.
  });

  it('ignores missing ids and out-of-range slots', () => {
    const sim = firingSim(
      [SET_HOUSE, overlay(-1, true), overlay(10, true), overlay(1, true, HOUSE_ID + 1)],
      houseContent(),
    );
    sim.run(LOAD_PASS);
    expect([...sim.world.query(HouseLandscapeOverlays)]).toEqual([]);
  });
});
