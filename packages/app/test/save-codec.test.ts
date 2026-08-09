import { describe, expect, it } from 'vitest';
import { compressSaveText, decodeSaveText, isGzipSave } from '../src/view/runtime/save-load/codec.js';

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
});
