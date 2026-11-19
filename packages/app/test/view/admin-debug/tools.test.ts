import type { Entity } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { VEHICLE_HANDCART } from '../../../src/game/sandbox/ids/index.js';
import { formatMessage, messages } from '../../../src/i18n/index.js';
import { DEBUG_ACTIONS, type DebugAction } from '../../../src/view/admin-debug/actions-catalog.js';
import { createAdminLabels } from '../../../src/view/admin-debug/labels.js';
import {
  type ArmorEntry,
  type GoodEntry,
  PERSON_PRESETS,
  type PersonPreset,
  RESOURCE_ENTRIES,
  type VehicleEntry,
} from '../../../src/view/admin-debug/spawn-catalog.js';
import { type Armed, armedKey, createAdminToolCatalogue } from '../../../src/view/admin-debug/tools.js';

/**
 * The debug tools' pure half: the labels each tool resolves through, the groups and keys the panel
 * shows, and the footer's words for an arm. The panel's DOM and the map clicks are tested elsewhere.
 */

const copy = messages().admin;

/** A localized good name only for typeId 900, so the override-vs-fallback split is observable. */
const NAMED_GOOD = 900;
const goodLabel = (typeId: number): string | undefined =>
  typeId === NAMED_GOOD ? 'Nazwa Towaru' : undefined;
const SWORD_GOOD = 901;
const GOODS: readonly GoodEntry[] = [
  { good: NAMED_GOOD, id: 'test_good' },
  { good: SWORD_GOOD, id: 'sword_shord' },
];
const CHAIN_CLASS = 3;
const ARMORS: readonly ArmorEntry[] = [{ armorClass: CHAIN_CLASS, good: 935, id: 'armor_chain' }];
const CART: VehicleEntry = { vehicleType: VEHICLE_HANDCART, label: 'Wózek' };
const WOLVES = { tribe: 20, id: 'wolves' };
const HALL = { typeId: 1, label: 'Hala', records: [{ tribe: 1, topLevel: 0 }] };

const labels = createAdminLabels(messages(), goodLabel);
const catalogue = createAdminToolCatalogue(messages(), labels, {
  goods: GOODS,
  armors: ARMORS,
  animals: [WOLVES],
  vehicles: [CART],
  standing: { wall: true, road: true, buildings: [HALL] },
});

function preset(id: PersonPreset['id']): PersonPreset {
  const found = PERSON_PRESETS.find((p) => p.id === id);
  if (found === undefined) throw new Error(`missing preset ${id}`);
  return found;
}

function debugAction(id: DebugAction['id']): DebugAction {
  const found = DEBUG_ACTIONS.find((a) => a.id === id);
  if (found === undefined) throw new Error(`missing debug action ${id}`);
  return found;
}

function groupOf(id: string) {
  const found = catalogue.groups.find((group) => group.id === id);
  if (found === undefined) throw new Error(`missing group ${id}`);
  return found;
}

describe('admin tool catalogue', () => {
  it('lists the groups in browsing order, each tool once under a unique key', () => {
    expect(catalogue.groups.map((group) => group.id)).toEqual([
      'people',
      'soldiers',
      'creatures',
      'animals',
      'vehicles',
      'resources',
      'goods',
      'structures',
      'buildings',
    ]);
    const keys = [...catalogue.groups.flatMap((g) => g.tools), ...catalogue.actions].map((tool) => tool.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(groupOf('people').tools.map((tool) => tool.label)).toEqual([
      copy.people.man,
      copy.people.woman,
      copy.people.boy,
      copy.people.girl,
    ]);
    expect(groupOf('soldiers').tools.map((tool) => tool.label)).toEqual([copy.soldier]);
    expect(groupOf('resources').tools).toHaveLength(RESOURCE_ENTRIES.length);
  });

  it('shows goods and deposits with their own icons, named live where the content names them', () => {
    expect(groupOf('goods').tools[0]).toEqual({
      key: 'good:900',
      label: 'Nazwa Towaru',
      knobs: [],
      goodId: 'test_good',
    });
    expect(groupOf('resources').tools.every((tool) => tool.goodId !== undefined)).toBe(true);
  });

  it('resolves every key back to its arm, and a structure to the placement it stands', () => {
    for (const tool of catalogue.groups.flatMap((g) => g.tools)) {
      const choice = catalogue.choiceOf(tool.key);
      expect(choice).toBeDefined();
      if (choice !== undefined && choice.kind !== 'standing') expect(armedKey(choice)).toBe(tool.key);
    }
    const standing = [...groupOf('structures').tools, ...groupOf('buildings').tools].map((tool) =>
      catalogue.choiceOf(tool.key),
    );
    expect(standing).toEqual([
      { kind: 'standing', structure: { kind: 'wall' } },
      { kind: 'standing', structure: { kind: 'road' } },
      { kind: 'standing', structure: { kind: 'building', typeId: HALL.typeId, records: HALL.records } },
    ]);
    expect(groupOf('buildings').tools.map((tool) => tool.label)).toEqual([HALL.label]);
    expect(catalogue.choiceOf('nope')).toBeUndefined();
  });

  it('leaves out the structures the HUD cannot stand and a group with nothing in it', () => {
    const bare = createAdminToolCatalogue(messages(), labels, {
      goods: GOODS,
      armors: [],
      animals: [],
      vehicles: [],
      standing: { wall: false, road: false, buildings: [] },
    });
    const ids = bare.groups.map((group) => group.id);
    expect(ids).not.toContain('structures');
    expect(ids).not.toContain('buildings');
    expect(ids).not.toContain('vehicles');
    expect(ids).not.toContain('animals');
  });

  it('offers each target action with what its click picks, the health one with the share field', () => {
    expect(catalogue.actions.map((action) => action.key)).toEqual([
      ...DEBUG_ACTIONS.map((action) => `action:${action.id}`),
      'teleport',
    ]);
    const health = catalogue.actions.find((action) => action.key === 'action:health');
    expect(health?.percent).toBe(true);
    expect(health?.target).toBe(copy.actionHints.health);
    expect(catalogue.actions.find((action) => action.key === 'action:kill')?.percent).toBeUndefined();
  });
});

describe('the footer line for an arm', () => {
  it('names an owned spawn with the owner it is dropped for', () => {
    const man: Armed = { kind: 'person', preset: preset('man') };
    expect(catalogue.describe(man, 1)).toEqual({
      key: 'person:man',
      name: formatMessage(copy.armedFor, { label: copy.people.man, name: labels.player(1) }),
      hint: copy.hintSpawn,
    });
    expect(catalogue.describe({ kind: 'soldier' }, 0).name).toContain(copy.soldier);
    expect(catalogue.describe({ kind: 'vehicle', entry: CART }, 0).name).toContain(CART.label);
  });

  it('names an unowned spawn alone', () => {
    expect(catalogue.describe({ kind: 'good', good: NAMED_GOOD }, 3).name).toBe('Nazwa Towaru');
    expect(catalogue.describe({ kind: 'animal', entry: WOLVES }, 3).name).toBe(copy.wildlifeCatalog[20]);
  });

  it('tells an action what to click', () => {
    const fill = debugAction('fill');
    expect(catalogue.describe({ kind: 'action', action: fill }, 0)).toEqual({
      key: 'action:fill',
      name: copy.actions.fill,
      hint: copy.actionHints.fill,
    });
  });

  it('keeps the teleport under one key, asking for the settler and then for its destination', () => {
    const pick = catalogue.describe({ kind: 'teleport', target: null }, 0);
    const go = catalogue.describe({ kind: 'teleport', target: 7 as Entity }, 0);
    expect(pick.key).toBe(go.key);
    expect(pick.hint).toBe(copy.actionHints.teleport);
    expect(go.hint).toBe(copy.hintTeleportDestination);
  });
});

describe('createAdminLabels', () => {
  it('prefers the live good name, else the catalog id', () => {
    const entry = { good: NAMED_GOOD, id: 'test_good' };
    expect(labels.good(entry)).toBe('Nazwa Towaru');
    expect(createAdminLabels(messages(), undefined).good(entry)).toBe('test_good');
  });

  it('names a seat by its lobby slot number and the colour it wears', () => {
    const orange = 7;
    const name = createAdminLabels(messages(), undefined, () => orange).player(2);
    expect(name).toBe(
      formatMessage(copy.ownerName, { player: 3, name: messages().animation.playerColors[orange] ?? '' }),
    );
  });

  it('falls back to the raw colour index past the color table', () => {
    expect(labels.player(999)).toBe(formatMessage(copy.ownerName, { player: 1000, name: '999' }));
  });
});
