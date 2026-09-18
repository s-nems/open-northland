import { FOG_MODE } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { fogRuleComposer, ruleChoiceState } from '../../src/entries/main-menu/lobby-controls/rules-state.js';

it('keeps the authoritative rule until its owner acknowledges a requested change', () => {
  const change = vi.fn();
  const state = ruleChoiceState<boolean | null>([null, true, false], change);
  state.update(null, false);
  state.request(true);
  expect(change).toHaveBeenCalledWith(true);
  expect(state.value()).toBe(null);
  // An unrelated room update or a rejected request retains the authored choice.
  state.update(null, false);
  expect(state.value()).toBe(null);
  state.update(true, false);
  expect(state.value()).toBe(true);
  state.request(true);
  expect(change).toHaveBeenCalledOnce();
});

it('supports immediate local acknowledgement and blocks frozen or unavailable choices', () => {
  const change = vi.fn((value: number | null) => state.update(value, false));
  const state = ruleChoiceState<number | null>([0, 1, 2], change);
  state.update(1, false);
  state.request(2);
  expect(state.value()).toBe(2);
  state.request(null);
  state.request(99);
  state.update(2, true);
  state.request(0);
  expect(change).toHaveBeenCalledOnce();
  expect(state.value()).toBe(2);
});

describe('fogRuleComposer - two controls behind one fog rule', () => {
  it('starts from the classic map without fog of war when the shown rule has no settings', () => {
    const fog = fogRuleComposer();
    expect(fog.show(null)).toBeNull();
    expect(fog.request({ fogOfWar: true })).toBe(FOG_MODE.CLASSIC_FOG_OF_WAR);
    fog.reject();
    expect(fog.show(FOG_MODE.OFF)).toBeNull();
    expect(fog.request({ terrainKnown: true })).toBe(FOG_MODE.RECON);
  });

  it('patches over the shown rule, and over the pending request until a view acknowledges it', () => {
    const fog = fogRuleComposer();
    expect(fog.show(FOG_MODE.CLASSIC)).toEqual({ terrainKnown: false, fogOfWar: false });
    expect(fog.request({ fogOfWar: true })).toBe(FOG_MODE.CLASSIC_FOG_OF_WAR);
    // A seat claim in the room re-shows the old rule; the request in flight is still the base.
    fog.show(FOG_MODE.CLASSIC);
    expect(fog.request({ terrainKnown: true })).toBe(FOG_MODE.RECON_FOG_OF_WAR);
    // The acknowledgement lands: the next request starts from the shown rule again.
    fog.show(FOG_MODE.RECON_FOG_OF_WAR);
    expect(fog.request({ fogOfWar: false })).toBe(FOG_MODE.RECON);
  });

  it('drops the pending request when the room refuses it', () => {
    const fog = fogRuleComposer();
    fog.show(FOG_MODE.RECON);
    fog.request({ fogOfWar: true });
    fog.reject();
    expect(fog.request({ terrainKnown: false })).toBe(FOG_MODE.CLASSIC);
  });
});
