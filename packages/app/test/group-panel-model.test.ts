import { describe, expect, it } from 'vitest';
import { JOB_ARCHER } from '../src/catalog/jobs.js';
import { isSettler, isVehicle, settlerJobType } from '../src/game/snapshot.js';
import {
  ALL_SCOPE,
  buildUnitPanelModel,
  type GroupPanelModel,
  type GroupScopeModel,
} from '../src/hud/details-panel/model/index.js';
import { groupPanelScene } from '../src/scenes/group-panel.js';
import { createSceneSim } from '../src/scenes/index.js';
import { ctxOf } from './support/sandbox.js';

/** The scene's whole company, boxed: 35 settlers, two catapults and a handcart. */
function company(select: (kind: 'settler' | 'vehicle') => boolean = () => true): GroupPanelModel {
  const sim = createSceneSim(groupPanelScene);
  const snapshot = sim.snapshot();
  const ids = snapshot.entities
    .filter((e) => (isSettler(e) && select('settler')) || (isVehicle(e) && select('vehicle')))
    .map((e) => e.id);
  const model = buildUnitPanelModel(snapshot, new Set(ids), ctxOf(sim));
  if (model.kind !== 'group') throw new Error(`expected a group, got ${model.kind}`);
  return model;
}

function scope(model: GroupPanelModel, label: string): GroupScopeModel {
  const found = model.scopes.find((s) => s.label === label);
  if (found === undefined)
    throw new Error(`no scope ${label}: ${model.scopes.map((s) => s.label).join(', ')}`);
  return found;
}

describe('group panel model', () => {
  const model = company();

  it('titles the group by settlers and vehicles and lists every member once', () => {
    expect(model.title).toBe('35 osadników · 3 wehikuły');
    expect(model.members).toHaveLength(38);
    expect(new Set(model.members.map((m) => m.id)).size).toBe(38);
    expect(model.orders).toBe(true);
  });

  it('opens with the whole group, then one tab per kind, fighters first', () => {
    expect(model.scopes[0]?.key).toBe(ALL_SCOPE);
    expect(model.scopes.map((s) => `${s.label} ${s.ids.length}`)).toEqual([
      'Wszyscy 38',
      'Włócznicy 6',
      'Miecznicy 8',
      'Łucznicy 12',
      'Katapulty 2',
      'Wózki ręczne 1',
      'Budowniczowie 4',
      'Cywile 2',
      'Kobiety 3',
    ]);
    expect(model.members.map((m) => m.kind)).toEqual(
      model.scopes.slice(1).flatMap((s) => s.ids.map(() => s.key)),
    );
  });

  it('counts the gear a scope wears and carries, with the sips its draughts hold', () => {
    const archers = scope(model, 'Łucznicy');
    const gear = Object.fromEntries(archers.gear.map((row) => [row.gear, row]));
    expect(gear.weapon?.items.map((i) => [i.goodId, i.count])).toEqual([['bow_short', 12]]);
    expect(gear.armor?.items.map((i) => [i.goodId, i.count])).toEqual([['armor_leather', 12]]);
    expect(gear.armor?.bare).toBe(0);
    const bag = gear.misc?.items.map((i) => [i.goodId, i.count, i.sips]);
    // Equal counts sort by name: "Duża mikstura leczenia" before "Mała mikstura pożywienia".
    expect(bag).toEqual([
      ['potion_heal_big', 6, 30],
      ['potion_food_small', 6, 12],
    ]);
    expect(gear.misc?.bare).toBe(6);
    expect(gear.tool).toBeUndefined();
  });

  it('gives workers a tool line and fighters none', () => {
    const builders = scope(model, 'Budowniczowie');
    expect(builders.gear.map((row) => row.gear)).toEqual(['tool', 'misc']);
    expect(builders.gear[0]?.items.map((i) => [i.goodId, i.count])).toEqual([['tool_iron', 4]]);
    expect(builders.military).toBeNull();
  });

  it('reads the fighters stance and regeneration only over fighters', () => {
    const all = model.scopes[0];
    expect(all?.military?.count).toBe(26);
    expect(all?.military?.regeneration).toBe(true);
    expect(scope(model, 'Kobiety').military).toBeNull();
  });

  it('offers the catapults their own stance', () => {
    const all = model.scopes[0];
    expect(all?.siege?.ids).toHaveLength(2);
    expect(all?.siege?.stance).toBe('hold');
    expect(scope(model, 'Wózki ręczne').siege).toBeNull();
  });

  it('gives every member its health and every settler its hunger', () => {
    const spearmen = new Set(scope(model, 'Włócznicy').ids);
    const wounded = model.members.filter((m) => spearmen.has(m.id) && (m.healthPct ?? 100) < 100);
    expect(wounded.map((m) => m.healthPct)).toEqual([18, 18]);
    const settlers = model.members.filter((m) => m.look === 'settler');
    expect(settlers.every((m) => m.hungerPct !== null)).toBe(true);
    const vehicles = model.members.filter((m) => m.look === 'vehicle');
    expect(vehicles.every((m) => m.healthPct !== null && m.hungerPct === null)).toBe(true);
  });

  it('titles a group of one kind by that kind', () => {
    const sim = createSceneSim(groupPanelScene);
    const snapshot = sim.snapshot();
    const archers = snapshot.entities.filter((e) => settlerJobType(e) === JOB_ARCHER).map((e) => e.id);
    const model = buildUnitPanelModel(snapshot, new Set(archers), ctxOf(sim));
    expect(model.kind === 'group' && model.title).toBe('Łucznicy · 12');
    expect(model.kind === 'group' && model.scopes).toHaveLength(1);
  });

  it('makes one settler boxed with a vehicle a group, not the settler panel', () => {
    const sim = createSceneSim(groupPanelScene);
    const snapshot = sim.snapshot();
    const settler = snapshot.entities.find(isSettler);
    const vehicle = snapshot.entities.find(isVehicle);
    if (settler === undefined || vehicle === undefined) throw new Error('scene: no settler or vehicle');
    const model = buildUnitPanelModel(snapshot, new Set([settler.id, vehicle.id]), ctxOf(sim));
    expect(model.kind).toBe('group');
  });

  it('gives a vehicle-only group no orders medallion', () => {
    const vehicles = company((kind) => kind === 'vehicle');
    expect(vehicles.title).toBe('3 wehikuły');
    expect(vehicles.scopes.map((s) => s.label)).toEqual(['Wszyscy', 'Katapulty', 'Wózki ręczne']);
    expect(vehicles.orders).toBe(false);
  });
});
