import { bytesToBase64, decodeSnapshot, encodeSnapshot } from '@open-northland/net-client';
import { exportSaveGame, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import {
  compressSaveText,
  decodeSaveText,
  isGzipSave,
  saveFileOf,
} from '../src/view/runtime/save-load/codec.js';

const SHARED_TICKS = 5;
const SAMPLE = JSON.stringify({ header: { kind: 'save' }, sections: ['zażółć'.repeat(500)] });

describe('save codec', () => {
  it('round-trips text through the gzip envelope, smaller on the wire', async () => {
    const bytes = await compressSaveText(SAMPLE);
    expect(isGzipSave(bytes)).toBe(true);
    expect(bytes.byteLength).toBeLessThan(new TextEncoder().encode(SAMPLE).byteLength);
    await expect(decodeSaveText(bytes)).resolves.toBe(SAMPLE);
  });

  it('passes plain uncompressed bytes through as UTF-8 text', async () => {
    await expect(decodeSaveText(new TextEncoder().encode(SAMPLE))).resolves.toBe(SAMPLE);
    await expect(decodeSaveText(new Uint8Array())).resolves.toBe('');
  });

  it('rejects a corrupt gzip envelope', async () => {
    const bytes = await compressSaveText(SAMPLE);
    await expect(decodeSaveText(bytes.slice(0, bytes.length / 2))).rejects.toThrow();
  });

  it('caps decoded size on both the inflate and the plain path', async () => {
    const bytes = await compressSaveText(SAMPLE);
    await expect(decodeSaveText(bytes, 64)).rejects.toThrow(/inflates past 64 bytes/);
    await expect(decodeSaveText(new TextEncoder().encode(SAMPLE), 64)).rejects.toThrow(/exceeds 64 bytes/);
  });

  it('writes the slot gzip a peer decodes as the relay snapshot encoding would', async () => {
    const sim = new Simulation({ seed: 3, content: testContent() });
    sim.run(SHARED_TICKS);
    const save = exportSaveGame(sim, { savedAt: 123, mapId: 'test' });
    const file = await saveFileOf(save);
    const shared = await decodeSnapshot(bytesToBase64(file.bytes));
    expect(shared).toEqual(await decodeSnapshot(await encodeSnapshot(save)));
    expect(shared).toEqual(save);
    expect(file.header).toEqual(save.header);
  });
});
