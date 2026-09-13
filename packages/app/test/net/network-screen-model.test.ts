import { describe, expect, it } from 'vitest';
import { ruleChoiceState } from '../../src/entries/main-menu/lobby-controls/rules-state.js';
import { escapeLeavesRoom, validNetworkNick } from '../../src/entries/main-menu/network/model.js';

describe('escapeLeavesRoom', () => {
  it('lets Esc clear a chat line still being written and leaves the room from anywhere else', () => {
    const field = (tagName: string, value: string) => ({ tagName, value }) as unknown as EventTarget;
    expect(escapeLeavesRoom(field('INPUT', 'hej'))).toBe(false);
    expect(escapeLeavesRoom(field('INPUT', ''))).toBe(true);
    expect(escapeLeavesRoom(field('SELECT', 'ai'))).toBe(true);
    expect(escapeLeavesRoom({ tagName: 'SECTION' } as unknown as EventTarget)).toBe(true);
    expect(escapeLeavesRoom(null)).toBe(true);
  });
});

describe('validNetworkNick', () => {
  it('accepts exactly what the relay accepts in hello', () => {
    expect(validNetworkNick('Ania')).toBe(true);
    expect(validNetworkNick('')).toBe(false);
    expect(validNetworkNick('x'.repeat(25))).toBe(false);
    expect(validNetworkNick('An\tia')).toBe(false);
  });
});

describe('ruleChoiceState', () => {
  it('requests a change back to the acknowledged value while the first change is still in flight', () => {
    const changes: (number | null)[] = [];
    const state = ruleChoiceState<number | null>([null, 0, 1], (value) => changes.push(value));
    state.update(null, false);
    state.request(0);
    state.request(0);
    state.request(null);
    expect(changes).toEqual([0, null]);
  });
});
