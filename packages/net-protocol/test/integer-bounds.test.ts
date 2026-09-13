import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../src/index.js';

describe('wire integer precision', () => {
  it.each([2 ** 53, 1e100])('rejects a loaded tick that cannot advance exactly: %s', (tick) => {
    expect(() => parseClientMessage({ kind: 'loaded', tick, world: 0 })).toThrow(/safe integer/);
  });

  it('rejects unsafe world generations before acknowledgement comparison', () => {
    expect(() => parseClientMessage({ kind: 'loaded', tick: 0, world: 2 ** 53 })).toThrow(/safe integer/);
  });
});
