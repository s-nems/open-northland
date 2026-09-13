import { expect, it, vi } from 'vitest';
import { ruleChoiceState } from '../../src/entries/main-menu/lobby-controls/rules-state.js';

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
