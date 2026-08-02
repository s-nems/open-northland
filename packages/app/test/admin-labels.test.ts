import { describe, expect, it } from 'vitest';
import { formatMessage, messages, professionLabel } from '../src/i18n/index.js';
import { DEBUG_ACTIONS, type DebugAction } from '../src/view/admin-debug/actions-catalog.js';
import { type Armed, createAdminLabels, sameArmed } from '../src/view/admin-debug/labels.js';
import {
  CIVILIAN_PRESETS,
  type GoodEntry,
  type UnitPreset,
  WARRIOR_PRESETS,
} from '../src/view/admin-debug/spawn-catalog.js';

/**
 * The admin/debug panel's label + arm-equality resolution - the pure presentation half pulled out of the
 * DOM mount (`createAdminLabels` / `sameArmed`). The mount's pointer wiring stays browser-verified; here we
 * pin that each palette entry and status-footer line resolves through the right message keys and that a
 * button's active highlight compares arms by identity.
 */

const copy = messages().admin;

/** A localized good name only for typeId 900, so the override-vs-fallback split is observable. */
const NAMED_GOOD = 900;
const goodLabel = (typeId: number): string | undefined =>
  typeId === NAMED_GOOD ? 'Nazwa Towaru' : undefined;
const GOODS: readonly GoodEntry[] = [{ good: NAMED_GOOD, id: 'test_good' }];

const labels = createAdminLabels(messages(), goodLabel, GOODS);
const labelsNoOverride = createAdminLabels(messages(), undefined, GOODS);

function preset(id: string): UnitPreset {
  const found = [...WARRIOR_PRESETS, ...CIVILIAN_PRESETS].find((p) => p.id === id);
  if (found === undefined) throw new Error(`missing preset ${id}`);
  return found;
}

function debugAction(id: DebugAction['id']): DebugAction {
  const found = DEBUG_ACTIONS.find((a) => a.id === id);
  if (found === undefined) throw new Error(`missing debug action ${id}`);
  return found;
}

describe('sameArmed', () => {
  const spear: Armed = { kind: 'unit', preset: preset('spear') };
  const bow: Armed = { kind: 'unit', preset: preset('bow') };
  const kill: Armed = { kind: 'action', action: debugAction('kill') };
  const fill: Armed = { kind: 'action', action: debugAction('fill') };

  it('matches same-kind arms by identity', () => {
    expect(sameArmed(spear, spear)).toBe(true);
    expect(sameArmed(spear, bow)).toBe(false);
    expect(sameArmed({ kind: 'resource', good: 1 }, { kind: 'resource', good: 1 })).toBe(true);
    expect(sameArmed({ kind: 'resource', good: 1 }, { kind: 'resource', good: 2 })).toBe(false);
    expect(sameArmed({ kind: 'good', good: 5 }, { kind: 'good', good: 5 })).toBe(true);
    expect(sameArmed(kill, kill)).toBe(true);
    expect(sameArmed(kill, fill)).toBe(false);
  });

  it('rejects a different kind and a null other', () => {
    expect(sameArmed(spear, { kind: 'resource', good: 1 })).toBe(false);
    expect(sameArmed({ kind: 'good', good: 5 }, { kind: 'resource', good: 5 })).toBe(false);
    expect(sameArmed(spear, null)).toBe(false);
  });
});

describe('createAdminLabels status line', () => {
  it('reads "nothing armed" with no arm', () => {
    expect(labels.status(null, 0)).toBe(copy.nothingArmed);
  });

  it('names the unit arm through the unit + player labels', () => {
    const spear = preset('spear');
    expect(labels.status({ kind: 'unit', preset: spear }, 0)).toBe(
      formatMessage(copy.armedUnit, { label: labels.unit(spear), player: 0, name: labels.player(0) }),
    );
  });

  it('names the action arm with the target noun for its target kind', () => {
    const kill = debugAction('kill'); // targets a settler
    const fill = debugAction('fill'); // targets a building
    expect(labels.status({ kind: 'action', action: kill }, 0)).toBe(
      formatMessage(copy.armedAction, { label: labels.action(kill), target: copy.targetSettler }),
    );
    expect(labels.status({ kind: 'action', action: fill }, 0)).toBe(
      formatMessage(copy.armedAction, { label: labels.action(fill), target: copy.targetBuilding }),
    );
  });

  it('resolves a dropped-good arm from the live goods, else the fallback', () => {
    expect(labels.status({ kind: 'good', good: NAMED_GOOD }, 0)).toBe(
      formatMessage(copy.armedGood, { label: 'Nazwa Towaru' }),
    );
    expect(labels.status({ kind: 'good', good: 12345 }, 0)).toBe(
      formatMessage(copy.armedGood, { label: copy.goodFallback }),
    );
  });

  it('falls back for a resource arm the catalog does not list', () => {
    expect(labels.status({ kind: 'resource', good: -999 }, 0)).toBe(
      formatMessage(copy.armedResource, { label: copy.resourceFallback }),
    );
  });
});

describe('createAdminLabels field labels', () => {
  it('prefers the live good name, else the catalog id', () => {
    const entry = { good: NAMED_GOOD, id: 'test_good' };
    expect(labels.good(entry)).toBe('Nazwa Towaru');
    expect(labelsNoOverride.good(entry)).toBe('test_good');
  });

  it('reads a directly-labelled preset, and routes collector through the profession label', () => {
    expect(labels.unit(preset('spear'))).toBe(copy.units.spear);
    expect(labels.unit(preset('collector'))).toBe(professionLabel('collector'));
  });

  it('falls back to the raw player index past the color table', () => {
    expect(labels.player(999)).toBe('999');
  });
});
