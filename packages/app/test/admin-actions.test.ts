import type { Entity } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { DEBUG_ACTIONS } from '../src/view/admin-debug/actions-catalog.js';

/**
 * The admin/debug panel's entity-ACTION catalog — the pure "arm a tool, click a target → a debug command"
 * mapping (the data half of the action tools, verifiable without the DOM). The panel's window-capture
 * wiring (a map click picks the entity + enqueues this) is browser-verified; here we pin that each tool
 * targets the right entity kind and builds the right `debug*` command for the picked entity ref.
 */

const TARGET = 42 as Entity;

function actionById(id: string) {
  const action = DEBUG_ACTIONS.find((a) => a.id === id);
  if (action === undefined) throw new Error(`missing debug action ${id}`);
  return action;
}

describe('admin debug action command mapping', () => {
  it('kill targets a unit and issues debugKill at the picked entity', () => {
    const kill = actionById('kill');
    expect(kill.targetKind).toBe('settler');
    expect(kill.command(TARGET)).toEqual({ kind: 'debugKill', target: TARGET });
  });

  it('satisfy sets every need to 0% on a unit', () => {
    const satisfy = actionById('satisfy');
    expect(satisfy.targetKind).toBe('settler');
    expect(satisfy.command(TARGET)).toEqual({
      kind: 'debugSetNeeds',
      target: TARGET,
      hunger: 0,
      fatigue: 0,
      piety: 0,
      enjoyment: 0,
    });
  });

  it('starve sets every need to 100% on a unit', () => {
    const starve = actionById('starve');
    expect(starve.targetKind).toBe('settler');
    expect(starve.command(TARGET)).toEqual({
      kind: 'debugSetNeeds',
      target: TARGET,
      hunger: 100,
      fatigue: 100,
      piety: 100,
      enjoyment: 100,
    });
  });

  it('fill targets a building and issues debugFillStockpile', () => {
    const fill = actionById('fill');
    expect(fill.targetKind).toBe('building');
    expect(fill.command(TARGET)).toEqual({ kind: 'debugFillStockpile', target: TARGET });
  });

  it('finish targets a building and issues debugCompleteConstruction', () => {
    const finish = actionById('finish');
    expect(finish.targetKind).toBe('building');
    expect(finish.command(TARGET)).toEqual({ kind: 'debugCompleteConstruction', target: TARGET });
  });
});
