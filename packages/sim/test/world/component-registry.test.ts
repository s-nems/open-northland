import { describe, expect, it } from 'vitest';
import { defineComponent } from '../../src/ecs/world.js';

describe('component name registry', () => {
  it('rejects a second definition of an already-defined component name', () => {
    defineComponent<{ n: number }>('DuplicateNameProbe', 'economy');
    expect(() => defineComponent<{ n: number }>('DuplicateNameProbe', 'economy')).toThrow(
      /component name 'DuplicateNameProbe' is already defined/,
    );
  });
});
