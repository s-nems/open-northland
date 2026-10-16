import { MapScript } from '@open-northland/data';
import type { SessionSeat } from '@open-northland/lockstep';
import { describe, expect, it } from 'vitest';
import { flowOf, seatFlows, sessionSeatChanges } from '../src/game/seat-flows.js';

/** What the script will hand a re-tribed seat, read before the world is built. */

const VIKING = 1;
const FRANK = 2;
const SARACEN = 4;
const WERESNAKE = 5;
const PERSON = 0;
const CHANGE = { seat: PERSON, authored: VIKING, chosen: SARACEN };

const human = (player: number, tribe?: number): SessionSeat => ({
  player,
  mode: 'human',
  color: player,
  ...(tribe === undefined ? {} : { tribe }),
});
const mapAi = (player: number): SessionSeat => ({ ...human(player), mode: 'map-ai' });

const line = (...values: (string | number)[]) => ({ key: 'result', values: values.map(String) });

function script(...results: ReturnType<typeof line>[]): MapScript {
  return MapScript.parse({
    players: [
      { player: 0, type: 'human', tribeId: VIKING, colorId: 0 },
      { player: 1, type: 'ai', tribeId: WERESNAKE, colorId: 1 },
      { player: 2, type: 'human', tribeId: FRANK, colorId: 2 },
      ...[3, 4, 5, 6].map((player) => ({ player, type: 'ai', tribeId: VIKING, colorId: player })),
    ],
    missions: [{ goals: [{ key: 'goal', values: ['True'] }], results }],
  });
}

/** Seat 2 and seat 5 are other people's; seat 3 is a map AI, seat 4 an idle seat, seat 6 a computer. */
const SEATS: readonly SessionSeat[] = [
  human(0, SARACEN),
  human(2),
  mapAi(3),
  { ...human(4), mode: 'idle' },
  human(5),
  { ...human(6, VIKING), mode: 'computer' },
];

describe('sessionSeatChanges', () => {
  it('keeps only a civilization seat moved to another civilization', () => {
    const changes = sessionSeatChanges(
      { seats: [human(0, SARACEN), human(1, VIKING), human(2, FRANK), human(9, SARACEN)] },
      script(),
    );
    // Seat 1 is a monster, seat 2 kept its own, seat 9 is off the roster.
    expect([...changes.values()]).toEqual([CHANGE]);
  });
});

describe('seatFlows', () => {
  it("follows whole seats through chains, leaving another person's seat and seats handed elsewhere", () => {
    const flows = seatFlows(
      { seats: SEATS },
      script(
        line('ChangePlayerPlayerId', 3, 4),
        line('ChangePlayerPlayerId', 4, 0),
        line('ChangePlayerPlayerId', 5, 0),
        line('ChangePlayerPlayerId', 6, 2),
      ),
    );
    expect([...flows.seats.keys()].sort()).toEqual([0, 3, 4]);
    expect(flowOf(flows, 'human', { owner: 3 })).toEqual(CHANGE);
    expect(flowOf(flows, 'house', { owner: 5 })).toBeUndefined();
    expect(flowOf(flows, 'vehicle', { owner: 6 })).toBeUndefined();
  });

  it('hands ids to the seat and to a seat that reaches it, and follows vehicle renumbering', () => {
    const flows = seatFlows(
      { seats: SEATS },
      script(
        line('ChangeHumanPlayerId', 7, 0),
        line('ChangeHumanPlayerId', 8, 4),
        line('ChangePlayerPlayerId', 4, 0),
        line('ChangeHousesPlayerId', 9, 0),
        line('ChangeMissionIdOfVehicles', 5, 11),
        line('ChangeVehiclesPlayerId', 11, 0),
        line('ChangeHumanPlayerId', 12, 6),
      ),
    );
    expect(flowOf(flows, 'human', { owner: 6, missionId: 7 })).toEqual(CHANGE);
    expect(flowOf(flows, 'human', { owner: 6, missionId: 8 })).toEqual(CHANGE);
    expect(flowOf(flows, 'house', { owner: 6, missionId: 9 })).toEqual(CHANGE);
    expect(flowOf(flows, 'human', { owner: 6, missionId: 9 })).toBeUndefined();
    expect(flowOf(flows, 'vehicle', { owner: 6, missionId: 5 })).toEqual(CHANGE);
    expect(flowOf(flows, 'human', { owner: 6, missionId: 12 })).toBeUndefined();
    // Seat 2 is another person's: its things move only when a handover delivers them.
    expect(flowOf(flows, 'human', { owner: 2, missionId: 7 })).toBeUndefined();
  });

  it("hands what stands in an area, and a seat's humans stamped there with a handed id", () => {
    const flows = seatFlows(
      { seats: SEATS },
      script(
        line('ChangeHumanObjectIdInArea', 3, 10, 10, 2, 13),
        line('ChangeHumanPlayerId', 13, 0),
        line('ChangePlayerIdInArea', 6, 0, 40, 40, 3),
        line('ChangeMissionIdOfPlayer', 4, 14),
        line('ChangeHumanPlayerId', 14, 0),
      ),
    );
    expect(flowOf(flows, 'human', { owner: 3, at: { hx: 10, hy: 11 } })).toEqual(CHANGE);
    expect(flowOf(flows, 'human', { owner: 3, at: { hx: 30, hy: 30 } })).toBeUndefined();
    expect(flowOf(flows, 'house', { owner: 3, at: { hx: 10, hy: 10 } })).toBeUndefined();
    expect(flowOf(flows, 'house', { owner: 6, at: { hx: 41, hy: 40 } })).toEqual(CHANGE);
    expect(flowOf(flows, 'vehicle', { owner: 6, at: { hx: 50, hy: 40 } })).toBeUndefined();
    expect(flowOf(flows, 'human', { owner: 4, at: { hx: 90, hy: 90 } })).toEqual(CHANGE);
  });

  it('reads nothing when every seat plays its own people', () => {
    const flows = seatFlows({ seats: [human(0)] }, script(line('ChangePlayerPlayerId', 3, 0)));
    expect(flows.seats.size).toBe(0);
    expect(flowOf(flows, 'human', { owner: 3 })).toBeUndefined();
  });
});
