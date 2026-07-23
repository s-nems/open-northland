import { describe, expect, it } from 'vitest';
import { BUILDING_KIND, BuildingType } from '../src/index.js';

/**
 * `kind` accepts exactly the known classes plus the extractor's `maintype_<...>` degrade path. A
 * typo'd or renamed kind must fail at parse, not silently never match a caller's comparison.
 */
describe('BuildingType.kind', () => {
  const record = (kind: string): Record<string, unknown> => ({ typeId: 1, id: 'hq', kind });

  it.each(Object.values(BUILDING_KIND))('accepts the known class %s', (kind) => {
    expect(BuildingType.parse(record(kind)).kind).toBe(kind);
  });

  it.each(['maintype_9', 'maintype_unknown'])('accepts the extractor fallback %s', (kind) => {
    expect(BuildingType.parse(record(kind)).kind).toBe(kind);
  });

  it.each(['worplace', 'Home', ''])('rejects the unknown kind %j', (kind) => {
    expect(() => BuildingType.parse(record(kind))).toThrow();
  });
});
