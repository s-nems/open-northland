import { describe, expect, it } from 'vitest';
import { messages } from '../src/i18n/index.js';
import { requireModRoot } from '../src/pipeline-source.js';

describe('requireModRoot', () => {
  it('passes the available mod root through', () => {
    expect(requireModRoot('/data/mods/CnMod 1.3.2')).toBe('/data/mods/CnMod 1.3.2');
  });

  it('refuses to start without a mod', () => {
    expect(() => requireModRoot(undefined)).toThrow(messages().errors.modRequired);
  });
});
