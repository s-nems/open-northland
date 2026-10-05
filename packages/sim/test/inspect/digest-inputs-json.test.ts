import { describe, expect, it } from 'vitest';
import { digestInputsFromJson, digestInputsToJson, type SyncDigestInputsJson } from '../../src/index.js';

function inputs(): SyncDigestInputsJson {
  return {
    tick: 7,
    names: 2166136261,
    rng: -123,
    nextEntityId: 3,
    entityCount: 1,
    allocations: [1, 2, 1],
    fog: [0, 0xffffffff],
    components: [{ name: 'Position', domain: 'movement', entities: [2], words: [0xffffffff] }],
  };
}

describe('digestInputsFromJson', () => {
  it('preserves signed rng state, unsigned words and repeated allocation events', () => {
    const json = inputs();
    expect(digestInputsToJson(digestInputsFromJson(json))).toEqual(json);
    expect(digestInputsFromJson({ ...json, rng: 0xffffffff }).rng).toBe(0xffffffff);
  });

  it.each([null, [], 7])('rejects a non-object capture: %j', (value) => {
    expect(() => digestInputsFromJson(value)).toThrow(/inputs: expected an object/);
  });

  it.each([
    ['tick', undefined],
    ['tick', -1],
    ['tick', 1.5],
    ['tick', 2 ** 53],
    ['rng', -(2 ** 31) - 1],
    ['rng', 2 ** 32],
    ['rng', '123'],
    ['nextEntityId', undefined],
    ['entityCount', -1],
  ])('rejects invalid scalar %s = %j', (field, value) => {
    expect(() => digestInputsFromJson({ ...inputs(), [field]: value })).toThrow(field);
  });

  it.each([undefined, null, {}, '12', [null], ['1'], [-1], [1.5], [2 ** 32]])(
    'rejects allocation data that typed arrays would coerce: %j',
    (allocations) => {
      expect(() => digestInputsFromJson({ ...inputs(), allocations })).toThrow(/allocations/);
    },
  );

  it.each(['fog', 'entities', 'words'])('validates %s words before converting them', (field) => {
    const json = inputs();
    const invalid =
      field === 'fog'
        ? { ...json, fog: [null] }
        : { ...json, components: [{ ...json.components[0], [field]: [null] }] };
    expect(() => digestInputsFromJson(invalid)).toThrow(field);
  });

  it.each([undefined, null, {}, [null]])(
    'rejects a missing or malformed component list: %j',
    (components) => {
      expect(() => digestInputsFromJson({ ...inputs(), components })).toThrow(/components/);
    },
  );

  it.each([
    { name: '', domain: 'movement', entities: [2], words: [3] },
    { name: 7, domain: 'movement', entities: [2], words: [3] },
    { name: 'Position', domain: 'unknown', entities: [2], words: [3] },
    { name: 'Position', domain: 'movement', entities: [2], words: [] },
    { name: 'Position', domain: 'movement', entities: [2], words: [3, 4] },
    { name: 'Position', domain: 'movement', entities: [2, 2], words: [3, 4] },
  ])('rejects components the comparison cannot interpret: %j', (component) => {
    expect(() => digestInputsFromJson({ ...inputs(), components: [component] })).toThrow(/components\[0\]/);
  });

  it('rejects repeated component names instead of silently keeping only the last one', () => {
    const json = inputs();
    expect(() =>
      digestInputsFromJson({ ...json, components: [...json.components, ...json.components] }),
    ).toThrow(/duplicate component/);
  });
});
