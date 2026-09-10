import { base64ToBytes, bytesToBase64, decodeSnapshot, encodeSnapshot } from '@open-northland/net-client';
import { MAX_BLOB_BYTES } from '@open-northland/net-protocol';
import { exportSaveGame, Simulation, serializeSaveGame } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';

const WARM_UP_TICKS = 30;

describe('snapshot codec', () => {
  it('round-trips a save through gzip and base64 byte for byte', async () => {
    const sim = new Simulation({ seed: 11, content: testContent() });
    for (let i = 0; i < WARM_UP_TICKS; i++) sim.step();
    const save = exportSaveGame(sim, { mapId: 'fixture' });
    const wire = await encodeSnapshot(save);
    expect(wire).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(base64ToBytes(wire).length).toBeLessThan(MAX_BLOB_BYTES);
    const back = await decodeSnapshot(wire);
    expect(serializeSaveGame(back)).toBe(serializeSaveGame(save));
    expect(back.header.mapId).toBe('fixture');
  });

  it('carries every byte value through base64, whichever base64 the platform has', () => {
    for (const length of [0, 1, 2, 3, 200_000, 200_001]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) & 0xff;
      const text = bytesToBase64(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64'));
      expect(base64ToBytes(text)).toEqual(bytes);
    }
  });
});
