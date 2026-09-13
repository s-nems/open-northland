import { prepareInitialSave, verifyInitialSave } from '@open-northland/net-client';
import { exportSaveGame, Simulation } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';

describe('initial save identity', () => {
  it('verifies the exact transferable save without secure-context crypto', async () => {
    const sim = new Simulation({ seed: 11, content: testContent() });
    sim.step();
    const save = exportSaveGame(sim, { mapId: 'fixture' });
    vi.stubGlobal('crypto', undefined);
    try {
      const prepared = await prepareInitialSave(save);
      expect(prepared.identity.tick).toBe(1);
      expect(await verifyInitialSave(prepared.bytes, prepared.identity, 'fixture')).toEqual(save);
      await expect(
        verifyInitialSave(prepared.bytes, { ...prepared.identity, fingerprint: '0'.repeat(64) }, 'fixture'),
      ).rejects.toThrow('fingerprint');
      await expect(
        verifyInitialSave(prepared.bytes, { ...prepared.identity, tick: 2 }, 'fixture'),
      ).rejects.toThrow('tick');
      await expect(verifyInitialSave(prepared.bytes, prepared.identity, 'different')).rejects.toThrow('map');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
