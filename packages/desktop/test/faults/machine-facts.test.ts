import { expect, it } from 'vitest';
import { machineFacts } from '../../src/faults/machine-facts.js';

const EIGHT_GIB_IN_KIB = 8 * 1024 * 1024;
const FREE_KIB = 153_700;

it('states translation and memory in MiB', () => {
  expect(
    machineFacts({ arm64Translation: true, memoryKib: { total: EIGHT_GIB_IN_KIB, free: FREE_KIB } }),
  ).toEqual({ arm64Translation: 'true', systemMemoryTotalMib: '8192', systemMemoryFreeMib: '150' });
});
