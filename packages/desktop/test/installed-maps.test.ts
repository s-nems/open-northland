import { describe, expect, it } from 'vitest';
import { MAX_INSTALLED_MAP_FILE_BYTES, parseInstalledMapFileWrite } from '../src/installed-maps.js';

const BYTES = new TextEncoder().encode('{}');

describe('installed map writes from the renderer', () => {
  it('accepts a plain map id, a known sidecar and non-empty bytes', () => {
    expect(parseInstalledMapFileWrite('cn-zatoka_2', '.script.json', BYTES)).toEqual({
      mapId: 'cn-zatoka_2',
      suffix: '.script.json',
      bytes: BYTES,
    });
  });

  it('accepts a briefing voice and refuses one in another language folder', () => {
    expect(parseInstalledMapFileWrite('island', '.voice-pol-0001.wav', BYTES).suffix).toBe(
      '.voice-pol-0001.wav',
    );
    expect(() => parseInstalledMapFileWrite('island', '.voice-../0001.wav', BYTES)).toThrow(/suffix/);
    expect(() => parseInstalledMapFileWrite('island', '.voice-xyz-0001.wav', BYTES)).toThrow(/suffix/);
  });

  it.each([
    ['a path in the id', '../escape', '.json', BYTES, /map id/],
    ['a separator in the id', 'a/b', '.json', BYTES, /map id/],
    ['an over-long id', 'x'.repeat(129), '.json', BYTES, /map id/],
    ['a non-string id', 7, '.json', BYTES, /map id/],
    ['an unknown suffix', 'zatoka', '.exe', BYTES, /suffix/],
    ['a suffix with a path', 'zatoka', '/../x.json', BYTES, /suffix/],
    ['bytes that are not bytes', 'zatoka', '.json', '{}', /bytes/],
    ['an empty file', 'zatoka', '.json', new Uint8Array(0), /bytes/],
    ['an oversized file', 'zatoka', '.json', new Uint8Array(MAX_INSTALLED_MAP_FILE_BYTES + 1), /size limit/],
  ])('refuses %s', (_name, mapId, suffix, bytes, error) => {
    expect(() => parseInstalledMapFileWrite(mapId, suffix, bytes)).toThrow(error);
  });
});
