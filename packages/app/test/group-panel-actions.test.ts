import type { UiCue } from '@open-northland/audio';
import { MAX_UNIT_ORDER_MEMBERS, type PlayerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { isSettler, isVehicle } from '../src/game/snapshot.js';
import { fixedViewerSeat } from '../src/game/viewer-seat.js';
import type { ActionOrderId } from '../src/hud/action-ring/index.js';
import { ALL_SCOPE } from '../src/hud/details-panel/model/index.js';
import { memberPress } from '../src/hud/dom/group-panel/members.js';
import { holdCounts } from '../src/hud/dom/group-panel/military.js';
import { scopePress } from '../src/hud/dom/group-panel/tabs.js';
import { groupPanelScene } from '../src/scenes/group-panel.js';
import { createSceneSim } from '../src/scenes/index.js';
import { groupPanelActions } from '../src/view/unit-controls/group-panel.js';
import { snapshotOf } from './support/snapshot.js';

const ENEMY_SEAT = 2;
const FIGHTERS = 26;
const CATAPULTS_AND_CART = 3;

function harness(seat = HUMAN_PLAYER, accepts = true, vehicleCount?: number) {
  const sim = createSceneSim(groupPanelScene);
  const original = sim.snapshot();
  const vehicle = original.entities.find(isVehicle);
  if (vehicle === undefined) throw new Error('missing group panel vehicle fixture');
  const snapshot =
    vehicleCount === undefined
      ? original
      : snapshotOf(
          Array.from({ length: vehicleCount }, (_, i) => ({ id: i + 10000, components: vehicle.components })),
        );
  const limited: number[] = [];
  const cues: UiCue[] = [];
  const rings: { order: ActionOrderId; targets: readonly number[] }[] = [];
  const sent: PlayerCommand[] = [];
  const actions = groupPanelActions(
    {
      snapshot: () => snapshot,
      viewer: fixedViewerSeat(seat),
      enqueue: (c) => sent.push(c),
      content: sim.content,
    },
    {
      onOrderLimit: () => {
        limited.push(1);
        cues.push('fail');
      },
      selectEntity: () => {},
      selectGroup: () => {},
      centre: () => {},
      openOrders: () => {},
      closeOrders: () => {},
      ringCommand: (order, targets) => {
        rings.push({ order, targets });
        return accepts;
      },
      cue: (cue) => cues.push(cue),
    },
  );
  const settlers = snapshot.entities.filter(isSettler).map((e) => e.id);
  const vehicles = snapshot.entities.filter(isVehicle).map((e) => e.id);
  return { actions, cues, rings, sent, settlers, vehicles, limited };
}

describe('group panel orders', () => {
  it('counts how many members an order reaches through the ring gates', () => {
    const { actions, settlers, vehicles } = harness();
    expect(actions.reach('defenceMode', [...settlers, ...vehicles])).toBe(FIGHTERS);
    expect(actions.reach('defenceMode', vehicles)).toBe(0);
  });

  it('sends a stance through the ring command to every member the viewer owns', () => {
    const { actions, cues, rings, settlers } = harness();
    actions.setStance(settlers, 'defend');
    expect(rings).toEqual([{ order: 'defenceMode', targets: settlers }]);
    expect(cues).toEqual(['confirm']);
  });

  it('does not confirm a rejected army action', () => {
    const { actions, settlers, cues } = harness(HUMAN_PLAYER, false);
    actions.setStance(settlers, 'defend');
    expect(cues).toEqual(['fail']);
  });

  it('refuses an order nobody in scope takes, with the fail click', () => {
    const { actions, cues, rings, vehicles } = harness();
    actions.setRegeneration(vehicles, false);
    expect(rings).toEqual([]);
    expect(cues).toEqual(['fail']);
  });

  it("never orders another seat's members", () => {
    const { actions, cues, rings, sent, settlers, vehicles } = harness(ENEMY_SEAT);
    expect(actions.reach('defenceMode', settlers)).toBe(0);
    actions.setRegeneration(settlers, false);
    actions.setVehicleStance(vehicles, 'attack');
    expect(rings).toEqual([]);
    expect(sent).toEqual([]);
    expect(cues).toEqual(['fail', 'fail']);
  });

  it("sets every owned vehicle's stance", () => {
    const { actions, sent, vehicles } = harness();
    actions.setVehicleStance(vehicles, 'attack');
    expect(vehicles).toHaveLength(CATAPULTS_AND_CART);
    expect(sent).toEqual([
      { kind: 'setVehicleStanceGroup', members: vehicles.map((entity) => ({ entity })), stance: 'attack' },
    ]);
  });
});

it('submits one stance for 25 siege vehicles and refuses a 4097-vehicle selection with one failure notice', () => {
  const group = harness(HUMAN_PLAYER, true, 25);
  group.actions.setVehicleStance(group.vehicles, 'defence');
  expect(group.sent).toEqual([
    {
      kind: 'setVehicleStanceGroup',
      members: group.vehicles.map((entity) => ({ entity })),
      stance: 'defence',
    },
  ]);
  expect(group.cues).toEqual(['confirm']);
  const oversized = harness(HUMAN_PLAYER, true, MAX_UNIT_ORDER_MEMBERS + 1);
  oversized.actions.setVehicleStance(oversized.vehicles, 'defence');
  expect(oversized.sent).toEqual([]);
  expect(oversized.cues).toEqual(['fail']);
  expect(oversized.limited).toEqual([1]);
});

describe('group panel presses', () => {
  const click = { detail: 1, shiftKey: false, ctrlKey: false, metaKey: false };

  it('reads a well press: alone, into view, out of the group, or the whole kind', () => {
    expect(memberPress(click)).toBe('only');
    expect(memberPress({ ...click, detail: 2 })).toBe('centre');
    expect(memberPress({ ...click, shiftKey: true })).toBe('drop');
    expect(memberPress({ ...click, ctrlKey: true })).toBe('kind');
    expect(memberPress({ ...click, metaKey: true })).toBe('kind');
  });

  it('reads a tab press, and never narrows or drops the whole group', () => {
    expect(scopePress('job:40', click)).toBe('show');
    expect(scopePress('job:40', { ...click, detail: 2 })).toBe('narrow');
    expect(scopePress('job:40', { ...click, shiftKey: true })).toBe('drop');
    expect(scopePress(ALL_SCOPE, { ...click, detail: 2 })).toBe('show');
    expect(scopePress(ALL_SCOPE, { ...click, shiftKey: true })).toBe('show');
  });

  it('writes how many hold each value, leaving out the empty ones', () => {
    const labels = { attack: 'Atak', defend: 'Obrona', ignore: 'Ignoruj' };
    expect(holdCounts({ attack: 20, defend: 0, ignore: 6 }, labels)).toBe('Atak 20 · Ignoruj 6');
  });
});
